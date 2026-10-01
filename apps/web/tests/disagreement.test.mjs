/* The guide-disagreement deep dive: the contract with the engine, the query
 * boundaries, the route's status codes, and what each component is allowed to say.
 *
 * Two things these tests are really guarding.
 *
 * First, the contract. The console renders a document the engine computed; it does
 * not recompute the statistics. So the TypeScript types have to cover the schema
 * the pydantic model publishes, and a field added on one side without the other
 * has to fail here rather than render as `undefined` in a researcher's drawer.
 *
 * Second, the claims. An earlier version of this drawer printed a "Bonferroni p"
 * computed as the smallest guide p-value times the guide count, let the reader
 * untick guides until the number moved, and read its entire contents out of a
 * hard-coded fixture. The assertions below are written so that none of those can
 * come back.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { loadTs, srcPath } from "./helpers/load-ts.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const schema = JSON.parse(fs.readFileSync(srcPath("lib/data/disagreement.schema.json"), "utf8"));

const screenId = "00000000-0000-4000-8000-000000000001";
const orgId = "00000000-0000-4000-8000-000000000002";
const cmpId = "00000000-0000-4000-8000-0000000000cc";
const workspace = { isDemo: false, user: { id: "user" }, org: { id: orgId }, role: "member" };

/** A report shaped exactly as the engine serialises one. */
function report(overrides = {}) {
  return {
    gene_symbol: "PARP1",
    ensembl_gene_id: "ENSG00000143799",
    uniprot_accession: "P09874",
    mane_transcript: "ENST00000366794",
    n_residues: 1014,
    n_guides: 4,
    mean_log2_fold_change: -0.8,
    median_log2_fold_change: -0.2,
    n_depleting: 1,
    depletion_lfc: -0.5,
    spread: 1.36,
    spread_vs_screen: 2.4,
    spread_baseline_n_genes: 18211,
    discordant: true,
    leave_one_out_min: -1.05,
    leave_one_out_max: -0.13,
    fragile: true,
    pivotal_guide: "s_01",
    guides: [
      guide({ guide_key: "s_01", log2_fold_change: -2.84, residual: -2.04, depleted: true,
              protein_residue: 988, cds_fraction: 0.974, features_hit: ["PARP catalytic domain"],
              annotation_evidence: "curated", p_value: 0.0002 }),
      guide({ guide_key: "s_02", log2_fold_change: -0.12, residual: 0.68,
              protein_residue: 45, cds_fraction: 0.044,
              features_hit: ["Zinc finger PARP-type 1"], annotation_evidence: "curated" }),
      guide({ guide_key: "s_03", log2_fold_change: 0.03, residual: 0.83,
              protein_residue: 412, cds_fraction: 0.406, annotation_evidence: "cds_only",
              note: "the residue resolved; no curated UniProt feature covers it" }),
      guide({ guide_key: "s_04", log2_fold_change: -0.27, residual: 0.53,
              note: "the library records no verified cut position" }),
    ],
    concordance: {
      status: "shared_feature",
      feature: "PARP catalytic domain",
      n_depleting_annotated: 1,
      n_other_annotated: 2,
      fisher_p: 0.333333,
      fisher_p_floor: 0.333333,
      interpretation: "Every guide that depleted cuts PARP catalytic domain and none of the "
        + "2 that did not deplete cuts it. That is consistent with the effect depending on "
        + "this region. It does not establish it: with 3 annotated guides the smallest "
        + "two-sided Fisher p this table could reach is 0.333.",
      confound: "Guides cutting the same region share chromatin state, copy number, exon and "
        + "off-target neighbourhood, so their fold changes are correlated for reasons "
        + "independent of the annotated feature. The table treats them as independent and "
        + "therefore overstates the evidence.",
    },
    summary: "PARP1: mean log2 fold change -0.80 over 4 guides (not depleting); 1 of 4 deplete "
      + "individually. The call is fragile: dropping s_01 moves the mean to -0.13, across the "
      + "-0.5 threshold.",
    provenance: {
      coordinate_system: "1-based residue index of the MANE Select transcript",
      reference_versions: { assembly: "GRCh38", ensembl: "116" },
      measurement_source: "MAGeCK sgRNA summary for this comparison",
      annotated_at: "2026-09-30T18:00:00+00:00",
    },
    ...overrides,
  };
}

function guide(overrides = {}) {
  return {
    guide_key: "g", gene: "PARP1", sequence: "ACGTACGTACGTACGTACGT",
    log2_fold_change: 0, residual: 0, depleted: false,
    p_value: null, fdr: null, chromosome: "1", cut_position: 1000, strand: "+",
    measured_efficacy: null, efficacy_source: null, control_mean: null, treatment_mean: null,
    uniprot_accession: "P09874", mane_transcript: "ENST00000366794", n_residues: 1014,
    protein_residue: null, cds_fraction: null, in_last_exon: false,
    features_hit: [], annotation_evidence: "none", note: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The contract with the engine
// ---------------------------------------------------------------------------

test("the committed schema is the one the engine's model publishes", () => {
  // Regenerated by: python -m splicr schema disagreement. Running it here means a
  // model change with no regeneration fails in CI rather than at a reader's screen.
  const python = path.join(root, "engine/.tools/env/bin/python");
  if (!fs.existsSync(python)) {
    // The engine environment is not installed in every checkout; the Python test
    // suite covers the same assertion from its own side.
    return;
  }
  const printed = execFileSync(python, ["-m", "splicr", "schema", "disagreement"], {
    cwd: path.join(root, "engine"), encoding: "utf8",
  });
  assert.deepEqual(JSON.parse(printed), schema,
    "apps/web/src/lib/data/disagreement.schema.json is stale; regenerate it");
});

test("every required field of the schema is named in the TypeScript type", () => {
  const source = fs.readFileSync(srcPath("lib/data/disagreement.ts"), "utf8");
  const block = (name) => {
    const at = source.indexOf(`export interface ${name} {`);
    assert.ok(at > 0, `interface ${name} is missing`);
    return source.slice(at, source.indexOf("\n}", at));
  };
  const check = (defName, interfaceName) => {
    const def = defName === "root" ? schema : schema.$defs[defName];
    assert.ok(def, `${defName} is not in the schema`);
    const text = block(interfaceName);
    for (const field of def.required ?? []) {
      assert.match(text, new RegExp(`\\b${field}\\b`),
        `${interfaceName} does not declare ${field}, which the schema requires`);
    }
    // And nothing is declared that the schema does not have, so a field cannot be
    // read in the console that the engine never sends.
    const declared = [...text.matchAll(/^\s{2}(\w+)[?]?:/gm)].map((m) => m[1]);
    for (const field of declared) {
      assert.ok(Object.hasOwn(def.properties ?? {}, field),
        `${interfaceName} declares ${field}, which the schema does not define`);
    }
  };
  check("root", "DisagreementReport");
  check("GuideEvidence", "GuideEvidence");
  check("Concordance", "Concordance");
  check("Provenance", "Provenance");
});

test("the concordance status values are the engine's, exactly", () => {
  const source = fs.readFileSync(srcPath("lib/data/disagreement.ts"), "utf8");
  const allowed = schema.$defs.Concordance.properties.status.enum;
  assert.ok(Array.isArray(allowed) && allowed.length > 0);
  for (const value of allowed) assert.match(source, new RegExp(`"${value}"`));
  // not_evaluated and no_features are different facts and must both survive.
  assert.ok(allowed.includes("not_evaluated"));
  assert.ok(allowed.includes("no_features"));
});

// ---------------------------------------------------------------------------
// The loader's query boundaries
// ---------------------------------------------------------------------------

function harness({ context = workspace, responses = {}, rpc = null } = {}) {
  const queries = [];
  const rpcCalls = [];
  const client = {
    rpc(name, args) {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpc ?? { data: null, error: { message: "no rpc configured" } });
    },
    from(table) {
    const query = { table, filters: [], orders: [], columns: null, options: null };
    queries.push(query);
    const result = () => responses[table] ?? { data: [], error: null, count: 0 };
    const chain = new Proxy({}, { get(_, method) {
      if (method === "then") return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
      if (method === "maybeSingle") return () => Promise.resolve(result());
      return (...args) => {
        if (method === "eq") query.filters.push([args[0], args[1]]);
        else if (method === "order") query.orders.push(args);
        else if (method === "select") { query.columns = args[0]; query.options = args[1] ?? null; }
        return chain;
      };
    } });
      return chain;
    },
  };
  const mod = loadTs("lib/data/disagreement.ts", {
    mocks: {
      "server-only": {},
      "@/lib/data/org": { getCurrentContext: async () => context },
      "@/lib/supabase/server": { createClient: async () => client },
    },
  });
  return { ...mod, queries, rpcCalls };
}

test("a signed-out session never reads a workspace report", async () => {
  const app = harness({ context: { user: null, org: null } });
  assert.equal((await app.getGeneDisagreement(screenId, "PARP1")).status, "not_found");
  assert.equal(app.queries.length, 0);
});

test("a screen another workspace owns is not found, and no report read follows", async () => {
  const app = harness({ responses: { screens: { data: null, error: null } } });
  assert.equal((await app.getGeneDisagreement(screenId, "PARP1")).status, "not_found");
  assert.equal(app.queries.length, 1, "ownership is checked before the report is read");
  assert.deepEqual(app.queries[0].filters, [["id", screenId], ["org_id", orgId]]);
});

test("a malformed screen id or an empty symbol is refused before any read", async () => {
  const app = harness();
  for (const [id, gene] of [["scr_demo", "PARP1"], [screenId, ""], [screenId, "!!!"]]) {
    assert.equal((await app.getGeneDisagreement(id, gene)).status, "not_found");
  }
  assert.equal(app.queries.length, 0);
});

test("a gene symbol reaching the query is reduced to symbol characters", async () => {
  const app = harness({
    responses: {
      screens: { data: { id: screenId }, error: null },
      gene_disagreement: { data: { report: report(), created_at: "2026-09-30T18:00:00Z" }, error: null },
    },
  });
  // A wildcard or PostgREST operator in the symbol must not survive.
  await app.getGeneDisagreement(screenId, " parp1*,or(x) ");
  const read = app.queries.find((q) => q.table === "gene_disagreement");
  assert.deepEqual(
    read.filters,
    [["screen_id", screenId], ["gene_symbol", "PARP1ORX"], ["schema_version", "1"]],
  );
});

test("a run that stored no reports is not analysed; a gene that has none is missing one", async () => {
  const stored = { data: null, error: null, count: 0 };
  const none = harness({
    responses: { screens: { data: { id: screenId }, error: null }, gene_disagreement: stored },
  });
  assert.equal((await none.getGeneDisagreement(screenId, "PARP1")).status, "not_analysed");

  // Same missing row, but the screen does hold reports for other genes.
  const some = harness({
    responses: {
      screens: { data: { id: screenId }, error: null },
      gene_disagreement: { data: null, error: null, count: 1284 },
    },
  });
  const result = await some.getGeneDisagreement(screenId, "PARP1");
  assert.equal(result.status, "no_report");
  assert.equal(result.gene, "PARP1");
});

test("a read failure is unavailable, never an empty report", async () => {
  const app = harness({
    responses: {
      screens: { data: { id: screenId }, error: null },
      gene_disagreement: { data: null, error: { message: "connection reset" } },
    },
  });
  assert.equal((await app.getGeneDisagreement(screenId, "PARP1")).status, "unavailable");
});

test("a document that is not a report is unavailable rather than rendered", async () => {
  const app = harness({
    responses: {
      screens: { data: { id: screenId }, error: null },
      gene_disagreement: { data: { report: { gene_symbol: "PARP1" }, created_at: null }, error: null },
    },
  });
  assert.equal((await app.getGeneDisagreement(screenId, "PARP1")).status, "unavailable");
});

test("a stored report is returned with the time it was recorded", async () => {
  const app = harness({
    responses: {
      screens: { data: { id: screenId }, error: null },
      gene_disagreement: { data: { report: report(), created_at: "2026-09-30T18:00:00Z" }, error: null },
    },
  });
  const result = await app.getGeneDisagreement(screenId, "parp1");
  assert.equal(result.status, "found");
  assert.equal(result.report.gene_symbol, "PARP1");
  assert.equal(result.recordedAt, "2026-09-30T18:00:00Z");
});

test("effect points carry every recorded value, nulls included", async () => {
  const app = harness({
    rpc: {
      data: {
        recorded: 3,
        without_effect: 7,
        gene: ["ACTB", "PARG", "PARP1"],
        lfc: [0.04, 3.4051, -2.31],
        // A null FDR stays null. It is not 1, it is not 0, and it is not dropped.
        fdr: [null, 0.0062, 0.00018],
        // Bit 1 report exists, bit 2 fragile, bit 4 discordant.
        marks: [0, 1, 3],
      },
      error: null,
    },
  });
  const result = await app.getEffectPoints(screenId, cmpId);
  assert.equal(result.status, "found");
  assert.deepEqual(result.series.gene, ["ACTB", "PARG", "PARP1"]);
  assert.deepEqual(result.series.fdr, [null, 0.0062, 0.00018]);
  assert.deepEqual(result.series.marks, [0, 1, 3]);
  assert.equal(result.series.recorded, 3);
  // Genes with no recorded effect cannot be placed, and the count says so
  // rather than the plot quietly calling 3 the whole comparison.
  assert.equal(result.series.withoutEffect, 7);

  // The read goes through the function, not the hits collection: PostgREST caps
  // a collection at a thousand rows and silently returned the first thousand
  // gene symbols alphabetically, which is how a run with eleven significant
  // genes plotted none of them.
  assert.equal(app.queries.length, 0);
  assert.deepEqual(app.rpcCalls, [
    { name: "screen_effect_points", args: { p_screen: screenId, p_comparison: cmpId } },
  ]);
});

test("a payload whose arrays disagree in length is unavailable, not half a plot", async () => {
  for (const data of [
    { recorded: 2, without_effect: 0, gene: ["A", "B"], lfc: [1], fdr: [0.1, 0.2], marks: [0, 0] },
    { recorded: 1, without_effect: 0, gene: ["A"], lfc: [1], fdr: [0.1] },
    null,
  ]) {
    const app = harness({ rpc: { data, error: null } });
    assert.equal((await app.getEffectPoints(screenId, cmpId)).status, "unavailable");
  }
});

test("a read failure is unavailable, never an empty comparison", async () => {
  const app = harness({ rpc: { data: null, error: { message: "connection reset" } } });
  assert.equal((await app.getEffectPoints(screenId, cmpId)).status, "unavailable");
});

test("effect points are unavailable for a malformed id", async () => {
  const app = harness();
  assert.equal((await app.getEffectPoints("nope", cmpId)).status, "unavailable");
  assert.equal(app.queries.length, 0);
  assert.equal(app.rpcCalls.length, 0);
});

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

function route({ context = workspace, result }) {
  return loadTs("app/api/v1/screens/[screenId]/genes/[gene]/disagreement/route.ts", {
    mocks: {
      "next/server": {
        NextResponse: {
          json: (body, init) => ({ body, status: init?.status ?? 200, headers: init?.headers ?? {} }),
        },
      },
      "@/lib/data/disagreement": {
        getGeneDisagreement: async () => result,
        normaliseSymbol: (gene) => gene.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, ""),
      },
      "@/lib/data/org": { getCurrentContext: async () => context },
      "@/lib/data/types": { isUuid: (value) => /^[0-9a-f-]{36}$/i.test(value) },
    },
  });
}

const call = (mod, screen = screenId, gene = "PARP1") =>
  mod.GET(new Request("http://test/"), { params: Promise.resolve({ screenId: screen, gene }) });

test("the route answers a distinct status for every outcome", async () => {
  const cases = [
    [{ status: "found", report: report(), recordedAt: "2026-09-30T18:00:00Z" }, 200],
    [{ status: "no_report", gene: "PARP1" }, 409],
    [{ status: "not_analysed" }, 409],
    [{ status: "not_found" }, 404],
    [{ status: "unavailable" }, 503],
  ];
  for (const [result, status] of cases) {
    const response = await call(route({ result }));
    assert.equal(response.status, status, JSON.stringify(result));
  }
});

test("the two 409s say different things, and neither says the guides agreed", async () => {
  const missing = await call(route({ result: { status: "no_report", gene: "PARP1" } }));
  const never = await call(route({ result: { status: "not_analysed" } }));
  assert.match(missing.body.error, /PARP1 has no recorded/);
  assert.match(missing.body.reason, /at least two guides/);
  assert.match(never.body.error, /no recorded guide-disagreement reports/);
  assert.match(never.body.reason, /Re-run the comparison/);
  // Saying "this says nothing about whether the guides agreed" is the point. What
  // is forbidden is the positive claim: an absent report must never read as a
  // finding that the guides agreed.
  for (const response of [missing, never]) {
    const body = JSON.stringify(response.body);
    assert.doesNotMatch(body, /no disagreement (was )?(found|detected)/i);
    // Mentioning agreement is allowed only inside the disclaimer. A bare
    // assertion that the guides agreed is the thing this must never become.
    for (const sentence of body.split(/(?<=\.)\s+/)) {
      if (!/\bagree/i.test(sentence)) continue;
      assert.match(sentence, /says nothing about/,
        `an absent report must not assert agreement: ${sentence}`);
    }
  }
});

test("a bad screen id and an empty symbol are 400s that name the problem", async () => {
  const bad = await call(route({ result: { status: "not_found" } }), "scr_demo");
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /screenId must be a screen id/);
  const empty = await call(route({ result: { status: "not_found" } }), screenId, "!!!");
  assert.equal(empty.status, 400);
  assert.match(empty.body.error, /gene must be a gene symbol/);
});

test("a demo or signed-out session gets 401 and the report is never read", async () => {
  let read = 0;
  const mod = loadTs("app/api/v1/screens/[screenId]/genes/[gene]/disagreement/route.ts", {
    mocks: {
      "next/server": { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
      "@/lib/data/disagreement": {
        getGeneDisagreement: async () => { read += 1; return { status: "not_found" }; },
        normaliseSymbol: (gene) => gene.toUpperCase(),
      },
      "@/lib/data/org": { getCurrentContext: async () => ({ isDemo: true, user: null, org: null }) },
      "@/lib/data/types": { isUuid: () => true },
    },
  });
  const response = await call(mod);
  assert.equal(response.status, 401);
  assert.equal(read, 0);
});

test("a served report is cached privately, never in a shared cache", async () => {
  const response = await call(route({
    result: { status: "found", report: report(), recordedAt: null },
  }));
  assert.match(response.headers["cache-control"], /^private,/);
});

// ---------------------------------------------------------------------------
// What the components are allowed to say
// ---------------------------------------------------------------------------

function render(component, props) {
  return renderToStaticMarkup(React.createElement(component, props));
}

function ui(file) {
  return loadTs(file, {
    mocks: {
      react: React,
      "lucide-react": new Proxy({}, { get: () => () => null }),
      "next/script": { default: () => null },
      "pdbe-molstar/build/pdbe-molstar-light.css": {},
    },
  });
}

test("the drawer renders the engine's sentence and every denominator behind it", () => {
  const { GeneDrawer } = ui("components/dashboard/evidence/gene-drawer.tsx");
  const html = render(GeneDrawer, {
    state: { kind: "found", gene: "PARP1", report: report(), recordedAt: "2026-09-30T18:00:00Z" },
    screenName: "Olaparib in HeLa",
    onClose: () => {},
  });
  assert.ok(html.includes(report().summary), "the engine's own sentence is shown verbatim");
  // Each fact carries the denominator it is a fraction of.
  assert.match(html, /1 deplete individually/);
  assert.match(html, /18211 genes|18,211 genes/);
  assert.match(html, /median -0\.20/);
  assert.match(html, /-1\.05 to -0\.13/);
  // Provenance, not decoration.
  assert.match(html, /MANE Select transcript/);
  assert.match(html, /assembly GRCh38/);
  assert.match(html, /ensembl 116/);
});

test("the drawer invents no statistic and offers no way to move one", () => {
  const { GeneDrawer } = ui("components/dashboard/evidence/gene-drawer.tsx");
  const html = render(GeneDrawer, {
    state: { kind: "found", gene: "PARP1", report: report(), recordedAt: null },
    screenName: "s", onClose: () => {},
  });
  // The removed feature: a gene-level p-value assembled from guide p-values, and
  // checkboxes that recomputed an aggregate as the reader unticked guides.
  assert.doesNotMatch(html, /Bonferroni/i);
  assert.doesNotMatch(html, /recalculat/i);
  assert.doesNotMatch(html, /type="checkbox"/);
  // And no verdict language anywhere.
  for (const banned of [/vulnerability confirmed/i, /\bvalidated\b/i, /\bproven\b/i,
                        /\bconfirms\b/i, /probability of validat/i]) {
    assert.doesNotMatch(html, banned);
  }
});

test("the drawer's loading and message states say what is missing, not that nothing is wrong", () => {
  const { GeneDrawer } = ui("components/dashboard/evidence/gene-drawer.tsx");
  const loading = render(GeneDrawer, {
    state: { kind: "loading", gene: "PARP1" }, screenName: "s", onClose: () => {},
  });
  assert.match(loading, /Reading the recorded report/);
  assert.match(loading, /role="status"/);

  const message = render(GeneDrawer, {
    state: { kind: "message", gene: "PARP1", title: "No report", body: "Two guides are needed." },
    screenName: "s", onClose: () => {},
  });
  assert.match(message, /No report/);
  assert.match(message, /Two guides are needed/);
  assert.doesNotMatch(message, /log2 fold change/);
});

test("the guide table shows a guide p-value and says it is not a gene-level one", () => {
  const { GeneDrawer } = ui("components/dashboard/evidence/gene-drawer.tsx");
  const html = render(GeneDrawer, {
    state: { kind: "found", gene: "PARP1", report: report(), recordedAt: null },
    screenName: "s", onClose: () => {},
  });
  assert.match(html, /is not combined into a gene-level p-value/);
  // Absent values are named, never zero.
  assert.match(html, /Not recorded/);
  assert.match(html, /Not resolved/);
});

test("a measured efficacy column appears only when something measured one", () => {
  const { GeneDrawer } = ui("components/dashboard/evidence/gene-drawer.tsx");
  const plain = render(GeneDrawer, {
    state: { kind: "found", gene: "PARP1", report: report(), recordedAt: null },
    screenName: "s", onClose: () => {},
  });
  assert.doesNotMatch(plain, /Measured efficacy/);

  const base = report();
  base.guides[0].measured_efficacy = 0.82;
  base.guides[0].efficacy_source = "DepMap Chronos";
  const withValue = render(GeneDrawer, {
    state: { kind: "found", gene: "PARP1", report: base, recordedAt: null },
    screenName: "s", onClose: () => {},
  });
  assert.match(withValue, /Measured efficacy/);
  assert.match(withValue, /DepMap Chronos/);
  // A guide with no measurement stays empty rather than inheriting a default.
  assert.match(withValue, /Not measured/);
});

test("the concordance panel prints the floor and the confound beside the p-value", () => {
  const { GeneDrawer } = ui("components/dashboard/evidence/gene-drawer.tsx");
  const html = render(GeneDrawer, {
    state: { kind: "found", gene: "PARP1", report: report(), recordedAt: null },
    screenName: "s", onClose: () => {},
  });
  assert.match(html, /Smallest p these margins allow/);
  assert.match(html, /does not establish it/);
  assert.match(html, /correlated for reasons/);
});

test("a gene whose protein context was never looked up says so, not 'no features'", () => {
  const { GeneDrawer } = ui("components/dashboard/evidence/gene-drawer.tsx");
  const base = report({
    concordance: {
      status: "not_evaluated", feature: null,
      n_depleting_annotated: 0, n_other_annotated: 0,
      fisher_p: null, fisher_p_floor: null,
      interpretation: "The protein context was not resolved for this gene in this run, so "
        + "there is no statement here about which part of the protein the effect might "
        + "depend on. Nothing was looked for and nothing was ruled out.",
      confound: "x",
    },
  });
  const html = render(GeneDrawer, {
    state: { kind: "found", gene: "PARP1", report: base, recordedAt: null },
    screenName: "s", onClose: () => {},
  });
  assert.match(html, /Nothing was looked for and nothing was ruled out/);
  assert.doesNotMatch(html, /Smallest p these margins allow/);
});

// ---------------------------------------------------------------------------
// The protein track
// ---------------------------------------------------------------------------

test("the track pins only the guides whose residue resolved, and lists the rest with reasons", () => {
  const { ProteinTrack } = ui("components/dashboard/evidence/protein-track.tsx");
  const html = render(ProteinTrack, {
    report: report(), activeResidue: null, onResidue: () => {},
  });
  // Three of the four guides resolved to a residue.
  assert.equal(html.match(/role="button"/g).length, 3);
  assert.match(html, /1 guide could not be placed on the protein/);
  assert.match(html, /the library records no verified cut position/);
  // Each band names itself and how many cuts it covers.
  assert.match(html, /PARP catalytic domain/);
  assert.match(html, /1 cut, residue 988/);
  // And says what a band is, so nobody reads it as the domain's extent.
  assert.match(html, /not the feature.s full extent/);
  assert.match(html, /Band colours distinguish/);
});

test("a protein with nothing placed explains itself and keeps the measurements", () => {
  const { ProteinTrack } = ui("components/dashboard/evidence/protein-track.tsx");
  const base = report({ n_residues: null });
  for (const g of base.guides) { g.protein_residue = null; g.note = "no MANE Select CDS covers this cut"; }
  const html = render(ProteinTrack, { report: base, activeResidue: null, onResidue: () => {} });
  assert.match(html, /No guide cut could be placed on the protein/);
  assert.match(html, /no MANE Select CDS covers this cut/);
  assert.match(html, /every fold change above is as recorded/);
  assert.doesNotMatch(html, /role="button"/);
});

test("every pin is keyboard reachable and announces its own residue and effect", () => {
  const { ProteinTrack } = ui("components/dashboard/evidence/protein-track.tsx");
  const html = render(ProteinTrack, { report: report(), activeResidue: 988, onResidue: () => {} });
  assert.equal(html.match(/tabindex="0"/g).length, 3);
  assert.match(html, /aria-label="s_01, cut at residue 988, log2 fold change -2\.84, inside PARP catalytic domain"/);
  assert.match(html, /aria-label="s_03, cut at residue 412, log2 fold change 0\.03, no curated feature"/);
});

// ---------------------------------------------------------------------------
// The structure viewer
// ---------------------------------------------------------------------------

test("the viewer version matches the installed package and the copied bundle", () => {
  const source = fs.readFileSync(srcPath("components/dashboard/evidence/structure-viewer.tsx"), "utf8");
  const declared = source.match(/VIEWER_VERSION = "([^"]+)"/)[1];
  const installed = JSON.parse(
    fs.readFileSync(path.join(root, "node_modules/pdbe-molstar/package.json"), "utf8")).version;
  assert.equal(declared, installed,
    "bump VIEWER_VERSION with the dependency, or the page requests a file that is not copied");
  const copied = path.join(root, "apps/web/public/vendor/pdbe-molstar",
                           `pdbe-molstar-component-${declared}.js`);
  assert.ok(fs.existsSync(copied),
    "run `npm run vendor -w apps/web`; the build does it, a bare test run does not");
});

test("no structure is claimed without an accession, and no spinner stands in for an answer", () => {
  const { StructureViewer } = ui("components/dashboard/evidence/structure-viewer.tsx");
  const none = render(StructureViewer, { accession: null, residue: null, residueLabel: null });
  assert.match(none, /No reviewed UniProt accession was resolved/);
  assert.doesNotMatch(none, /Loading/);
  // The guide positions do not depend on it, and the copy says so.
  assert.match(none, /do not depend on it/);

  const ready = render(StructureViewer, { accession: "P09874", residue: null, residueLabel: null });
  assert.match(ready, /Load the AlphaFold model/);
  // Nothing is fetched until the reader asks: the several-megabyte warning is the
  // contract, and a scan of a gene table must not download a structure.
  assert.match(ready, /only when you ask for it/);
});

test("the viewer says the model is of the unedited protein, not of the edit", () => {
  const { StructureViewer } = ui("components/dashboard/evidence/structure-viewer.tsx");
  const html = render(StructureViewer, { accession: "P09874", residue: 988, residueLabel: "s_01" });
  assert.match(html, /Predicted structure of the unedited protein/);
  assert.match(html, /not a prediction of what the edit did/);
  assert.match(html, /confidence describes the wild-type model/);
});
