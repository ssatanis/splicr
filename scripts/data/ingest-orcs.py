#!/usr/bin/env python
"""
Ingest BioGRID ORCS into the Atlas.

    engine/.tools/env/bin/python scripts/data/ingest-orcs.py                 # rows + stats
    engine/.tools/env/bin/python scripts/data/ingest-orcs.py --stats-only    # recompute stats
    engine/.tools/env/bin/python scripts/data/ingest-orcs.py --postgres      # also load Postgres
    engine/.tools/env/bin/python scripts/data/ingest-orcs.py --r2            # also sync to R2
    engine/.tools/env/bin/python scripts/data/ingest-orcs.py --limit 40      # a quick slice

Four phases, each of which can be run on its own and re-run safely:

  rows      Stream the archive and write one parquet file per screen under
            <atlas>/gene_hits/screen_id=<id>/rows.parquet. This is the
            expensive phase, about a minute for the 752 MB human archive, and
            it is where resumability lives: a screen whose file already exists
            is skipped, so a killed run costs at most the screen it was in
            the middle of. Each file is written to a .tmp and renamed, so a
            crash can never leave a half-written file that a later run would
            mistake for finished work.
  stats     Read those files back and write screens.parquet, gene_stats.parquet,
            gene_aliases.parquet and manifest.json. Cheap and stateless: it
            always starts over, so it is the phase to re-run after changing a
            threshold. The manifest is written LAST, because its presence is
            what tells splicr.atlas the store is usable.
  postgres  Load atlas.screens and atlas.gene_stats, and the per-screen hit
            rows for whichever screens fit. Optional and resumable through
            its own checkpoint. Skipped with a clear message when the
            database refuses connections, which is the normal case for the
            free tier once the disk is full.
  r2        Upload the store to Cloudflare R2. Optional. Skips objects already
            present at the same size, so it resumes for free.

WHY THE LONG ROWS DO NOT GO INTO POSTGRES BY DEFAULT. The human release is
26,333,098 gene rows. As atlas.screen_hits, with its index on gene_symbol,
that is several gigabytes against a 500 MB disk, and the disk being full is
what took the database down in the first place. The same rows are 300-400 MB
of zstd parquet. So parquet is the system of record for the rows and Postgres
holds the two small tables the app actually queries: 1,952 screens and 87,540
gene stats. --postgres-rows overrides this for a deployment with room.

    LICENCE. ORCS is MIT, "Copyright 2021 Mike Tyers", and the notice has to
    travel with any copy or substantial portion. A NOTICE file is written next
    to the store and uploaded with it.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "engine"))

from splicr import atlas as atlas_mod                                    # noqa: E402
from splicr import harmonize                                             # noqa: E402
from splicr import orcs                                                  # noqa: E402
from splicr.atlas import GeneAccumulator, invert_aliases, summarise_gene_stats  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]

#: Written beside the store and uploaded with it. ORCS is MIT licensed and the
#: notice must travel with any substantial portion of it; an Atlas built from
#: 26 million of its rows is a substantial portion.
NOTICE = """This directory is derived from BioGRID ORCS (Open Repository of CRISPR Screens).

  Source:  https://orcs.thebiogrid.org
  Release: {release}
  Licence: MIT, Copyright 2021 Mike Tyers
           https://wiki.thebiogrid.org/doku.php/terms_and_conditions

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The gene-level HIT calls in this store are the ORIGINAL AUTHORS' calls,
transcribed by BioGRID from each paper into SIGNIFICANCE_CRITERIA. They are not
recomputed by BioGRID and they are not recomputed by SplicR.
"""


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}PB"


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Phase 1: rows
# ---------------------------------------------------------------------------

def rows_schema():
    import pyarrow as pa

    # score1..5 are float32: ORCS scores are single-precision quantities from
    # other people's tools and float64 would double the file for no
    # information.
    #
    # n_rows is int32, not int8. It was int8 on the assumption that no symbol
    # appears more than 127 times in one screen, and the parse audit caught
    # that being wrong within an hour: screen 2128 puts all 2,555 non-targeting
    # controls of the Horlbeck H1 CRISPRi library under the pseudo-symbol
    # "NTC", and screen 1146 puts Brunello's 1,000 controls under "0". Capping
    # at 127 lost 14,046 source rows across 8 screens. int32 RLE-compresses to
    # nothing here, since almost every value is 1.
    return pa.schema([
        ("screen_id", pa.int32()),
        ("gene_symbol", pa.string()),
        ("entrez_id", pa.int64()),
        ("identifier_type", pa.string()),
        ("is_hit", pa.bool_()),
        ("score1", pa.float32()),
        ("score2", pa.float32()),
        ("score3", pa.float32()),
        ("score4", pa.float32()),
        ("score5", pa.float32()),
        ("n_rows", pa.int32()),
        ("disagreed", pa.bool_()),
        ("aliases", pa.string()),
    ])


def write_screen_rows(
    table: orcs.ScreenTable,
    dest: Path,
    seen_aliases: set[str] | None = None,
) -> int:
    """
    One screen's collapsed gene rows to parquet, atomically.

    Written to rows.parquet.tmp and renamed. Without that, a run killed mid
    write leaves a truncated rows.parquet, and the next run sees the file
    exists, skips the screen, and the store is quietly short a screen's worth
    of data for the rest of its life.

    seen_aliases holds "<symbol>\\t<alias string>" pairs already written. ORCS
    repeats a gene's ALIASES in every screen that measured it, and that one
    column was 60% of an 800 MB store: 184 KB of alias text per screen file
    times 1,952 files, nearly all of it the same strings. Writing each
    distinct pair once takes the store to under 300 MB and loses nothing,
    because the alias map is built as a union over all rows. When the set is
    empty, as it is on a resumed run, pairs are simply written again: bigger,
    never wrong.
    """
    import pyarrow as pa
    import pyarrow.parquet as pq

    schema = rows_schema()
    cols: dict[str, list] = {name: [] for name in schema.names}
    for g in table.genes:
        scores = list(g.scores) + [None] * (5 - len(g.scores))
        cols["screen_id"].append(table.screen_id)
        cols["gene_symbol"].append(g.symbol)
        cols["entrez_id"].append(g.entrez_id)
        cols["identifier_type"].append(g.identifier_type)
        cols["is_hit"].append(g.is_hit)
        for i in range(5):
            cols[f"score{i + 1}"].append(scores[i])
        cols["n_rows"].append(g.n_rows)
        cols["disagreed"].append(g.disagreed)
        alias_text = "|".join(g.aliases) if g.aliases else None
        if alias_text is not None and seen_aliases is not None:
            key = f"{g.symbol}\t{alias_text}"
            if key in seen_aliases:
                alias_text = None
            else:
                seen_aliases.add(key)
        cols["aliases"].append(alias_text)

    # The parse stats travel in the file's own key-value metadata rather than
    # in a side file. Counts of rows the parser DROPPED cannot be recovered
    # from the rows that survived, and they are the evidence that nothing was
    # lost, so they have to live with the data they describe. Reading them
    # back costs a footer read, not a data read.
    stats = {
        "n_raw_rows": table.n_raw_rows,
        "n_dropped_no_symbol": table.n_dropped_no_symbol,
        "n_dropped_short_row": table.n_dropped_short_row,
        "n_duplicate_groups": table.n_duplicate_groups,
        "n_duplicate_rows": table.n_duplicate_rows,
        "n_disagreeing_groups": table.n_disagreeing_groups,
        "identifier_types": table.identifier_types,
        "organism_ids": sorted(table.organism_ids),
        "parser": f"splicr.orcs {orcs.RELEASE}",
    }
    arrow = pa.table({k: pa.array(v, schema.field(k).type) for k, v in cols.items()},
                     schema=schema.with_metadata({b"splicr_parse": json.dumps(stats).encode()}))
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".parquet.tmp")
    pq.write_table(arrow, tmp, compression="zstd", compression_level=9)
    tmp.replace(dest)
    return arrow.num_rows


def read_parse_stats(path: Path) -> dict:
    """The parse stats written into a screen's parquet metadata, or {}."""
    import pyarrow.parquet as pq

    raw = (pq.read_schema(path).metadata or {}).get(b"splicr_parse")
    if not raw:
        return {}
    try:
        return json.loads(raw.decode())
    except Exception:
        return {}


def phase_rows(
    archive: Path,
    store: atlas_mod.AtlasStore,
    index: dict[int, orcs.OrcsScreen],
    limit: int | None,
    restart: bool,
    verbose: bool = True,
) -> dict:
    """Stream the archive, one parquet file per screen. Resumable."""
    out_dir = store.dir / atlas_mod.ROWS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    done = {sid for sid in index if store.screen_rows_path(sid).exists()}
    if restart and done:
        print(f"  --restart: removing {len(done)} existing screen files")
        shutil.rmtree(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        done = set()

    # Leftover .tmp files are from a killed run. They are by definition
    # incomplete, so remove them rather than letting a later glob find them.
    for stale in out_dir.rglob("*.tmp"):
        stale.unlink()

    wanted = None
    if limit is not None:
        # Interleave the largest and smallest screens. Taking only the small
        # end gives a store with no background screens at all and phase 2
        # correctly refuses to compute rates; taking only the large end misses
        # the hit-list-only deposits and sub-pool libraries, which are exactly
        # the awkward cases a smoke test should cover.
        by_size = sorted(index, key=lambda s: index[s].scores_size or 0)
        picked: list[int] = []
        while by_size and len(picked) < limit:
            picked.append(by_size.pop())          # largest remaining
            if by_size and len(picked) < limit:
                picked.append(by_size.pop(0))     # smallest remaining
        wanted = picked

    todo = [s for s in (wanted if wanted is not None else index) if s not in done]
    print(f"  {len(done):,} screens already written, {len(todo):,} to go")
    if not todo:
        return {"written": 0, "skipped": len(done), "rows": 0, "seconds": 0.0}

    # This phase reports only what THIS run did. The audit counts that say
    # whether the parse was complete, which have to describe the whole store
    # however many runs built it, are derived from the written files in
    # phase 2 instead. The first version accumulated them here and a resumed
    # run reported 38 collapsed duplicate groups where the store holds
    # 60,162, because the manifest holding the earlier count is exactly what
    # a killed run has not written yet.
    t0 = time.time()
    written = rows = 0
    early_mismatch = 0
    seen_aliases: set[str] = set()
    for table in orcs.iter_archive_tables(archive, screen_ids=todo):
        n = write_screen_rows(table, store.screen_rows_path(table.screen_id), seen_aliases)
        rows += n
        written += 1
        expected = index[table.screen_id].scores_size
        if expected is not None and table.n_raw_rows != expected:
            # Surfaced here as well as in phase 2 so a bad archive is visible
            # in the first minute rather than after the whole pass.
            early_mismatch += 1
            if early_mismatch <= 5:
                print(f"    WARNING screen {table.screen_id}: {table.n_raw_rows:,} rows "
                      f"parsed, index says {expected:,}")
        if verbose and written % 200 == 0:
            rate = written / max(time.time() - t0, 1e-9)
            print(f"    {written:,}/{len(todo):,} screens, {rows:,} rows, "
                  f"{rate:.0f} screens/s")

    seconds = time.time() - t0
    print(f"  wrote {written:,} screens, {rows:,} rows in {seconds:.0f}s")
    print(f"  {len(seen_aliases):,} distinct (symbol, aliases) pairs written this run")
    return {
        "written": written, "skipped": len(done), "rows": rows, "seconds": seconds,
        "row_count_mismatches_seen": early_mismatch,
        # This run only: the dedup set starts empty on a resume, so the count
        # is not comparable across runs.
        "distinct_alias_pairs_this_run": len(seen_aliases),
    }


# ---------------------------------------------------------------------------
# Phase 2: stats
# ---------------------------------------------------------------------------

def screens_schema():
    import pyarrow as pa

    # Built from one OrcsScreen.as_row() so the columns cannot drift from the
    # dataclass. Types inferred per key: ints for counts, bool for the two
    # flags, string for the rest.
    int_cols = {"screen_id", "year", "scores_size", "full_size", "number_of_hits",
                "score_col_count", "organism_id"}
    bool_cols = {"full_size_available", "is_hit_list_only", "usable_background",
                 "targets_tss"}
    template = orcs.OrcsScreen(screen_id=0).as_row()
    fields = []
    for name in template:
        if name in int_cols:
            fields.append((name, pa.int64()))
        elif name in bool_cols:
            fields.append((name, pa.bool_()))
        else:
            fields.append((name, pa.string()))
    return pa.schema(fields)


def write_screens(index: dict[int, orcs.OrcsScreen], present: set[int], dest: Path) -> int:
    """
    screens.parquet: only the screens whose rows are actually on disk.

    Writing the whole index here would make splicr.atlas believe it can look
    up rows for screens that were never ingested, and a --limit run would
    report comparable screens whose measured-gene sets are missing.
    """
    import pyarrow as pa
    import pyarrow.parquet as pq

    schema = screens_schema()
    rows = [index[sid].as_row() for sid in sorted(present)]
    cols = {name: [r.get(name) for r in rows] for name in schema.names}
    arrow = pa.table({k: pa.array(v, schema.field(k).type) for k, v in cols.items()},
                     schema=schema)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".parquet.tmp")
    pq.write_table(arrow, tmp, compression="zstd")
    tmp.replace(dest)
    return arrow.num_rows


def gene_stats_schema():
    import pyarrow as pa

    return pa.schema([
        ("symbol", pa.string()),
        ("entrez_id", pa.int64()),
        ("n_screens_tested", pa.int32()),
        ("n_hits", pa.int32()),
        ("hit_rate", pa.float32()),
        ("n_screens_all", pa.int32()),
        ("n_hits_all", pa.int32()),
        ("n_phenotypes", pa.int32()),
        ("n_cell_lines", pa.int32()),
        ("n_conditions", pa.int32()),
        ("phenotypes", pa.list_(pa.string())),
        ("tested_mask", pa.binary()),
        ("hit_mask", pa.binary()),
    ])


def phase_stats(
    store: atlas_mod.AtlasStore,
    index: dict[int, orcs.OrcsScreen],
    release: str,
    rows_report: dict,
) -> dict:
    """
    Accumulate per-gene statistics from the written rows and finish the store.

    Stateless by design: it rebuilds everything from the parquet files, so it
    is safe to re-run and it is the only phase that has to be re-run after a
    threshold in splicr.orcs or splicr.atlas changes.
    """
    import pyarrow as pa
    import pyarrow.parquet as pq

    rows_dir = store.dir / atlas_mod.ROWS_DIR
    present = sorted(
        sid for sid in index if store.screen_rows_path(sid).exists()
    )
    if not present:
        raise SystemExit(f"no screen rows under {rows_dir}. Run the rows phase first.")

    # The bit order for every gene mask. Only background screens get a bit:
    # a hit-list-only deposit has a 100% hit rate by construction and a
    # 400-gene sub-pool has no business in a genome-wide denominator.
    background = [sid for sid in present if index[sid].usable_background]
    n_bits = len(background)
    if n_bits == 0:
        raise SystemExit(
            "none of the ingested screens is usable as a background "
            f"(>= {orcs.MIN_BACKGROUND_GENES:,} genes and not a hit-list-only deposit), "
            "so every hit rate would have a zero denominator. Ingest more screens."
        )
    bit_of = {sid: i for i, sid in enumerate(background)}
    print(f"  {len(present):,} screens on disk, {n_bits:,} usable as background")

    accum: dict[str, GeneAccumulator] = {}
    t0 = time.time()
    n_rows = n_hit_rows = 0
    # The parse audit, derived from the files rather than from whichever run
    # wrote them, so it describes the store after a resume exactly as after a
    # full pass. Two independent counts of the same thing: the stats each
    # screen's parquet metadata carries, and sum(n_rows) over its rows. They
    # must agree with each other and with the index's SCORES_SIZE, and the
    # first version disagreed, which is how the int8 n_rows cap was found.
    audit = {"duplicate_groups": 0, "duplicate_rows": 0, "disagreeing_groups": 0,
             "raw_rows_recovered": 0, "raw_rows_declared": 0,
             "dropped_no_symbol": 0, "dropped_short_row": 0,
             "screens_missing_parse_stats": 0, "largest_duplicate_group": 0}
    mismatches: list[list[int]] = []
    for i, sid in enumerate(present, 1):
        screen = index[sid]
        bit = bit_of.get(sid)
        table = pq.read_table(
            store.screen_rows_path(sid),
            columns=["gene_symbol", "entrez_id", "is_hit", "aliases", "n_rows",
                     "disagreed"],
        )
        symbols = table.column("gene_symbol").to_pylist()
        entrez = table.column("entrez_id").to_pylist()
        hits = table.column("is_hit").to_pylist()
        aliases = table.column("aliases").to_pylist()
        per_group = table.column("n_rows").to_pylist()
        disagreed = table.column("disagreed").to_pylist()
        n_rows += len(symbols)
        raw_here = 0
        for j, k in enumerate(per_group):
            raw_here += k
            if k > 1:
                audit["duplicate_groups"] += 1
                audit["duplicate_rows"] += k
                audit["largest_duplicate_group"] = max(audit["largest_duplicate_group"], k)
            if disagreed[j]:
                audit["disagreeing_groups"] += 1
        audit["raw_rows_recovered"] += raw_here

        parse = read_parse_stats(store.screen_rows_path(sid))
        if not parse:
            audit["screens_missing_parse_stats"] += 1
        else:
            audit["raw_rows_declared"] += parse["n_raw_rows"]
            audit["dropped_no_symbol"] += parse["n_dropped_no_symbol"]
            audit["dropped_short_row"] += parse["n_dropped_short_row"]

        # Three numbers must line up per screen: the index's SCORES_SIZE, the
        # rows the parser saw, and the rows recovered from n_rows plus the
        # rows it deliberately dropped. Any gap is a rows-phase bug.
        expected = screen.scores_size
        dropped = (parse.get("n_dropped_no_symbol", 0)
                   + parse.get("n_dropped_short_row", 0)) if parse else 0
        if expected is not None and raw_here + dropped != expected:
            mismatches.append([sid, raw_here, dropped, expected])
        for j, sym in enumerate(symbols):
            acc = accum.get(sym)
            if acc is None:
                acc = accum[sym] = GeneAccumulator(symbol=sym)
            is_hit = bool(hits[j])
            if is_hit:
                n_hit_rows += 1
            acc.observe(
                screen, is_hit, entrez[j], bit,
                aliases=(aliases[j].split("|") if aliases[j] else ()),
            )
        if i % 250 == 0:
            print(f"    {i:,}/{len(present):,} screens, {n_rows:,} rows, "
                  f"{len(accum):,} symbols, {time.time() - t0:.0f}s")

    print(f"  {len(accum):,} distinct symbols from {n_rows:,} rows "
          f"({n_hit_rows:,} hits) in {time.time() - t0:.0f}s")
    print(f"  parse audit: {audit['raw_rows_recovered']:,} source rows recovered, "
          f"{audit['dropped_no_symbol']:,} dropped for no symbol, "
          f"{audit['dropped_short_row']:,} dropped short of columns")
    print(f"  {audit['duplicate_groups']:,} duplicate symbol groups collapsed "
          f"({audit['duplicate_rows']:,} rows, largest "
          f"{audit['largest_duplicate_group']:,}), "
          f"{audit['disagreeing_groups']:,} of which disagreed on HIT")
    if audit["screens_missing_parse_stats"]:
        print(f"  WARNING: {audit['screens_missing_parse_stats']} screen files carry no "
              f"parse stats; they predate this version and should be rewritten "
              f"with --restart")
    if mismatches:
        print(f"  WARNING: {len(mismatches)} screens where recovered + dropped does not "
              f"equal the index SCORES_SIZE [screen, recovered, dropped, expected]: "
              f"{mismatches[:5]}")
    else:
        print("  every screen accounts for exactly its SCORES_SIZE rows")
    audit["row_count_mismatches"] = mismatches[:50]
    audit["n_row_count_mismatches"] = len(mismatches)

    # gene_stats.parquet
    stat_rows = [accum[s].row(n_bits) for s in sorted(accum)]
    schema = gene_stats_schema()
    cols = {name: [r[name] for r in stat_rows] for name in schema.names}
    arrow = pa.table({k: pa.array(v, schema.field(k).type) for k, v in cols.items()},
                     schema=schema)
    stats_path = store.dir / atlas_mod.GENE_STATS_NAME
    tmp = stats_path.with_suffix(".parquet.tmp")
    pq.write_table(arrow, tmp, compression="zstd")
    tmp.replace(stats_path)
    summary = summarise_gene_stats(stat_rows)
    print(f"  gene_stats.parquet: {arrow.num_rows:,} genes, "
          f"{human(stats_path.stat().st_size)}, median "
          f"{summary['median_screens_per_gene']} screens per gene")

    # gene_aliases.parquet
    alias_map = invert_aliases({s: a.aliases for s, a in accum.items()})
    alias_schema = pa.schema([("alias", pa.string()), ("symbol", pa.string())])
    alias_rows = sorted(alias_map.items())
    alias_table = pa.table(
        {"alias": pa.array([a for a, _ in alias_rows], pa.string()),
         "symbol": pa.array([s for _, s in alias_rows], pa.string())},
        schema=alias_schema,
    )
    alias_path = store.dir / atlas_mod.ALIASES_NAME
    tmp = alias_path.with_suffix(".parquet.tmp")
    pq.write_table(alias_table, tmp, compression="zstd")
    tmp.replace(alias_path)
    print(f"  gene_aliases.parquet: {alias_table.num_rows:,} unambiguous aliases")

    # screens.parquet
    n_screens = write_screens(index, set(present), store.dir / atlas_mod.SCREENS_NAME)
    print(f"  screens.parquet: {n_screens:,} screens")

    (store.dir / "NOTICE").write_text(NOTICE.format(release=release))

    # The manifest is written last on purpose: splicr.atlas treats its
    # presence as the signal that the store is complete, so a crash anywhere
    # above leaves the store correctly reported as not yet built.
    store_bytes = sum(p.stat().st_size for p in store.dir.rglob("*") if p.is_file())
    manifest = {
        "schema_version": 1,
        "release": release,
        "generated_utc": now(),
        "source": "BioGRID ORCS, https://orcs.thebiogrid.org",
        "licence": "MIT, Copyright 2021 Mike Tyers; see NOTICE",
        "organism_id": 9606,
        "n_screens": len(present),
        "n_screens_in_index": len(index),
        "n_background_screens": n_bits,
        "background_screen_ids": background,
        "n_gene_rows": n_rows,
        "n_hit_rows": n_hit_rows,
        "n_symbols": len(accum),
        "n_aliases": len(alias_map),
        "min_background_genes": orcs.MIN_BACKGROUND_GENES,
        "bytes_on_disk": store_bytes,
        "gene_stats_summary": summary,
        # Derived from the written files, so it describes the store however
        # many runs built it. See the comment where audit is initialised.
        "parse_audit": audit,
        "rows_phase": rows_report,
        # Recorded so a reader knows the store itself holds every screen and
        # that leakage filtering happens at read time, not here.
        "leakage_filtered_at_ingest": False,
        "notes": [
            "HIT is the original authors' call, transcribed by BioGRID. Not recomputed.",
            "Duplicate (screen, symbol) rows are collapsed by splicr.orcs.collapse_rows: "
            "is_hit is the OR, scores come from the largest-magnitude SCORE.1 hit row.",
            "SCORE.1 means a different quantity in every screen (see score_1_type), so "
            "no cross-screen score aggregate is computed and median_lfc stays null.",
            "Bit i of tested_mask/hit_mask is background_screen_ids[i].",
        ],
    }
    tmp = store.manifest_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, indent=1))
    tmp.replace(store.manifest_path)
    print(f"  manifest.json written; store is {human(store_bytes)}")
    return manifest


# ---------------------------------------------------------------------------
# Phase 3: Postgres
# ---------------------------------------------------------------------------

def phase_postgres(
    store: atlas_mod.AtlasStore,
    index: dict[int, orcs.OrcsScreen],
    with_rows: bool,
    batch: int,
) -> dict:
    """
    Load atlas.screens and atlas.gene_stats, optionally the hit rows too.

    Resumable through <atlas>/postgres-checkpoint.json, which records the
    screen ids already loaded. Any connection failure is caught and reported:
    the whole point of the checkpoint is that the free tier being full is a
    normal, recoverable state and not a reason to lose an hour of parsing.
    """
    from splicr import db

    checkpoint_path = store.dir / "postgres-checkpoint.json"
    checkpoint = {"screens": [], "gene_stats": False, "rows": []}
    if checkpoint_path.exists():
        checkpoint.update(json.loads(checkpoint_path.read_text()))

    def save() -> None:
        tmp = checkpoint_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(checkpoint))
        tmp.replace(checkpoint_path)

    try:
        conn = db.open_connection()
    except Exception as exc:
        print(f"  Postgres is not available: {type(exc).__name__}: {str(exc)[:200]}")
        print("  The parquet store is complete and is the system of record. Re-run "
              "with --postgres when the database is back; it resumes from "
              f"{checkpoint_path.name}.")
        return {"loaded": False, "reason": f"{type(exc).__name__}: {exc}"}

    screens = store.screens()
    stats_loaded = 0
    screens_loaded = 0
    screen_uuid: dict[int, str] = {}
    gene_resolver = harmonize.genes(9606)
    cell_resolver = harmonize.cell_lines(taxid=9606)
    gene_cache: dict[str, harmonize.Resolution] = {}

    def gene_resolution(raw: str):
        if raw not in gene_cache:
            gene_cache[raw] = gene_resolver.resolve(raw)
        return gene_cache[raw]

    def reject(cur, source_id: str, kind: str, raw: str, result,
               n_rows: int = 1) -> None:
        reason = result.reason or result.status
        cur.execute(
            """
            insert into atlas.harmonization_rejects
              (source, source_id, entity_kind, raw_value, reason, candidates, n_rows)
            values ('orcs', %s, %s, %s, %s, %s, %s)
            on conflict (source, source_id, entity_kind, raw_value) do update set
              reason = excluded.reason, candidates = excluded.candidates,
              n_rows = excluded.n_rows, at = now()
            """,
            (source_id, kind, raw or "<missing>", f"{result.status}: {reason}",
             list(result.candidates), n_rows),
        )

    try:
        done = set(checkpoint["screens"])
        todo = [sid for sid in sorted(screens) if sid not in done]
        print(f"  atlas.screens: {len(done):,} already loaded, {len(todo):,} to go")
        for start in range(0, len(todo), batch):
            chunk = todo[start:start + batch]
            with conn.cursor() as cur:
                for sid in chunk:
                    s = screens[sid]
                    cell = cell_resolver.resolve(s.cell_line or "")
                    if not cell.ok:
                        reject(cur, str(sid), "cell_line", s.cell_line or "", cell,
                               n_rows=max(1, s.scores_size or 1))
                        continue
                    cur.execute(
                        """
                        insert into atlas.screens
                          (source, source_id, title, pmid, year, taxid, library_name,
                           modality, cell_line, cell_line_rrid, phenotype, condition, methodology,
                           analysis_tool, n_genes, n_hits, has_raw_reads, metadata)
                        -- The casts are explicit because modality is an enum
                        -- and metadata is jsonb, and a driver that sends a
                        -- Python str as text rather than as an untyped literal
                        -- gets "column is of type public.modality but
                        -- expression is of type text" instead of a coercion.
                        values ('orcs', %s, %s, %s, %s, 9606, %s,
                                %s::public.modality, %s, %s, %s, %s, %s,
                                %s, %s, %s, false, %s::jsonb)
                        on conflict (source, source_id) do update set
                          title = excluded.title, pmid = excluded.pmid,
                          year = excluded.year, library_name = excluded.library_name,
                          modality = excluded.modality, cell_line = excluded.cell_line,
                          cell_line_rrid = excluded.cell_line_rrid,
                          phenotype = excluded.phenotype, condition = excluded.condition,
                          methodology = excluded.methodology,
                          analysis_tool = excluded.analysis_tool,
                          n_genes = excluded.n_genes, n_hits = excluded.n_hits,
                          metadata = excluded.metadata
                        returning id
                        """,
                        (
                            str(sid),
                            s.screen_name or f"ORCS screen {sid}",
                            s.pmid, s.year, s.library,
                            # modality may be None for an unmapped LIBRARY_TYPE;
                            # the column is nullable and a wrong enum value would
                            # be worse than a null.
                            s.modality, s.cell_line, cell.id, s.phenotype, s.condition_name,
                            s.library_methodology, s.analysis,
                            s.scores_size, s.number_of_hits,
                            json.dumps({
                                "release": s.release,
                                "author": s.author,
                                "screen_type": s.screen_type,
                                "screen_format": s.screen_format,
                                "experimental_setup": s.experimental_setup,
                                "duration": s.duration,
                                "condition_dosage": s.condition_dosage,
                                "moi": s.moi,
                                "enzyme": s.enzyme,
                                "library_type": s.library_type,
                                "cell_type": s.cell_type,
                                "significance_indicator": s.significance_indicator,
                                "significance_criteria": s.significance_criteria,
                                "score_types": list(s.score_types),
                                "is_hit_list_only": s.is_hit_list_only,
                                "usable_background": s.usable_background,
                                "notes": s.notes,
                                "rationale": s.screen_rationale,
                            }),
                        ),
                    )
                    row = cur.fetchone()
                    if row:
                        screen_uuid[sid] = str(row[0])
                        screens_loaded += 1
            conn.commit()
            checkpoint["screens"] = sorted(done | set(todo[:start + len(chunk)]))
            save()
            print(f"    {min(start + batch, len(todo)):,}/{len(todo):,}")

        # atlas.gene_stats: 87k rows, small enough to load in one pass.
        # median_lfc is left NULL deliberately. ORCS SCORE.1 is a different
        # quantity in every screen, so any median over screens would be a
        # number with no unit, and this column is named for a measurement.
        import pyarrow.parquet as pq

        table = pq.read_table(
            store.dir / atlas_mod.GENE_STATS_NAME,
            columns=["symbol", "n_screens_tested", "n_hits", "hit_rate"],
        )
        syms = table.column("symbol").to_pylist()
        tested = table.column("n_screens_tested").to_pylist()
        nhits = table.column("n_hits").to_pylist()
        rates = table.column("hit_rate").to_pylist()
        threshold = atlas_mod.SETTINGS.artifacts.frequent_hitter_rate
        payload = []
        with conn.cursor() as cur:
            for i, symbol in enumerate(syms):
                resolved = gene_resolution(symbol)
                if not resolved.ok:
                    reject(cur, "", "gene", symbol, resolved,
                           n_rows=max(1, int(tested[i] or 0)))
                    continue
                payload.append(
                    (symbol, resolved.id, tested[i], nhits[i], rates[i] or 0.0,
                     bool(rates[i] is not None and rates[i] > threshold))
                )
            cur.executemany(
                """
                insert into atlas.gene_stats
                  (gene_symbol, ensembl_gene_id, n_screens, n_hits, hit_rate, is_frequent_hitter)
                values (%s, %s, %s, %s, %s, %s)
                on conflict (gene_symbol) do update set
                  ensembl_gene_id = excluded.ensembl_gene_id,
                  n_screens = excluded.n_screens, n_hits = excluded.n_hits,
                  hit_rate = excluded.hit_rate,
                  is_frequent_hitter = excluded.is_frequent_hitter,
                  updated_at = now()
                """,
                payload,
            )
        conn.commit()
        stats_loaded = len(payload)
        checkpoint["gene_stats"] = True
        save()
        print(f"  atlas.gene_stats: {stats_loaded:,} genes")

        n_rows = 0
        if with_rows:
            done_rows = set(checkpoint["rows"])
            todo_rows = [sid for sid in sorted(screens) if sid not in done_rows]
            print(f"  atlas.screen_hits: {len(todo_rows):,} screens to go "
                  f"(this is the several-GB table; see the module docstring)")
            for sid in todo_rows:
                uuid = screen_uuid.get(sid)
                if uuid is None:
                    with conn.cursor() as cur:
                        cur.execute(
                            "select id from atlas.screens where source = 'orcs' "
                            "and source_id = %s", (str(sid),))
                        got = cur.fetchone()
                    if not got:
                        continue
                    uuid = str(got[0])
                tb = pq.read_table(store.screen_rows_path(sid),
                                   columns=["gene_symbol", "is_hit", "score1"])
                g = tb.column("gene_symbol").to_pylist()
                h = tb.column("is_hit").to_pylist()
                s1 = tb.column("score1").to_pylist()
                with conn.cursor() as cur:
                    cur.execute("delete from atlas.screen_hits where screen_id = %s", (uuid,))
                    accepted = []
                    for j in range(len(g)):
                        resolved = gene_resolution(g[j])
                        if resolved.ok:
                            accepted.append((uuid, g[j], resolved.id, h[j], s1[j]))
                        else:
                            reject(cur, str(sid), "gene", g[j], resolved)
                    with cur.copy(
                        "copy atlas.screen_hits "
                        "(screen_id, gene_symbol, ensembl_gene_id, is_hit, score) "
                        "from stdin"
                    ) as cp:
                        for row in accepted:
                            cp.write_row(row)
                conn.commit()
                # Rows the gate refused are ledgered, not loaded, so they must
                # not be counted here: this number is what atlas.screen_hits now
                # holds, and the difference is queryable in the reject ledger.
                n_rows += len(accepted)
                done_rows.add(sid)
                checkpoint["rows"] = sorted(done_rows)
                if len(done_rows) % 50 == 0:
                    save()
                    print(f"    {len(done_rows):,} screens, {n_rows:,} rows")
            save()

        return {"loaded": True, "screens": screens_loaded, "gene_stats": stats_loaded,
                "hit_rows": n_rows}
    except Exception as exc:
        conn.rollback()
        print(f"  Postgres load stopped: {type(exc).__name__}: {str(exc)[:300]}")
        print(f"  Progress is in {checkpoint_path.name}; re-run --postgres to continue.")
        return {"loaded": False, "reason": f"{type(exc).__name__}: {exc}",
                "gene_stats": stats_loaded}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Phase 4: R2
# ---------------------------------------------------------------------------

def phase_r2(store: atlas_mod.AtlasStore, prefix: str, go: bool) -> dict:
    """Sync the store to R2. Objects already present at the same size are skipped."""
    from splicr.r2 import R2Config, client, guess_content_type, upload

    files = sorted(p for p in store.dir.rglob("*") if p.is_file()
                   and not p.name.endswith(".tmp"))
    total = sum(p.stat().st_size for p in files)
    print(f"  {len(files):,} files, {human(total)} under {prefix}/")
    if not go:
        print("  dry run; pass --r2-go to upload")
        return {"uploaded": False, "files": len(files), "bytes": total}

    try:
        cfg = R2Config.from_env()
        s3 = client(cfg)
    except Exception as exc:
        print(f"  R2 is not configured: {type(exc).__name__}: {exc}")
        return {"uploaded": False, "reason": str(exc)}

    sent = skipped = sent_bytes = 0
    for i, path in enumerate(files, 1):
        key = f"{prefix}/{path.relative_to(store.dir).as_posix()}"
        try:
            did, size = upload(s3, cfg.bucket, path, key, guess_content_type(path))
        except Exception as exc:
            print(f"  FAILED {key}: {type(exc).__name__}: {exc}")
            print("  Re-run --r2-go to resume; uploaded objects are skipped by size.")
            return {"uploaded": False, "sent": sent, "reason": str(exc)}
        if did:
            sent += 1
            sent_bytes += size
        else:
            skipped += 1
        if i % 250 == 0:
            print(f"    {i:,}/{len(files):,} ({sent:,} sent, {skipped:,} already there)")
    print(f"  {sent:,} uploaded ({human(sent_bytes)}), {skipped:,} already present")
    return {"uploaded": True, "sent": sent, "skipped": skipped, "bytes": sent_bytes}


# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="Ingest BioGRID ORCS into the Atlas")
    ap.add_argument("--species", default="human")
    ap.add_argument("--archive", help="default: data/references/orcs/orcs-<species>.tar.gz")
    ap.add_argument("--index", help="default: data/references/orcs/index/<species>.index.tab.txt")
    ap.add_argument("--out", help=f"default: {atlas_mod.ATLAS_DIR}")
    ap.add_argument("--limit", type=int, help="ingest only the N smallest screens")
    ap.add_argument("--restart", action="store_true",
                    help="delete written screen files and start the rows phase over")
    ap.add_argument("--rows-only", action="store_true")
    ap.add_argument("--stats-only", action="store_true",
                    help="recompute the statistics from screens already on disk")
    ap.add_argument("--postgres", action="store_true", help="also load Postgres")
    ap.add_argument("--postgres-rows", action="store_true",
                    help="also load the 26M-row atlas.screen_hits table; needs disk")
    ap.add_argument("--postgres-batch", type=int, default=200)
    ap.add_argument("--r2", action="store_true", help="plan an R2 sync of the store")
    ap.add_argument("--r2-go", action="store_true", help="actually upload")
    ap.add_argument("--r2-prefix", default="atlas/orcs")
    args = ap.parse_args()

    archive = Path(args.archive) if args.archive else orcs.archive_path(args.species)
    store = atlas_mod.AtlasStore(
        args.out,
        # The ingestion writes every screen. Leakage filtering is a read-time
        # decision made by splicr.atlas, so applying a policy here would bake
        # one choice into the store and quietly shrink the product's Atlas.
        leakage_policy=None,
    )
    store.dir.mkdir(parents=True, exist_ok=True)

    print(f"ORCS -> Atlas\n  archive {archive}\n  store   {store.dir}")
    if not archive.exists() and not args.stats_only:
        print(f"  archive not found: {archive}")
        print("  Download it with scripts/data/fetch-orcs.sh")
        return 1

    index = orcs.read_index(args.index, args.species)
    release = next(iter(index.values())).release
    print(f"  index   {len(index):,} screens, release {release}")

    report: dict = {"generated_utc": now(), "release": release}

    if not args.stats_only:
        print("\nPhase 1: rows")
        report["rows"] = phase_rows(archive, store, index, args.limit, args.restart)
    else:
        report["rows"] = {"skipped": "this run was --stats-only"}

    if not args.rows_only:
        print("\nPhase 2: stats")
        report["manifest"] = phase_stats(store, index, release, report["rows"])

    if args.postgres:
        print("\nPhase 3: Postgres")
        report["postgres"] = phase_postgres(store, index, args.postgres_rows,
                                            args.postgres_batch)

    if args.r2 or args.r2_go:
        print("\nPhase 4: R2")
        report["r2"] = phase_r2(store, args.r2_prefix, args.r2_go)

    # A run report beside the store, so what happened is recoverable later.
    log = store.dir / "ingest-log.jsonl"
    with log.open("a") as fh:
        fh.write(json.dumps(report, default=str) + "\n")

    print(f"\nDone. Report appended to {log}")
    if not args.rows_only:
        check = atlas_mod.AtlasStore(store.dir)
        reason = check.unavailable_reason()
        print("Atlas readable: " + ("yes" if reason is None else f"NO: {reason}"))
        return 0 if reason is None else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
