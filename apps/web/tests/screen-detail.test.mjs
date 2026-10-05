/* Exercise the real server data loader and the real page with isolated session and
 * database adapters. This verifies the application's own query boundaries and what
 * a reader is shown, not the deployed Supabase RLS policies.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { loadTs, srcPath } from "./helpers/load-ts.mjs";

const screenId = "00000000-0000-4000-8000-000000000001";
const orgId = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";
const cmpId = "00000000-0000-4000-8000-0000000000cc";
const workspace = { isDemo: false, user: { id: "user" }, org: { id: orgId }, role: "member" };

// ---------------------------------------------------------------------------
// The loader
// ---------------------------------------------------------------------------

function harness({ context = workspace, responses = {} } = {}) {
  const queries = [];
  const client = { from(table) {
    const query = { table, filters: [], extra: [], orders: [], range: null, columns: null, options: null };
    queries.push(query);
    const result = () => responses[table] ?? { data: [], error: null, count: 0 };
    // Any builder method is accepted and recorded, so a test can see exactly what
    // was asked. `filters` keeps only equality pairs, which is what the ownership
    // assertions read; everything else lands in `extra`.
    const chain = new Proxy({}, { get(_, method) {
      if (method === "then") return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
      if (method === "maybeSingle") return () => Promise.resolve(result());
      return (...args) => {
        if (method === "eq") query.filters.push([args[0], args[1]]);
        else if (method === "range") query.range = args;
        else if (method === "order") query.orders.push(args);
        else if (method === "select") { query.columns = args[0]; query.options = args[1] ?? null; }
        else if (method !== "limit") query.extra.push([method, ...args]);
        return chain;
      };
    } });
    return chain;
  } };
  const mod = loadTs("lib/data/screen-detail.ts", {
    mocks: {
      "server-only": {},
      "@/lib/data/org": { getCurrentContext: async () => context },
      "@/lib/supabase/server": { createClient: async () => client },
    },
  });
  return { getScreenDetail: mod.getScreenDetail, mod, queries };
}

const present = (extra = {}) => ({
  screens: { data: { id: screenId, current_run_id: runId, name: "Actual screen" }, error: null },
  runs: { data: { id: runId, status: "complete" }, error: null },
  ...extra,
});
const paged = (app) => app.queries.find((q) => q.table === "hits" && !q.options?.head);
const heads = (app) => app.queries.filter((q) => q.table === "hits" && q.options?.head);

test("anonymous contexts never query workspace rows", async () => {
  const app = harness({ context: { user: null, org: null } });
  assert.equal((await app.getScreenDetail(screenId)).status, "not_found");
  assert.equal(app.queries.length, 0);
});

test("invalid identity and unbounded page input are rejected before reads", async () => {
  const app = harness();
  assert.equal((await app.getScreenDetail("scr_demo")).status, "not_found");
  for (const page of [0, -1, 1.5, NaN, Infinity, 10001]) {
    assert.equal((await app.getScreenDetail(screenId, page)).status, "not_found");
  }
  assert.equal(app.queries.length, 0);
});

test("an inaccessible screen cannot trigger hit reads or demo fallback", async () => {
  const app = harness({ responses: { screens: { data: null, error: null } } });
  assert.equal((await app.getScreenDetail(screenId)).status, "not_found");
  assert.equal(app.queries.length, 1);
  assert.deepEqual(app.queries[0].filters, [["id", screenId], ["org_id", orgId]]);
});

test("screen, run and hit queries retain session ownership and run identity", async () => {
  const hit = { id: "actual-hit", gene_symbol: "TP53", chance_real: null };
  const app = harness({ responses: present({ hits: { data: [hit], count: 201, error: null } }) });
  const result = await app.getScreenDetail(screenId, 2);
  assert.equal(result.status, "found");
  assert.equal(result.detail.hits[0], hit);
  assert.equal(result.detail.total, 201);
  assert.deepEqual(app.queries.find((q) => q.table === "runs").filters,
    [["screen_id", screenId], ["org_id", orgId], ["id", runId]]);
  const hits = paged(app);
  assert.deepEqual(hits.filters, [["screen_id", screenId], ["run_id", runId]]);
  assert.deepEqual(hits.range, [100, 199]);
});

test("the default view issues the same statement as before filters existed", async () => {
  const app = harness({ responses: present({ hits: { data: [], count: 0, error: null } }) });
  await app.getScreenDetail(screenId);
  const q = paged(app);
  assert.deepEqual(q.extra, [], "no filter of any kind is added");
  assert.deepEqual(q.orders, [["fdr", { ascending: true, nullsFirst: false }], ["gene_symbol"], ["id"]]);
  assert.match(q.columns, /hit_flags\(flag, severity, message\)/);
  assert.doesNotMatch(q.columns, /!inner/);
});

test("filters, search and sort reach the database exactly, and only the set ones", async () => {
  const app = harness({ responses: present({ hits: { data: [], count: 0, error: null } }) });
  await app.getScreenDetail(screenId, 3, {
    direction: "enriched", maxFdr: 1e-10, flagged: true, q: "KRAS_G", comparison: cmpId, sort: "lfc", dir: "desc",
  });
  const q = paged(app);
  assert.ok(q.filters.some(([k, v]) => k === "direction" && v === "enriched"));
  assert.ok(q.filters.some(([k, v]) => k === "comparison_id" && v === cmpId));
  assert.deepEqual(q.extra.find(([m]) => m === "lte"), ["lte", "fdr", 1e-10], "a tiny threshold is passed exactly");
  assert.deepEqual(q.extra.find(([m]) => m === "ilike"), ["ilike", "gene_symbol", "%KRAS\\_G%"], "an underscore is not a wildcard");
  assert.match(q.columns, /hit_flags!inner\(/, "flagged-only joins on flags");
  assert.deepEqual(q.orders[0], ["lfc", { ascending: false, nullsFirst: false }]);
  assert.deepEqual(q.range, [200, 299]);
  // Ownership never loosens with a filter.
  assert.ok(q.filters.some(([k, v]) => k === "screen_id" && v === screenId));
  assert.ok(q.filters.some(([k, v]) => k === "run_id" && v === runId));
});

test("sorting by gene orders by symbol and nothing else first", async () => {
  const app = harness({ responses: present({ hits: { data: [], count: 0, error: null } }) });
  await app.getScreenDetail(screenId, 1, { direction: null, maxFdr: null, flagged: false, q: "", comparison: null, sort: "gene", dir: "desc" });
  assert.deepEqual(paged(app).orders, [["gene_symbol", { ascending: false }], ["id"]]);
});

test("the run summary counts the whole run, ignores the filter, and stays inside the run", async () => {
  const counts = { depleted: 30, enriched: 12 };
  const app = harness({
    responses: present({ hits: { data: [], count: 3, error: null } }),
  });
  // Head queries all read responses.hits, so answer per query instead.
  const answering = harness({ responses: present() });
  answering.queries.length = 0;
  void counts; void app;
  const custom = harness({ responses: present({ hits: { data: [], count: 7, error: null } }) });
  const result = await custom.getScreenDetail(screenId, 1, { direction: "depleted", maxFdr: 0.01, flagged: false, q: "", comparison: null, sort: "fdr", dir: "asc" });
  assert.equal(result.status, "found");
  assert.equal(result.detail.total, 7, "the filtered count is the paged query's");
  const h = heads(custom);
  assert.equal(h.length, 5);
  for (const q of h) {
    assert.ok(q.filters.some(([k, v]) => k === "screen_id" && v === screenId));
    assert.ok(q.filters.some(([k, v]) => k === "run_id" && v === runId));
    assert.equal(q.options.head, true);
    // None of them carries the reader's filter.
    assert.ok(!q.extra.some(([m, col]) => m === "ilike" || (m === "lte" && col === "fdr" && q.extra.some(([, , v]) => v === 0.01))));
  }
  assert.ok(h.some((q) => q.filters.some(([k, v]) => k === "direction" && v === "depleted")));
  assert.ok(h.some((q) => q.filters.some(([k, v]) => k === "direction" && v === "enriched")));
  assert.ok(h.some((q) => q.extra.some(([m, col, v]) => m === "lt" && col === "fdr" && v === custom.mod.SIGNIFICANT_FDR)));
  assert.ok(h.some((q) => /hit_flags!inner/.test(q.columns)));
  // The candidate count on the summary is flagged-and-significant, so one head
  // query carries both the inner join and the significance threshold, and that
  // threshold is the page's own rather than whatever the reader filtered to.
  assert.ok(h.some((q) =>
    /hit_flags!inner/.test(q.columns)
    && q.extra.some(([m, col, v]) => m === "lt" && col === "fdr" && v === custom.mod.SIGNIFICANT_FDR)));
  assert.equal(result.detail.summary.recorded, 14, "recorded is the two arms together");
});

test("missing current run is unavailable, not an invented empty analysis", async () => {
  const app = harness({ responses: present({ runs: { data: null, error: null } }) });
  assert.equal((await app.getScreenDetail(screenId)).status, "unavailable");
  assert.equal(app.queries.length, 2);
});

test("a genuinely unrun screen has explicit empty evidence", async () => {
  const app = harness({ responses: {
    screens: { data: { id: screenId, current_run_id: null }, error: null },
    runs: { data: null, error: null },
  } });
  const result = await app.getScreenDetail(screenId);
  assert.equal(result.status, "found");
  assert.equal(result.detail.run, null);
  assert.equal(result.detail.hits.length, 0);
  assert.deepEqual(result.detail.summary, { recorded: 0, depleted: 0, enriched: 0, significant: 0, flagged: 0, significantFlagged: 0 });
});

test("database errors return unavailable and never substitute sample rows", async () => {
  for (const failing of ["hits", "run_stages", "comparisons"]) {
    const app = harness({ responses: present({ [failing]: { data: null, error: { code: "42501" } } }) });
    const result = await app.getScreenDetail(screenId);
    assert.equal(result.status, "unavailable", failing);
    assert.equal(result.detail, undefined);
  }
});

// ---------------------------------------------------------------------------
// The query parser
// ---------------------------------------------------------------------------

const hitQuery = loadTs("lib/report/hit-query.ts");

test("the address parses into a safe query, and junk is dropped rather than obeyed", () => {
  const parsed = hitQuery.parseHitQuery({ direction: "enriched", fdr: "0.05", flagged: "1", q: " tp53! ", comparison: cmpId, sort: "lfc", page: "4" });
  assert.deepEqual(parsed, { direction: "enriched", maxFdr: 0.05, flagged: true, q: "tp53", comparison: cmpId, sort: "lfc", dir: "desc", page: 4 });
  const junk = hitQuery.parseHitQuery({ direction: "sideways", fdr: "2", flagged: "yes", q: "'\"<>; ", comparison: "nope", sort: "chance", dir: "up", page: "-1" });
  assert.deepEqual(junk, hitQuery.DEFAULT_HIT_QUERY);
  // Characters a gene symbol cannot contain are removed, so the search stays a plain symbol fragment.
  assert.equal(hitQuery.parseHitQuery({ q: "'; DROP" }).q, "DROP");
  assert.equal(hitQuery.parseHitQuery({ fdr: "0" }).maxFdr, 0, "an FDR of exactly 0 is a real threshold");
  assert.equal(hitQuery.parseHitQuery({ fdr: "1e-10" }).maxFdr, 1e-10);
  assert.equal(hitQuery.parseHitQuery({ fdr: "-0.1" }).maxFdr, null);
  assert.equal(hitQuery.parseHitQuery({ fdr: "abc" }).maxFdr, null);
  assert.equal(hitQuery.parseHitQuery({ q: "x".repeat(200) }).q.length, 40);
});

test("addresses round-trip, and a new filter or sort returns to page one", () => {
  const current = hitQuery.parseHitQuery({ direction: "depleted", fdr: "0.1", q: "rpl", sort: "gene", dir: "desc", page: "3" });
  const href = hitQuery.hitHref("/dashboard/screens/x", current, {});
  const back = hitQuery.parseHitQuery(Object.fromEntries(new URL(href, "http://x").searchParams));
  assert.deepEqual(back, current);
  assert.doesNotMatch(hitQuery.hitHref("/x", current, { flagged: true }), /page=/);
  assert.doesNotMatch(hitQuery.hitHref("/x", current, { sort: "fdr", dir: "asc" }), /page=/);
  assert.match(hitQuery.hitHref("/x", current, { page: 4 }), /page=4/);
  assert.equal(hitQuery.hitHref("/x", hitQuery.DEFAULT_HIT_QUERY, {}), "/x");
  assert.match(hitQuery.hitHref("/x", hitQuery.DEFAULT_HIT_QUERY, { maxFdr: 0.1 }), /fdr=0\.1/);
  assert.equal(hitQuery.isFiltered(hitQuery.DEFAULT_HIT_QUERY), false);
  assert.equal(hitQuery.isFiltered({ ...hitQuery.DEFAULT_HIT_QUERY, flagged: true }), true);
});

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

class NotFound extends Error {}
class Redirected extends Error {
  constructor(to) {
    super(to);
    this.to = to;
  }
}
const ROUTING = new Set(["replace", "scroll", "prefetch"]);
function anchor({ href, children, ...rest }) {
  const dom = Object.fromEntries(Object.entries(rest).filter(([key]) => !ROUTING.has(key)));
  return React.createElement("a", { href, ...dom }, children);
}
const filtersStub = function HitFilters() { return React.createElement("div", { "data-stub": "filters" }); };

const realStore = loadTs("lib/atlas/store.ts", { mocks: { "server-only": {} } });
// The page reads the QC document through this reducer. It is loaded for real so
// the page cannot be shown to work against a shape the loader never produces.
const realDetail = loadTs("lib/data/screen-detail.ts", {
  mocks: {
    "server-only": {},
    "@/lib/data/org": { getCurrentContext: async () => workspace },
    "@/lib/supabase/server": { createClient: async () => ({ from: () => ({}) }) },
  },
});
let sampleReads = 0;
let readArgs = null;

function pageHarness({ context = workspace, result, outcomes = new Map(), atlas = realStore } = {}) {
  sampleReads = 0;
  const mocks = {
    "server-only": {},
    "next/link": { __esModule: true, default: anchor },
    "next/navigation": {
      notFound() { throw new NotFound(); },
      redirect(to) { throw new Redirected(to); },
      usePathname: () => "/dashboard/screens/x",
      useRouter: () => ({ replace() {}, push() {} }),
      useSearchParams: () => new URLSearchParams(),
    },
    "@/components/dashboard/hit-report/filters": { HitFilters: filtersStub },
    "@/components/dashboard/screen-workspace": { ScreenWorkspace: function Sample() { return React.createElement("p", null, "SAMPLE_VIEW"); } },
    "@/lib/data/org": { getCurrentContext: async () => context },
    "@/lib/data/outcomes": { getGeneOutcomes: async () => outcomes },
    "@/lib/atlas/store": atlas,
    "@/lib/data/screen-detail": {
      DETAIL_PAGE_SIZE: 100,
      SIGNIFICANT_FDR: 0.1,
      getScreenDetail: async (...args) => { readArgs = args; return result; },
      // The real reducer: the page must not build its own view of the QC blob.
      qcEvidence: realDetail.qcEvidence,
    },
  };
  Object.defineProperty(mocks, "@/lib/mock/data", { enumerable: true, get() { sampleReads++; return { screens: [{ id: "scr_demo" }] }; } });
  const page = loadTs("app/dashboard/screens/[id]/page.tsx", { mocks }).default;
  return {
    async render(id = screenId, search = {}) {
      return renderToStaticMarkup(await page({ params: Promise.resolve({ id }), searchParams: Promise.resolve(search) }));
    },
  };
}

const summary = { recorded: 1, depleted: 1, enriched: 0, significant: 1, flagged: 0, significantFlagged: 0 };
const found = (over = {}, hitOver = {}) => ({
  status: "found",
  detail: {
    screen: { id: screenId, name: "Actual experiment", modality: "knockout", status: "complete", qc: "pass", cell_line: "A375", phenotype: "ferroptosis", taxid: 9606, description: null },
    run: { id: runId, status: "complete", engine_version: "actual-engine-version", image_digest: null, error: null },
    stages: [], comparisons: [{ id: cmpId, name: "Drug vs vehicle" }], total: 1, page: 1, summary, qc: null,
    hits: [{
      id: "h", comparison_id: cmpId, gene_symbol: "TP53", direction: "enriched", lfc: 0, fdr: 0.00001234, p_value: null,
      bayes_factor: null, n_guides: 4, n_good_guides: 0, chance_real: null, hit_flags: [], guide_lfcs: [0, 1, 2, 3], ...hitOver,
    }],
    ...over,
  },
});

test("real page renders recorded FDR and null confidence without sample substitution", async () => {
  const app = pageHarness({ result: found() });
  const html = await app.render();
  assert.match(html, /Actual experiment/);
  assert.match(html, /1\.23e-5/);
  assert.match(html, /actual-engine-version/);
  assert.match(html, /Not recorded/);
  assert.doesNotMatch(html, /SAMPLE_VIEW|Recorded model output:/);
  assert.equal(sampleReads, 0);
});

test("a measured zero effect is 0, not 'Not recorded', and a missing p-value is the reverse", async () => {
  const html = await pageHarness({ result: found() }).render();
  assert.match(html, /<td class="num-col">0<\/td>/);
  assert.match(html, /<td class="num-col">Not recorded<\/td>/);
});

test("the summary states its denominators and never a validation rate", async () => {
  const html = await pageHarness({
    result: found({ summary: { recorded: 200, depleted: 120, enriched: 80, significant: 37, flagged: 9, significantFlagged: 4 } }),
  }).render();
  // The decision layer: how many candidates, out of what, and how many of them
  // carry a flag. Every figure keeps its denominator.
  assert.match(html, /37/);
  assert.match(html, /At or below FDR 0\.1/);
  assert.match(html, /4 of 37/);
  assert.match(html, /A record with no recorded FDR is not counted/);
  // The size of the run and its two arms are still on the page, on the panel
  // that holds the rows rather than in the largest type above them.
  assert.match(html, /120 depleted and 80 enriched/);
  assert.match(html, /Validation probabilities are not available/);
  assert.doesNotMatch(html, /% validat|likely real|probability of validating:/i);
});

test("Atlas evidence is real, is labelled with its denominator, and is never a made-up rate", async () => {
  const html = await pageHarness({ result: found({}, { gene_symbol: "RPL5" }) }).render();
  const genes = realStore.getAtlasGenes();
  const i = genes.bySymbol.get("RPL5");
  const expected = `${genes.table.hitsBackground[i].toLocaleString("en-US")} of ${genes.table.testedBackground[i].toLocaleString("en-US")}`;
  assert.ok(html.includes(expected), `expected ${expected}`);
  assert.match(html, /Frequent hitter/);
  assert.match(html, /Each screen used its own authors&#x27; rule/);
  assert.match(html, /Called a hit in \d+ of the \d+ background screens that measured it/);
});

test("a gene the Atlas lacks says so, and a mouse screen never gets human evidence", async () => {
  const unknown = await pageHarness({ result: found({}, { gene_symbol: "NOTAGENE99" }) }).render();
  assert.match(unknown, /Not in the Atlas/);
  const mouse = found();
  mouse.detail.screen.taxid = 10090;
  const html = await pageHarness({ result: mouse }).render();
  assert.match(html, /Human Atlas only/);
  assert.doesNotMatch(html, /Frequent hitter/);
});

test("if the Atlas cannot be read the column says 'Not looked up' and the page still renders", async () => {
  const broken = { ...realStore, getAtlasGenes() { throw new Error("snapshot missing"); } };
  const html = await pageHarness({ result: found(), atlas: broken }).render();
  assert.match(html, /Not looked up/);
  assert.match(html, /Actual experiment/);
});

test("artifact flags are shown with their reason, and 'none' does not mean confirmed", async () => {
  const flagged = found({}, { hit_flags: [{ flag: "copy_number", severity: "warn", message: "Amplified region, 5 copies" }] });
  const html = await pageHarness({ result: flagged }).render();
  assert.match(html, /copy number/);
  assert.match(html, /title="Amplified region, 5 copies"/);
  const clean = await pageHarness({ result: found() }).render();
  assert.match(clean, /None recorded/);
});

test("bench status: a logged outcome is a badge, an unlogged gene offers to log one, a viewer is not offered", async () => {
  const outcomes = new Map([["TP53", { id: "o", result: "failed" }]]);
  const withOutcome = await pageHarness({ result: found(), outcomes }).render();
  assert.match(withOutcome, /Did not validate/);
  assert.match(withOutcome, /href="\/dashboard\/validation\?q=TP53&amp;screen=/);
  const empty = await pageHarness({ result: found() }).render();
  assert.match(empty, new RegExp(`href="/dashboard/validation\\?log=TP53&amp;logScreen=${screenId}"`));
  const viewer = await pageHarness({ context: { ...workspace, role: "viewer" }, result: found() }).render();
  assert.doesNotMatch(viewer, /Log outcome/);
  assert.match(viewer, /No outcome/);
  const unknown = await pageHarness({ result: found(), outcomes: null }).render();
  assert.match(unknown, /Not looked up/);
});

test("guide effects are a strip of recorded dots, and agreement counts guides that share the gene's direction", async () => {
  const html = await pageHarness({ result: found({}, { lfc: -1, guide_lfcs: [-1, -2, 0.5, -0.3] }) }).render();
  assert.match(html, /3 of 4 recorded guide effects point the same way as the gene-level effect/);
  const none = await pageHarness({ result: found({}, { guide_lfcs: null }) }).render();
  assert.doesNotMatch(none, /role="img"/);
});

test("filters are passed to the loader from the address, and an empty match says so", async () => {
  const app = pageHarness({ result: found({ hits: [], total: 0 }) });
  const html = await app.render(screenId, { direction: "enriched", fdr: "0.05", q: "kras", sort: "lfc", page: "1" });
  assert.match(html, /No record matches these filters/);
  assert.match(html, /Clear the filters/);
  assert.equal(readArgs[0], screenId);
  assert.equal(readArgs[1], 1);
  assert.deepEqual(readArgs[2], { direction: "enriched", maxFdr: 0.05, flagged: false, q: "kras", comparison: null, sort: "lfc", dir: "desc", page: 1 });
});

test("a run with no records says that is not evidence of no hits", async () => {
  const html = await pageHarness({ result: found({ hits: [], total: 0, summary: { recorded: 0, depleted: 0, enriched: 0, significant: 0, flagged: 0, significantFlagged: 0 } }) }).render();
  assert.match(html, /does not establish that the experiment had no hits/);
});

test("a page past the end goes to the last page that exists", async () => {
  const app = pageHarness({ result: found({ total: 250 }) });
  await assert.rejects(() => app.render(screenId, { page: "9" }), (error) => error instanceof Redirected && error.to.endsWith("?page=3"));
});

test("a screen that has not been run explains itself instead of showing an empty table", async () => {
  const html = await pageHarness({ result: found({ run: null, hits: [], total: 0, stages: [], summary: { recorded: 0, depleted: 0, enriched: 0, significant: 0, flagged: 0, significantFlagged: 0 } }) }).render();
  assert.match(html, /Analysis not recorded/);
  assert.match(html, /says\s+nothing about whether the experiment has hits/);
  assert.doesNotMatch(html, /api\/report/);
});

test("QC failure is announced above the results, with what to do about it", async () => {
  const failed = found();
  failed.detail.screen.qc = "fail";
  failed.detail.qc = {
    verdict: "fail", notes: null, nnmd: -0.2, auroc: 0.52,
    min_replicate_r: 0.9, median_replicate_r: 0.9, bottlenecked_samples: 0,
    metrics: { nnmd: -0.2, nnmd_contrast: "ctrl vs plasmid", samples: [], replicate_correlations: [] },
  };
  const html = await pageHarness({ result: failed }).render();
  assert.match(html, /role="alert"/);
  assert.match(html, /QC failed/);
  // And the alert carries the concern, not just the word.
  assert.match(html, /do not separate|Do not read gene results/i);
});

test("exports are offered for a run and link to the report route", async () => {
  const html = await pageHarness({ result: found() }).render();
  assert.match(html, new RegExp(`href="/api/report/${screenId}\\?format=csv"`));
  assert.match(html, new RegExp(`href="/api/report/${screenId}\\?format=json"`));
});

test("the retired demo marker cannot load sample detail", async () => {
  const app = pageHarness({ context: { ...workspace, isDemo: true }, result: { status: "not_found" } });
  await assert.rejects(() => app.render("scr_demo"), NotFound);
  assert.equal(sampleReads, 0);
});

test("unavailable workspace page names the read failure and contains no sample values", async () => {
  const app = pageHarness({ result: { status: "unavailable" } });
  const html = await app.render();
  assert.match(html, /could not be read/);
  assert.doesNotMatch(html, /SAMPLE_VIEW|TP53|91%/);
  assert.equal(sampleReads, 0);
});

// ---------------------------------------------------------------------------
// Filters and the back button
// ---------------------------------------------------------------------------

test("a filter the reader chose is a step they can go back from", () => {
  const source = fs.readFileSync(srcPath("components/dashboard/hit-report/filters.tsx"), "utf8");
  // Choosing a direction, an FDR, a comparison or the flag checkbox pushes, so
  // Back returns to the view before it instead of leaving the screen.
  assert.match(source, /router\.push\(href, \{ scroll: false \}\)/);
  // The search box is the exception: it fires on a debounce while somebody is
  // typing, and twelve keystrokes must not be twelve history entries.
  assert.match(source, /go\(\{ q: [^}]+\}, true\)/);
  assert.match(source, /replaceText\s*\?\s*router\.replace/);
});

test("sorting and paging are history steps too", () => {
  for (const file of ["components/dashboard/hit-report/table.tsx", "app/dashboard/screens/[id]/page.tsx"]) {
    const source = fs.readFileSync(srcPath(file), "utf8");
    const links = [...source.matchAll(/hitHref\(\s*base(?:Path)?,[\s\S]{0,160}?\/>/g)].map((m) => m[0]);
    for (const link of links) {
      assert.ok(!/\breplace\b/.test(link),
        `a sort or page link in ${file} still replaces the history entry:\n${link}`);
    }
  }
});

test("every filter the address carries reaches the database query", () => {
  const source = fs.readFileSync(srcPath("lib/data/screen-detail.ts"), "utf8");
  // A control that changes the address but not the statement is a control that
  // looks like it worked and did nothing.
  assert.match(source, /if \(query\.direction\) hitsQuery = hitsQuery\.eq\("direction"/);
  assert.match(source, /if \(query\.maxFdr !== null\) hitsQuery = hitsQuery\.lte\("fdr"/);
  assert.match(source, /if \(query\.comparison\) hitsQuery = hitsQuery\.eq\("comparison_id"/);
  assert.match(source, /if \(query\.q !== ""\) hitsQuery = hitsQuery\.ilike\("gene_symbol"/);
  assert.match(source, /query\.flagged \? "hit_flags!inner/);
});

test("run-specific significance threshold controls summary counts", async () => {
  const app = harness({ responses: present({ runs: { data: { id: runId, status: "complete", settings: { fdr_threshold: 0.05 } }, error: null } }) });
  await app.getScreenDetail(screenId);
  const comparisons = heads(app).flatMap((query) => query.extra).filter(([method, column]) => method === "lt" && column === "fdr");
  assert.equal(comparisons.length, 2);
  assert.ok(comparisons.every(([, , value]) => value === 0.05));
});
