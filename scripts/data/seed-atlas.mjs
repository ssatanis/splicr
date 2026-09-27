/**
 * Loads downloaded reference data into the atlas schema.
 *
 *   node scripts/data/seed-atlas.mjs            genes, gene sets, libraries
 *   node scripts/data/seed-atlas.mjs --genes    one section only
 *
 * Idempotent: everything upserts on a natural key, so re-running is safe.
 * Uses COPY for the large tables because inserts row by row would take hours.
 */
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import { from as copyFrom } from "pg-copy-streams";

import { connect, repoRoot } from "../db/client.mjs";

const REF = process.env.SPLICR_REFERENCE_DIR ?? join(repoRoot, "data", "references");
const only = process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2));
const want = (name) => only.length === 0 || only.includes(name);

const client = await connect();
const t0 = Date.now();

/** Streams rows into a table via COPY, through a staging table then upsert. */
async function copyInto(staging, columns, rows) {
  const stream = client.query(copyFrom(`copy ${staging} (${columns.join(",")}) from stdin with (format text)`));
  const esc = (v) =>
    v === null || v === undefined || v === ""
      ? "\\N"
      : String(v).replace(/\\/g, "\\\\").replace(/\t/g, " ").replace(/\n/g, " ").replace(/\r/g, "");
  await pipeline(
    (async function* () {
      for (const r of rows) yield columns.map((c) => esc(r[c])).join("\t") + "\n";
    })(),
    stream,
  );
}

/* ---------------------------------------------------------------- genes ---- */
if (want("genes")) {
  const file = join(REF, "annotation", "hgnc_complete_set.txt");
  if (!existsSync(file)) {
    console.log("! skipping genes: run scripts/data/download.sh first");
  } else {
    console.log("genes: reading HGNC complete set");
    const lines = readFileSync(file, "utf8").split("\n");
    const header = lines[0].split("\t");
    const ix = Object.fromEntries(header.map((h, i) => [h, i]));
    const splitMulti = (v) =>
      !v ? [] : v.replace(/^"|"$/g, "").split("|").map((s) => s.trim()).filter(Boolean);
    const arr = (a) => (a.length ? `{${a.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(",")}}` : "{}");

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const f = lines[i].split("\t");
      const symbol = f[ix.symbol];
      if (!symbol || f[ix.status] !== "Approved") continue;
      const loc = f[ix.location] ?? "";
      rows.push({
        taxid: 9606,
        symbol,
        name: f[ix.name] ?? null,
        hgnc_id: f[ix.hgnc_id] ?? null,
        entrez_id: f[ix.entrez_id] || null,
        ensembl_id: f[ix.ensembl_gene_id] || null,
        aliases: arr(splitMulti(f[ix.alias_symbol])),
        prev_symbols: arr(splitMulti(f[ix.prev_symbol])),
        chrom: loc ? loc.replace(/[pq].*$/, "") : null,
        biotype: f[ix.locus_type] ?? null,
        assembly: "GRCh38",
        source_version: "hgnc_complete_set",
      });
    }

    await client.query("begin");
    await client.query(`create temp table _genes (like atlas.genes including defaults) on commit drop`);
    await client.query(`alter table _genes drop column id`);
    const cols = ["taxid","symbol","name","hgnc_id","entrez_id","ensembl_id","aliases","prev_symbols","chrom","biotype","assembly","source_version"];
    await copyInto("_genes", cols, rows);
    const { rowCount } = await client.query(`
      insert into atlas.genes (${cols.join(",")})
      select ${cols.join(",")} from _genes
      on conflict (taxid, symbol) do update set
        name = excluded.name, hgnc_id = excluded.hgnc_id, entrez_id = excluded.entrez_id,
        ensembl_id = excluded.ensembl_id, aliases = excluded.aliases,
        prev_symbols = excluded.prev_symbols, chrom = excluded.chrom,
        biotype = excluded.biotype, updated_at = now()
    `);
    await client.query("commit");
    console.log(`genes: ${rowCount} approved human genes loaded`);
  }
}

/* ---------------------------------------------------------- mouse genes ---- */
if (want("genes")) {
  const file = join(REF, "annotation", "Mus_musculus.gene_info.gz");
  if (!existsSync(file)) {
    console.log("! skipping mouse genes: missing Mus_musculus.gene_info.gz");
  } else {
    console.log("genes: reading NCBI mouse gene_info");
    const rows = [];
    const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
    const arr = (a) => (a.length ? `{${a.map((x) => `"${x.replace(/"/g, '\\"')}"`).join(",")}}` : "{}");
    for await (const line of rl) {
      if (line.startsWith("#")) continue;
      // tax_id GeneID Symbol LocusTag Synonyms dbXrefs chromosome ... type_of_gene
      const f = line.split("\t");
      if (f[0] !== "10090" || !f[2] || f[2] === "-") continue;
      const syn = f[4] && f[4] !== "-" ? f[4].split("|").filter(Boolean) : [];
      const mgi = (f[5] || "").split("|").find((x) => x.startsWith("MGI:MGI:"));
      rows.push({
        taxid: 10090,
        symbol: f[2],
        name: f[8] && f[8] !== "-" ? f[8] : null,
        hgnc_id: mgi ? mgi.replace("MGI:MGI:", "MGI:") : null,
        entrez_id: f[1],
        ensembl_id: null,
        aliases: arr(syn),
        prev_symbols: "{}",
        chrom: f[6] && f[6] !== "-" ? f[6] : null,
        biotype: f[9] && f[9] !== "-" ? f[9] : null,
        assembly: "GRCm39",
        source_version: "ncbi_gene_info",
      });
    }
    await client.query("begin");
    await client.query(`create temp table _mgenes (like atlas.genes including defaults) on commit drop`);
    await client.query(`alter table _mgenes drop column id`);
    const cols = ["taxid","symbol","name","hgnc_id","entrez_id","ensembl_id","aliases","prev_symbols","chrom","biotype","assembly","source_version"];
    await copyInto("_mgenes", cols, rows);
    const { rowCount } = await client.query(`
      insert into atlas.genes (${cols.join(",")})
      select distinct on (taxid, symbol) ${cols.join(",")} from _mgenes
      on conflict (taxid, symbol) do update set
        name = excluded.name, entrez_id = excluded.entrez_id,
        aliases = excluded.aliases, chrom = excluded.chrom,
        biotype = excluded.biotype, updated_at = now()
    `);
    await client.query("commit");
    console.log(`genes: ${rowCount} mouse genes loaded`);
  }
}

/* ------------------------------------------------------------ gene sets ---- */
if (want("genesets")) {
  const sets = [
    { slug: "hart-cegv2", name: "Hart CEGv2 core essentials", file: "CEGv2.txt", kind: "essential", taxid: 9606, source: "Hart et al., G3 2017" },
    { slug: "hart-negv1", name: "Hart NEGv1 nonessentials", file: "NEGv1.txt", kind: "nonessential", taxid: 9606, source: "Hart et al., Genome Biology 2014" },
    { slug: "hart-ceg-mouse", name: "Hart mouse core essentials", file: "CEG_mouse.txt", kind: "essential", taxid: 10090, source: "Hart lab" },
    { slug: "hart-neg-mouse", name: "Hart mouse nonessentials", file: "NEG_mouse.txt", kind: "nonessential", taxid: 10090, source: "Hart lab" },
  ];
  for (const s of sets) {
    const file = join(REF, "genesets", s.file);
    if (!existsSync(file)) { console.log(`! skipping ${s.slug}: missing`); continue; }
    const symbols = readFileSync(file, "utf8")
      .split(/\r?\n/)
      .slice(1)
      .map((l) => l.split("\t")[0]?.trim())
      .filter(Boolean);
    const { rows: [set] } = await client.query(
      `insert into atlas.gene_sets (slug, name, taxid, kind, source, n_genes)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (slug) do update set n_genes = excluded.n_genes, name = excluded.name
       returning id`,
      [s.slug, s.name, s.taxid, s.kind, s.source, symbols.length],
    );
    // Published gene sets carry symbols from the year they were made, so fall
    // back to HGNC's previous-symbol list before giving up on a name.
    await client.query(
      `insert into atlas.gene_set_members (gene_set_id, symbol, gene_id)
       select $1, u.symbol,
              coalesce(
                (select g.id from atlas.genes g
                  where g.taxid = $3 and g.symbol = u.symbol),
                (select g.id from atlas.genes g
                  where g.taxid = $3 and u.symbol = any(g.prev_symbols) limit 1),
                (select g.id from atlas.genes g
                  where g.taxid = $3 and u.symbol = any(g.aliases) limit 1)
              )
       from (select distinct unnest($2::text[]) as symbol) as u
       on conflict (gene_set_id, symbol) do update set gene_id = excluded.gene_id`,
      [set.id, symbols, s.taxid],
    );
    const { rows: [r] } = await client.query(
      `select count(*)::int as total, count(gene_id)::int as resolved
         from atlas.gene_set_members where gene_set_id = $1`,
      [set.id],
    );
    console.log(`geneset ${s.slug}: ${r.total} symbols, ${r.resolved} resolved to a gene`);
  }
}

/* ------------------------------------------------------------ libraries ---- */
if (want("libraries")) {
  // Broad GPP files use bare CR line endings; normalize before splitting.
  const readRows = (p) => readFileSync(p, "utf8").replace(/\r\n?/g, "\n").split("\n").filter(Boolean);

  const defs = [
    { slug: "brunello", name: "Brunello", file: "brunello.txt", taxid: 9606, modality: "knockout", cas: "SpCas9",
      addgene: "73179", seqCol: "sgRNA Target Sequence", geneCol: "Target Gene Symbol", control: "Non-Targeting Control" },
    { slug: "brie", name: "Brie", file: "brie.txt", taxid: 10090, modality: "knockout", cas: "SpCas9",
      addgene: "73633", seqCol: "sgRNA Target Sequence", geneCol: "Target Gene Symbol", control: "Non-Targeting Control" },
    { slug: "gattinara", name: "Gattinara", file: "gattinara.txt", taxid: 9606, modality: "knockout", cas: "SpCas9",
      addgene: "136986", seqCol: "Barcode Sequence", geneCol: "Annotated Gene Symbol", control: "NEG_CONTROL" },
    { slug: "calabrese-a", name: "Calabrese Set A", file: "calabrese-a.txt", taxid: 9606, modality: "crispra", cas: "dCas9-p65-HSF",
      addgene: "92379", seqCol: "Barcode Sequence", geneCol: "Annotated Gene Symbol", control: "NO-TARGET" },
    { slug: "dolcetto-a", name: "Dolcetto Set A", file: "dolcetto-a.txt", taxid: 9606, modality: "crispri", cas: "dCas9-KRAB",
      addgene: "92385", seqCol: "Barcode Sequence", geneCol: "Annotated Gene Symbol", control: "NO-TARGET" },
  ];

  for (const d of defs) {
    const file = join(REF, "libraries", d.file);
    if (!existsSync(file)) { console.log(`! skipping ${d.slug}: missing`); continue; }
    const lines = readRows(file);
    const header = lines[0].split("\t");
    const si = header.indexOf(d.seqCol);
    const gi = header.indexOf(d.geneCol);
    if (si < 0 || gi < 0) { console.log(`! skipping ${d.slug}: unexpected header`); continue; }

    const guides = [];
    const genes = new Set();
    let controls = 0;
    for (let i = 1; i < lines.length; i++) {
      const f = lines[i].split("\t");
      const seq = (f[si] ?? "").trim().toUpperCase();
      if (!/^[ACGTN]{15,34}$/.test(seq)) continue;
      const gene = (f[gi] ?? "").trim();
      const isControl = !gene || gene.startsWith(d.control);
      if (isControl) controls++; else genes.add(gene);
      guides.push({
        guide_key: `${d.slug}:${i}`,
        sequence: seq,
        gene_symbol: isControl ? null : gene,
        is_control: isControl,
        control_type: isControl ? "non_targeting" : null,
      });
    }

    const { rows: [lib] } = await client.query(
      `insert into atlas.libraries
         (slug, name, taxid, modality, cas, n_guides, n_targeting, n_controls, n_genes,
          guides_per_gene, guide_length, addgene_id, source_version)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (slug) where org_id is null do update set
         n_guides = excluded.n_guides, n_targeting = excluded.n_targeting,
         n_controls = excluded.n_controls, n_genes = excluded.n_genes,
         guides_per_gene = excluded.guides_per_gene, updated_at = now()
       returning id`,
      [d.slug, d.name, d.taxid, d.modality, d.cas, guides.length, guides.length - controls,
       controls, genes.size, genes.size ? ((guides.length - controls) / genes.size).toFixed(2) : null,
       guides[0]?.sequence.length ?? null, d.addgene, "addgene"],
    );

    await client.query("begin");
    await client.query(`delete from atlas.guides where library_id = $1`, [lib.id]);
    await client.query(`create temp table _guides (
      library_id uuid, guide_key text, sequence text, gene_symbol text,
      is_control boolean, control_type text) on commit drop`);
    const cols = ["library_id","guide_key","sequence","gene_symbol","is_control","control_type"];
    await copyInto("_guides", cols, guides.map((g) => ({ ...g, library_id: lib.id })));
    await client.query(`
      insert into atlas.guides (library_id, guide_key, sequence, gene_symbol, gene_id, is_control, control_type)
      select t.library_id, t.guide_key, t.sequence, t.gene_symbol, g.id, t.is_control, t.control_type
      from _guides t
      left join atlas.genes g on g.symbol = t.gene_symbol and g.taxid = $1
    `, [d.taxid]);
    await client.query("commit");
    console.log(`library ${d.slug}: ${guides.length} guides, ${genes.size} genes, ${controls} controls`);
  }
}

const { rows: counts } = await client.query(`
  select 'genes' t, count(*)::int n from atlas.genes
  union all select 'gene_sets', count(*)::int from atlas.gene_sets
  union all select 'gene_set_members', count(*)::int from atlas.gene_set_members
  union all select 'libraries', count(*)::int from atlas.libraries
  union all select 'guides', count(*)::int from atlas.guides
`);
console.log("\nAtlas contents:");
for (const c of counts) console.log(`  ${c.t.padEnd(18)} ${c.n.toLocaleString()}`);
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

await client.end();
