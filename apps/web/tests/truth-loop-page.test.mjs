/**
 * The Truth Loop page, rendered with its real view and real components. Only the
 * data source and the browser router are replaced, so what these tests read is
 * the HTML a reader would get.
 */
import assert from "node:assert/strict";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { loadTs } from "./helpers/load-ts.mjs";

class Redirected extends Error {
  constructor(to) {
    super(to);
    this.to = to;
  }
}

const ROUTING_PROPS = new Set(["replace", "scroll", "prefetch"]);
function anchor({ href, children, ...rest }) {
  const dom = Object.fromEntries(Object.entries(rest).filter(([key]) => !ROUTING_PROPS.has(key)));
  return React.createElement("a", { href, ...dom }, children);
}

const noop = async () => ({ ok: true });
let sampleImports = 0;
let viewCalls = [];

/** A small stand-in for the demonstration fixture, and a count of who asked for it. */
const FIXTURE = {
  screens: [
    { id: "scr_demo", name: "A375 ferroptosis sensitizers", status: "complete" },
    { id: "scr_002", name: "HAP1 essentiality baseline", status: "complete" },
    { id: "scr_005", name: "A screen that failed", status: "failed" },
  ],
  outcomes: [
    { id: "o1", screenId: "scr_demo", gene: "TCP1", predicted: 0.96, result: "validated", assay: "Arrayed KO", loggedAt: "2026-09-28T10:00:00Z", by: "You" },
    { id: "o2", screenId: "scr_demo", gene: "CDC25C", predicted: 0.7, result: "failed", assay: "Competition assay", loggedAt: "2026-09-27T10:00:00Z", by: "You" },
    { id: "o3", screenId: "scr_002", gene: "ZEB1", predicted: 0.6, result: "inconclusive", assay: "Arrayed KO", loggedAt: "2026-09-20T10:00:00Z", by: "R. Alvarez" },
  ],
};

function pageHarness({ context, view }) {
  sampleImports = 0;
  viewCalls = [];
  const mocks = {
    get "@/lib/mock/data"() {
      sampleImports++;
      return FIXTURE;
    },
    "server-only": {},
    "next/link": { __esModule: true, default: anchor },
    "next/navigation": {
      redirect: (to) => { throw new Redirected(to); },
      useRouter: () => ({ replace() {}, push() {} }),
      usePathname: () => "/dashboard/validation",
    },
    "@/lib/data/org": { getCurrentContext: async () => context },
    "@/lib/data/outcome-actions": { logOutcome: noop, updateOutcome: noop, deleteOutcome: noop },
    "@/lib/data/outcomes": { getOutcomeView: async (filters) => { viewCalls.push(filters); return view; } },
  };
  // The page reaches the fixture with a dynamic import(); compiled to CommonJS
  // that is a require, so the getter above sees exactly when it is asked for.
  return loadTs("app/dashboard/validation/page.tsx", { mocks }).default;
}

const row = (over = {}) => ({
  id: "o1", screenId: "s1", screenName: "RSL3 screen", gene: "TP53", result: "validated", assay: "Arrayed KO",
  effectSize: null, nGuides: null, predicted: null, modelVersion: null, notes: null, evidenceUrl: null,
  loggedAt: "2026-09-01T10:00:00Z", loggedBy: "You", hitLinked: true, ...over,
});

const ready = (over = {}) => ({
  status: "ready", rows: [row()], total: 1, page: 1,
  counts: { validated: 1, failed: 0, inconclusive: 0, pending: 0, total: 1 },
  screens: [{ id: "s1", name: "RSL3 screen" }], canWrite: true, canDelete: false, currentUserId: "u1", ...over,
});

const workspace = { isDemo: false, user: { id: "u1" }, org: { id: "org" }, role: "member" };
const render = async (page, search = {}) =>
  renderToStaticMarkup(await page({ searchParams: Promise.resolve(search) }));

test("a workspace shows its own outcomes with the four results kept apart", async () => {
  const rows = [
    row({ id: "a", gene: "TP53", result: "validated", effectSize: 0, predicted: 0.912 }),
    row({ id: "b", gene: "KRAS", result: "failed" }),
    row({ id: "c", gene: "MYC", result: "inconclusive" }),
    row({ id: "d", gene: "EGFR", result: "pending" }),
  ];
  const html = await render(
    pageHarness({ context: workspace, view: ready({ rows, total: 4, counts: { validated: 1, failed: 1, inconclusive: 1, pending: 1, total: 4 } }) }),
  );
  for (const word of ["Validated at the bench", "Did not validate", "Inconclusive", "Still at the bench"]) {
    assert.match(html, new RegExp(word));
  }
  assert.doesNotMatch(html, /Artifact|Uncertain/);
  // A measured zero prints as 0; an unmeasured effect prints as not recorded.
  assert.match(html, /<td class="num-col">0<\/td>/);
  assert.match(html, /Not recorded/);
  assert.match(html, /0\.912/);
  // One decided pair is a rate over 2, and pending and inconclusive are outside it.
  assert.match(html, /50% of decided outcomes validated: 1 of 2/);
  assert.match(html, /of 2 decided/);
  assert.doesNotMatch(html, /Sample workspace|invented/);
  assert.equal(sampleImports, 0);
  assert.match(html, /No model is retrained from them/);
});

test("nothing decided means no rate is printed", async () => {
  const html = await render(
    pageHarness({ context: workspace, view: ready({ rows: [row({ result: "pending" })], counts: { validated: 0, failed: 0, inconclusive: 0, pending: 1, total: 1 } }) }),
  );
  assert.match(html, /Nothing has been decided yet, so no validation rate is stated/);
  assert.doesNotMatch(html, /% of decided outcomes validated/);
});

test("an empty workspace explains itself and offers the first step to a member", async () => {
  const html = await render(pageHarness({ context: workspace, view: ready({ rows: [], total: 0, counts: { validated: 0, failed: 0, inconclusive: 0, pending: 0, total: 0 } }) }));
  assert.match(html, /No outcome has been recorded yet/);
  assert.match(html, /Log the first outcome/);
});

test("filters that match nothing say so and can be cleared", async () => {
  const html = await render(
    pageHarness({ context: workspace, view: ready({ rows: [], total: 0 }) }),
    { result: "failed", q: "zzz" },
  );
  assert.match(html, /No outcome matches these filters/);
  assert.match(html, /Clear the filters/);
  assert.deepEqual(viewCalls[0], { result: "failed", screen: null, q: "zzz", page: 1 });
});

test("a viewer can read outcomes but is not offered a way to write them", async () => {
  const html = await render(
    pageHarness({ context: { ...workspace, role: "viewer" }, view: ready({ canWrite: false, canDelete: false }) }),
  );
  assert.match(html, /Read-only role/);
  assert.doesNotMatch(html, /Log an outcome/);
  assert.doesNotMatch(html, /open to amend/);
  assert.match(html, /TP53/);
});

test("a failed read is named, and is never shown as an empty workspace or as sample data", async () => {
  for (const status of ["unavailable", "workspace_required"]) {
    const html = await render(pageHarness({ context: workspace, view: { status } }));
    assert.match(html, status === "unavailable" ? /could not be read/ : /Sign in to an account with an active workspace/);
    assert.doesNotMatch(html, /No outcome has been recorded|invented|Sample workspace/);
    assert.equal(sampleImports, 0);
  }
});

test("a page past the end goes to the last page that exists", async () => {
  const page = pageHarness({ context: workspace, view: ready({ total: 120 }) });
  await assert.rejects(() => render(page, { page: "9" }), (error) => error instanceof Redirected && error.to === "/dashboard/validation?page=3");
});

test("a link from a hit opens the form already filled in, for a member only", async () => {
  const member = await render(pageHarness({ context: workspace, view: ready() }), { log: "KRAS", logScreen: "s1" });
  assert.match(member, /role="dialog"/);
  assert.match(member, /Log an outcome/);
  assert.match(member, /value="KRAS"/);
  const viewer = await render(pageHarness({ context: { ...workspace, role: "viewer" }, view: ready({ canWrite: false }) }), { log: "KRAS" });
  assert.doesNotMatch(viewer, /role="dialog"/);
  // A hostile symbol in the link does not open anything.
  const hostile = await render(pageHarness({ context: workspace, view: ready() }), { log: '"><script>alert(1)</script>' });
  assert.doesNotMatch(hostile, /role="dialog"|<script>alert/);
});

test("a stored score is labelled as model output, not a probability", async () => {
  const html = await render(pageHarness({ context: workspace, view: ready({ rows: [row({ predicted: 0.5 })] }) }));
  assert.match(html, /Uncalibrated model output stored when the gene was called\. Not a probability\./);
  assert.match(html, /Score then/);
  assert.doesNotMatch(html, /50%\s*(chance|probability)/i);
});

test("an evidence link opens safely in a new tab and is announced as such", async () => {
  const html = await render(pageHarness({ context: workspace, view: ready({ rows: [row({ evidenceUrl: "https://example.org/nb/1" })] }) }));
  assert.match(html, /href="https:\/\/example\.org\/nb\/1"/);
  assert.match(html, /rel="noreferrer noopener"/);
  assert.match(html, /opens in a new tab/);
});

test("the CSV of outcomes keeps the four results, defuses formulas and labels the score", () => {
  const csv = loadTs("lib/outcomes/csv.ts");
  const out = csv.outcomesCsv(
    [
      row({ id: "a", gene: "TP53", predicted: 0.912, effectSize: 0, notes: "=1+1" }),
      row({ id: "b", gene: "KRAS", result: "pending", assay: null }),
    ],
    { filters: { result: null, screen: null, q: "", page: 1 }, generatedAt: new Date("2026-09-29T00:00:00Z"), sample: false },
  );
  assert.match(out, /# recorded_model_score: the uncalibrated model output/);
  assert.match(out, /does not change any score or retrain any model/);
  assert.doesNotMatch(out, /SAMPLE DATA/);
  const lines = out.replace(/^﻿/, "").trimEnd().split("\r\n");
  const header = lines.findIndex((line) => line.startsWith("outcome_id,"));
  assert.equal(lines.length - header - 1, 2);
  assert.match(lines[header + 1], /"'=1\+1"/);
  assert.match(lines[header + 1], /,0,0\.912,/, "a zero effect and the score are numbers, not text");
  assert.match(lines[header + 2], /"pending"/);
  const sample = csv.outcomesCsv([], { filters: { result: "failed", screen: null, q: "", page: 1 }, generatedAt: new Date(), sample: true });
  assert.match(sample, /SAMPLE DATA/);
  assert.match(sample, /filters: result = failed/);
});

const demoContext = { isDemo: true, user: null, org: null, role: null };

test("the demonstration is the only path that touches the fixture, and it says so", async () => {
  const html = await render(pageHarness({ context: demoContext, view: { status: "unavailable" } }));
  assert.equal(sampleImports, 1);
  assert.equal(viewCalls.length, 0, "the demonstration never queries a workspace");
  assert.match(html, /Sample workspace\. These outcomes are invented/);
  assert.match(html, /TCP1/);
  assert.match(html, /A375 ferroptosis sensitizers/);
  assert.match(html, /nothing is saved when you leave the page/);
  // 1 validated, 1 failed, 1 inconclusive: half of the two decided.
  assert.match(html, /50% of decided outcomes validated: 1 of 2/);
  assert.match(html, /Log an outcome/);
  // A screen that failed cannot have outcomes logged against it.
  assert.doesNotMatch(html, /A screen that failed/);
});

test("a workspace never reads the fixture, whatever its state", async () => {
  for (const view of [ready(), { status: "unavailable" }, { status: "workspace_required" }]) {
    await render(pageHarness({ context: workspace, view }));
    assert.equal(sampleImports, 0);
  }
});

test("demonstration filters use the same address as a workspace", async () => {
  const html = await render(pageHarness({ context: demoContext, view: { status: "unavailable" } }), { result: "failed" });
  assert.match(html, /CDC25C/);
  assert.doesNotMatch(html, /TCP1|ZEB1/);
  // The tiles still count every result, so choosing one does not hide the others.
  assert.match(html, /Validated/);
  assert.match(html, /1 matches?/);
  const byGene = await render(pageHarness({ context: demoContext, view: { status: "unavailable" } }), { q: "zeb" });
  assert.match(byGene, /ZEB1/);
  assert.doesNotMatch(byGene, /TCP1/);
});
