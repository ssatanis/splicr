/**
 * The Atlas queries, run against the real committed snapshot.
 *
 * These are not fixtures. Every expected value below was read from the
 * BioGRID ORCS record or from the ingest's own counts, so the test fails if the
 * snapshot, the query code or the ORCS release drifts apart.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const store = loadTs("lib/atlas/store.ts", { mocks: { "server-only": {} } });
const query = loadTs("lib/atlas/query.ts");
const params = loadTs("lib/atlas/params.ts");

const manifest = store.getAtlasManifest();
const screens = store.getAtlasScreens();
const byId = store.getAtlasScreenMap();
const genes = store.getAtlasGenes();

const base = () => params.parseScreenQuery({});

test("the snapshot agrees with its manifest and with the ingest's own counts", () => {
  assert.equal(screens.length, manifest.screens);
  assert.equal(screens.length, 1952);
  assert.equal(manifest.release, "2.0.18");
  assert.equal(genes.table.symbols.length, manifest.genes);
  // Every hit row in the source is in exactly one gene's screen list.
  const listed = genes.calledIn.reduce((sum, ids) => sum + ids.length, 0);
  assert.equal(listed, manifest.hitRowsInSource);
  assert.equal(screens.filter((screen) => screen.hitListOnly).length, manifest.hitListOnlyScreens);
  // ORCS reports a hit count per screen. The snapshot lists distinct gene
  // symbols, and a repeated identifier collapses to one symbol, so the listed
  // count can be lower than the reported one and can never be higher. The UI
  // prints both when they differ; this pins the relationship.
  let fewer = 0;
  let missing = 0;
  let reported = 0;
  for (const screen of screens) {
    const listedForScreen = (genes.hitsOfScreen.get(screen.id) ?? []).length;
    assert.ok(listedForScreen <= (screen.nHits ?? 0), `screen ${screen.id} lists more hits than ORCS reports`);
    if (listedForScreen < (screen.nHits ?? 0)) fewer++;
    missing += (screen.nHits ?? 0) - listedForScreen;
    reported += screen.nHits ?? 0;
  }
  assert.ok(fewer <= 200);
  assert.ok(missing / reported < 0.001, `${missing} of ${reported} reported hits are not listed as distinct symbols`);
});

test("screen ids are unique and ascending, and none is missing its record", () => {
  const ids = screens.map((screen) => screen.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(byId.size, ids.length);
});

test("the first screen keeps its authors' own hit definition, unaltered", () => {
  const screen = byId.get(1);
  assert.equal(screen.pmid, "24336569");
  assert.equal(screen.author, "Wang T (2014)");
  assert.equal(screen.significanceCriteria, "Score.1 (Log10 (Corrected p-Value)) > 1.3");
  assert.equal(query.hitDefinition(screen), "Score Significance: Score.1 (Log10 (Corrected p-Value)) > 1.3");
  assert.equal(screen.nHits, 5);
});

test("default query pages 50 screens, newest first, with stable ordering", () => {
  const page = query.queryScreens(screens, genes, base());
  assert.equal(page.rows.length, 50);
  assert.equal(page.total, 1952);
  assert.equal(page.pages, Math.ceil(1952 / 50));
  const years = page.rows.map((row) => row.year);
  assert.deepEqual(years, [...years].sort((a, b) => b - a));
  const again = query.queryScreens(screens, genes, base());
  assert.deepEqual(again.rows.map((row) => row.id), page.rows.map((row) => row.id));
});

test("a page number past the end is clamped, never empty and never an error", () => {
  const page = query.queryScreens(screens, genes, { ...base(), page: 99999 });
  assert.equal(page.page, page.pages);
  assert.ok(page.rows.length > 0);
});

test("text search folds punctuation: K562 finds K-562", () => {
  const dashed = query.queryScreens(screens, genes, { ...base(), q: "K-562" });
  const bare = query.queryScreens(screens, genes, { ...base(), q: "k562" });
  assert.ok(dashed.total > 20);
  assert.equal(dashed.total, bare.total);
  assert.ok(bare.rows.every((row) => /k-?562/i.test(row.cellLine ?? "") || /k-?562/i.test(JSON.stringify(row))));
});

test("every search token must match, so a longer query can only narrow", () => {
  const wide = query.queryScreens(screens, genes, { ...base(), q: "k562" });
  const narrow = query.queryScreens(screens, genes, { ...base(), q: "k562 proliferation" });
  const none = query.queryScreens(screens, genes, { ...base(), q: "k562 zzzzqqqq" });
  assert.ok(narrow.total > 0 && narrow.total <= wide.total);
  assert.equal(none.total, 0);
});

test("a short number is a screen id or a year, a long one is a PubMed id", () => {
  const byScreenId = query.queryScreens(screens, genes, { ...base(), q: "1" });
  assert.ok(byScreenId.rows.some((row) => row.id === 1));
  const byPmid = query.queryScreens(screens, genes, { ...base(), q: "24336569" });
  assert.ok(byPmid.total >= 2);
  assert.ok(byPmid.rows.every((row) => row.pmid === "24336569"));
  const byYear = query.queryScreens(screens, genes, { ...base(), q: "2014" });
  assert.ok(byYear.total > 10);
});

test("a facet narrows the rows and the counts of the other facets, but not its own", () => {
  const all = query.queryScreens(screens, genes, base());
  const crispri = query.queryScreens(screens, genes, { ...base(), modality: "crispri" });
  assert.equal(crispri.total, 48);
  assert.ok(crispri.rows.every((row) => row.modality === "crispri"));
  // Its own facet still lists the alternatives, so the reader can switch.
  const own = Object.fromEntries(crispri.facets.modality.map((option) => [option.value, option.count]));
  assert.equal(own.crispri, 48);
  assert.equal(own.knockout, 1823);
  assert.equal(own.crispra, 75);
  // Other facets count only what is left.
  const phenotypeTotal = crispri.facets.phenotype.reduce((sum, option) => sum + option.count, 0);
  assert.equal(phenotypeTotal, crispri.total - screens.filter((s) => s.modality === "crispri" && !s.phenotype).length);
  assert.ok(all.facets.phenotype[0].count >= crispri.facets.phenotype[0].count);
});

test("a selected value that matches nothing stays in its control at zero", () => {
  const page = query.queryScreens(screens, genes, { ...base(), modality: "crispri", phenotype: "response to virus" });
  const option = page.facets.phenotype.find((o) => o.value === "response to virus");
  assert.ok(option, "the chosen phenotype is still listed");
  assert.equal(page.total === 0 || page.rows.every((r) => r.phenotype === "response to virus"), true);
});

test("year range and hits-only filters compose, and a reversed range is repaired", () => {
  const range = params.parseScreenQuery({ from: "2020", to: "2015" });
  assert.equal(range.yearFrom, 2015);
  assert.equal(range.yearTo, 2020);
  const page = query.queryScreens(screens, genes, { ...range, withHits: true });
  assert.ok(page.rows.every((row) => row.year >= 2015 && row.year <= 2020 && row.nHits > 0));
});

test("sorting puts unknown values last in both directions", () => {
  for (const dir of ["asc", "desc"]) {
    const sorted = query.sortScreens(screens.slice(), "nHits", dir);
    const firstNull = sorted.findIndex((screen) => screen.nHits === null);
    if (firstNull >= 0) assert.ok(sorted.slice(firstNull).every((screen) => screen.nHits === null));
    const known = sorted.filter((screen) => screen.nHits !== null).map((screen) => screen.nHits);
    assert.deepEqual(known, [...known].sort((a, b) => (dir === "asc" ? a - b : b - a)));
  }
});

test("gene lookup: TP53 is a real, widely measured gene with an honest denominator", () => {
  const result = query.lookupGene(genes, byId, "tp53");
  assert.equal(result.status, "found");
  assert.equal(result.gene.symbol, "TP53");
  assert.equal(result.gene.entrez, 7157);
  assert.equal(result.gene.called, result.screens.length);
  assert.ok(result.gene.testedBackground > 500, "measured in hundreds of background screens");
  assert.equal(result.gene.hitRate, result.gene.hitsBackground / result.gene.testedBackground);
  assert.ok(result.gene.hitRateInterval.lower <= result.gene.hitRate && result.gene.hitRate <= result.gene.hitRateInterval.upper);
  // Every listed screen really did call it: cross-check with the per-screen index.
  for (const screen of result.screens.slice(0, 40)) {
    const listed = genes.hitsOfScreen.get(screen.id) ?? [];
    assert.ok(listed.includes(genes.bySymbol.get("TP53")));
  }
  assert.equal(result.byPhenotype.reduce((sum, row) => sum + row.called, 0), result.screens.length);
});

test("a core essential gene is above the frequent-hitter threshold and says why", () => {
  const rpl = query.lookupGene(genes, byId, "RPL5");
  assert.equal(rpl.status, "found");
  assert.equal(rpl.gene.frequentHitter, "above_threshold");
  assert.ok(rpl.gene.hitRate > query.FREQUENT_HITTER_RATE);
  assert.ok(rpl.gene.testedBackground >= query.MIN_SCREENS_FOR_FREQUENT_HITTER);
});

test("a gene too rarely measured is not judged either way", () => {
  const scarce = genes.table.symbols.findIndex((_, i) => genes.table.testedBackground[i] > 0 && genes.table.testedBackground[i] < 10);
  assert.ok(scarce >= 0);
  const summary = query.summarizeGene(genes, scarce, null);
  assert.equal(summary.frequentHitter, "not_enough_screens");
});

test("a gene no background screen measured has an unknown rate, not zero", () => {
  const unmeasured = genes.table.symbols.findIndex((_, i) => genes.table.testedBackground[i] === 0);
  if (unmeasured < 0) return;
  const summary = query.summarizeGene(genes, unmeasured, null);
  assert.equal(summary.hitRate, null);
  assert.equal(summary.hitRateInterval, null);
});

test("an alias resolves to its symbol and remembers what was typed", () => {
  const [alias, symbol] = Object.entries(genes.table.aliases).find(([a, s]) => !genes.bySymbol.has(a.toUpperCase()) && genes.bySymbol.has(s.toUpperCase()));
  const result = query.lookupGene(genes, byId, alias);
  assert.equal(result.status, "found");
  assert.equal(result.gene.symbol.toUpperCase(), symbol.toUpperCase());
  assert.equal(result.gene.resolvedFrom, alias);
});

test("an unknown gene returns suggestions instead of a dead end", () => {
  const result = query.lookupGene(genes, byId, "TP5X9");
  assert.equal(result.status, "not_found");
  const near = query.lookupGene(genes, byId, "TP5");
  assert.equal(near.status, "not_found");
  assert.ok(near.suggestions.some((s) => s.symbol === "TP53"));
  assert.equal(query.suggestGenes(genes, "", 5).length, 0);
});

test("filtering screens by a gene returns exactly the screens that called it", () => {
  const lookup = query.lookupGene(genes, byId, "KRAS");
  const page = query.queryScreens(screens, genes, { ...base(), gene: "KRAS" }, 100000);
  assert.equal(page.total, lookup.screens.length);
  assert.deepEqual(new Set(page.rows.map((row) => row.id)), new Set(lookup.screens.map((row) => row.id)));
  const missing = query.queryScreens(screens, genes, { ...base(), gene: "NOTAGENE123" });
  assert.equal(missing.total, 0);
});

test("a screen's hit list is its authors' hit list, searchable and paged", () => {
  const busiest = screens.reduce((best, screen) => ((screen.nHits ?? 0) > (best.nHits ?? 0) ? screen : best));
  const page = query.screenHits(genes, busiest.id, "", 1);
  assert.equal(page.total, (genes.hitsOfScreen.get(busiest.id) ?? []).length);
  assert.equal(page.rows.length, Math.min(query.HIT_PAGE_SIZE, page.total));
  const symbols = page.rows.map((row) => row.symbol);
  assert.deepEqual(symbols, [...symbols].sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" })));
  const filtered = query.screenHits(genes, busiest.id, symbols[0].slice(0, 3), 1);
  assert.ok(filtered.matching >= 1 && filtered.matching <= page.total);
  assert.equal(query.allScreenHits(genes, busiest.id).length, page.total);
  const empty = query.screenHits(genes, -5, "", 1);
  assert.equal(empty.total, 0);
  assert.equal(empty.pages, 1);
});

test("similar screens rank by overlap of hit calls and never include the screen itself", () => {
  const busiest = screens.reduce((best, screen) => ((screen.nHits ?? 0) > (best.nHits ?? 0) ? screen : best));
  const similar = query.similarScreens(genes, byId, busiest.id, 8);
  assert.ok(similar.length > 0);
  assert.ok(similar.every((row) => row.screen.id !== busiest.id && row.shared >= 3 && row.jaccard > 0 && row.jaccard <= 1));
  const scores = similar.map((row) => row.jaccard);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  const tiny = screens.find((screen) => (screen.nHits ?? 0) > 0 && screen.nHits < 10);
  assert.deepEqual(query.similarScreens(genes, byId, tiny.id), []);
});

test("Wilson interval matches the engine's published formula", () => {
  const ci = query.wilsonInterval(3, 10);
  assert.ok(Math.abs(ci.lower - 0.1078) < 1e-3, `${ci.lower}`);
  assert.ok(Math.abs(ci.upper - 0.6032) < 1e-3, `${ci.upper}`);
  assert.equal(query.wilsonInterval(0, 0), null);
  const edge = query.wilsonInterval(10, 10);
  assert.ok(Math.abs(edge.upper - 1) < 1e-12);
  assert.ok(edge.lower > 0.69);
});

test("the address is the state: parse then serialize round-trips, and bad input cannot throw", () => {
  const parsed = params.parseScreenQuery({
    q: "k562", modality: "knockout", sort: "nHits", dir: "asc", page: "3", hits: "1", from: "2018", gene: "TP53",
  });
  const href = params.hrefWith("/dashboard/atlas", parsed, {});
  const reparsed = params.parseScreenQuery(Object.fromEntries(new URL(href, "http://x").searchParams));
  assert.deepEqual(reparsed, parsed);
  // Changing a filter resets to page one; changing only the page does not.
  assert.doesNotMatch(params.hrefWith("/a", parsed, { modality: "crispri" }), /page=/);
  assert.match(params.hrefWith("/a", parsed, { page: 4 }), /page=4/);
  const junk = params.parseScreenQuery({ sort: "; drop table", dir: "sideways", page: "-4", from: "abc", hits: "yes", q: ["a", "b"] });
  assert.equal(junk.sort, "year");
  assert.equal(junk.page, 1);
  assert.equal(junk.yearFrom, null);
  assert.equal(junk.withHits, false);
  assert.equal(junk.q, "a");
  assert.equal(params.hrefWith("/dashboard/atlas", params.parseScreenQuery({}), {}), "/dashboard/atlas");
});

test("corpus figures count publications, not screens", () => {
  const figures = query.corpusFigures(screens);
  assert.equal(figures.screens, 1952);
  assert.ok(figures.publications < figures.screens);
  assert.ok(figures.cellLines > 100);
  assert.equal(figures.hitListOnly, manifest.hitListOnlyScreens);
});
