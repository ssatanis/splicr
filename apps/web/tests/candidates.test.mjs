/**
 * The Candidate Decision Board: what it may claim, and what it must refuse to.
 *
 * Three things these guard.
 *
 * A workflow state is not a finding. "Excluded" records that somebody decided
 * not to spend bench time; it is not evidence the gene has no phenotype, and
 * "Validated" may not appear unless an outcome supports it.
 *
 * A recommendation fires on recorded evidence or it does not fire. An earlier
 * version fell through to "the guides do not agree unanimously" for a run that
 * recorded no per-guide effects at all, which asserts a disagreement nobody
 * measured. Absence is now a result with its own sentence, and these tests pin
 * every condition that produces a suggestion.
 *
 * A decision is a record of what was known. The evidence snapshot is structured
 * values written on the server, never formatted text and never anything the
 * browser supplied.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadTs, srcPath } from "./helpers/load-ts.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const model = loadTs("lib/report/candidates.ts");
const {
  CANDIDATE_STATES, STATE_COPY, nextExperiment, readCandidate, tally,
  whatSupportsIt, whatCouldWeakenIt, whereItHasBeenSeen,
} = model;

const orgId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";
const screenId = "00000000-0000-4000-8000-000000000001";
const member = { isDemo: false, user: { id: userId }, org: { id: orgId }, role: "member" };

function candidate(over = {}) {
  return {
    gene: "PARG",
    comparison: "primary",
    direction: "enriched",
    lfc: 3.4051,
    pValue: 1.1977e-6,
    fdr: 0.006188,
    nGuides: 3,
    guidesAgreeing: { agree: 3, total: 3 },
    flags: [],
    atlas: { hits: 44, tested: 459, frequentHitter: false },
    status: "unreviewed",
    decision: null,
    history: [],
    outcome: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// States record decisions, not biology
// ---------------------------------------------------------------------------

test("every state says it is a decision rather than a finding", () => {
  assert.match(STATE_COPY.excluded.help, /not a finding that the gene has no phenotype/i);
  assert.match(STATE_COPY.shortlisted.help, /not a finding/i);
  assert.match(STATE_COPY.unreviewed.help, /nobody/i);
  // Validated points at the outcome record rather than asserting one.
  assert.match(STATE_COPY.validated.help, /Truth Loop/);
});

test("the states the UI offers are exactly the states the database accepts", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20261001160000_candidate_decisions.sql"), "utf8");
  const block = sql.slice(sql.indexOf("create type public.candidate_state"), sql.indexOf(");"));
  const inDb = [...block.matchAll(/'(\w+)'/g)].map((match) => match[1]);
  assert.deepEqual([...CANDIDATE_STATES].sort(), inDb.sort());
  // 'unreviewed' is the absence of a row, so it must not be a stored state.
  assert.ok(!inDb.includes("unreviewed"));
});

test("the decision log cannot be rewritten", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20261001160000_candidate_decisions.sql"), "utf8");
  assert.ok(!/create policy[^;]*for update[^;]*candidate_decisions/is.test(sql));
  assert.ok(!/create policy[^;]*for delete[^;]*candidate_decisions/is.test(sql));
  assert.match(sql, /grant select, insert on public\.candidate_decisions/);
  assert.doesNotMatch(sql, /grant[^;]*update[^;]*candidate_decisions/i);
});

test("tally counts every state and invents none", () => {
  const counts = tally([candidate(), candidate({ gene: "X", status: "shortlisted" })]);
  assert.equal(counts.unreviewed, 1);
  assert.equal(counts.shortlisted, 1);
  assert.deepEqual(Object.keys(counts).sort(), ["excluded", "hold", "needs_validation", "shortlisted", "unreviewed", "validated"]);
});

// ---------------------------------------------------------------------------
// The readings say absence out loud
// ---------------------------------------------------------------------------

test("no artifact flag is not confirmation", () => {
  const reading = whatCouldWeakenIt(candidate({ flags: [] }));
  assert.equal(reading.points.length, 0);
  assert.match(reading.absent, /not confirmation/i);
});

test("no supporting evidence is stated as an absence, not as evidence against", () => {
  const reading = whatSupportsIt(candidate({ guidesAgreeing: null, atlas: null }));
  assert.match(reading.absent, /absence of evidence, not evidence against/i);
});

test("not measured by the Atlas reads differently from measured and never called", () => {
  const never = whereItHasBeenSeen(candidate({ atlas: { hits: 0, tested: 300, frequentHitter: false } }));
  assert.match(never.points[0], /0 of 300/);
  const unmeasured = whereItHasBeenSeen(candidate({ atlas: { hits: 0, tested: 0, frequentHitter: false } }));
  assert.match(unmeasured.absent, /different from being measured and never called/i);
  const unlooked = whereItHasBeenSeen(candidate({ atlas: null }));
  assert.match(unlooked.absent, /not looked up/i);
});

test("the readings are the researcher's questions, in order", () => {
  assert.deepEqual(readCandidate(candidate()).map((reading) => reading.question), [
    "Why it stands out",
    "What supports it",
    "What could weaken it",
    "Where it has been seen before",
  ]);
});

// ---------------------------------------------------------------------------
// Every condition that produces a recommendation
// ---------------------------------------------------------------------------

test("a promiscuity flag proposes independent guides, and names the flag", () => {
  const next = nextExperiment(candidate({
    flags: [{ flag: "promiscuous_guide", severity: "warn", message: "2 of 3 guides have single-mismatch matches elsewhere." }],
  }));
  assert.equal(next.kind, "suggested");
  assert.match(next.objective, /independent guides/i);
  assert.match(next.reason, /promiscuous guide/);
  assert.ok(next.evidence.some((line) => line.includes("single-mismatch")));
  assert.ok(next.assumption.length > 10 && next.reduces.length > 10);
});

test("a frequent hitter proposes an untreated arm", () => {
  const next = nextExperiment(candidate({ atlas: { hits: 800, tested: 1000, frequentHitter: true } }));
  assert.equal(next.kind, "suggested");
  assert.match(next.objective, /untreated arm/i);
  assert.match(next.reduces, /specific to this phenotype/i);
});

test("guides that disagree propose independent guides and say what disagreed", () => {
  const next = nextExperiment(candidate({ guidesAgreeing: { agree: 2, total: 3 } }));
  assert.equal(next.kind, "suggested");
  assert.match(next.reason, /do not all point the same way/i);
  assert.deepEqual(next.evidence, ["2 of 3 guides point the same way as the gene."]);
});

test("unanimous guides with no flags propose a second model", () => {
  const next = nextExperiment(candidate());
  assert.equal(next.kind, "suggested");
  assert.match(next.objective, /second cell model/i);
  assert.ok(next.alternative, "a genuinely different second option is offered");
});

test("no recorded evidence recommends nothing, and names what was missing", () => {
  // The failure this whole module exists to avoid: an earlier version asserted
  // the guides disagreed for a run that recorded no per-guide effects.
  const next = nextExperiment(candidate({ guidesAgreeing: null, flags: [], atlas: null }));
  assert.equal(next.kind, "none");
  assert.match(next.because, /No specific follow-up can be recommended/);
  assert.match(next.because, /per-guide effects/);
  assert.doesNotMatch(next.because, /do not agree|disagree/i);
});

test("a single guide is not treated as agreement", () => {
  const next = nextExperiment(candidate({ guidesAgreeing: { agree: 1, total: 1 }, atlas: null }));
  assert.equal(next.kind, "none");
});

test("an already validated candidate is not given another experiment", () => {
  const next = nextExperiment(candidate({ outcome: "validated" }));
  assert.equal(next.kind, "none");
  assert.match(next.because, /already supported/i);
});

test("no suggestion promises an outcome", () => {
  const all = [
    nextExperiment(candidate()),
    nextExperiment(candidate({ flags: [{ flag: "promiscuous_guide", severity: "warn", message: "m" }] })),
    nextExperiment(candidate({ atlas: { hits: 9, tested: 10, frequentHitter: true } })),
    nextExperiment(candidate({ guidesAgreeing: { agree: 1, total: 3 } })),
  ];
  for (const next of all) {
    const text = JSON.stringify(next).toLowerCase();
    for (const forbidden of ["will confirm", "will succeed", "guarantee", "proves", "will show that"]) {
      assert.ok(!text.includes(forbidden), `a suggestion promised an outcome (${forbidden})`);
    }
  }
});

test("there is no composite candidate score", () => {
  const source = fs.readFileSync(srcPath("lib/report/candidates.ts"), "utf8").toLowerCase();
  for (const forbidden of ["candidatescore", "priorityscore", "rankscore", "compositescore"]) {
    assert.ok(!source.includes(forbidden), `a composite score appeared (${forbidden})`);
  }
});

// ---------------------------------------------------------------------------
// The action's boundaries
// ---------------------------------------------------------------------------

function actions({ context = member, role = "member", screen = { id: screenId, current_run_id: "run" }, hit = null } = {}) {
  const writes = [];
  const client = {
    from(table) {
      const query = { table, values: null, filters: [] };
      writes.push(query);
      const answer =
        table === "screens" ? { data: screen, error: null }
        : table === "hits" ? { data: hit, error: null }
        : table === "runs" ? { data: { id: "run", engine_version: "0.1.0", image_digest: null }, error: null }
        : { data: null, error: null };
      const chain = new Proxy({}, {
        get(_, method) {
          if (method === "then") return (resolve) => resolve(answer);
          if (method === "maybeSingle") return () => Promise.resolve(answer);
          return (...args) => {
            if (method === "insert") query.values = args[0];
            else if (method === "eq") query.filters.push([args[0], args[1]]);
            return chain;
          };
        },
      });
      return chain;
    },
  };
  const mod = loadTs("lib/data/candidate-actions.ts", {
    mocks: {
      "server-only": {},
      "next/cache": { revalidatePath: () => {} },
      "@/lib/supabase/server": { createClient: async () => client },
      "@/lib/atlas/store": { getAtlasGenes: () => { throw new Error("no atlas in tests"); } },
      "@/lib/atlas/query": { geneEvidence: () => ({ found: false }) },
      "./org": { getCurrentContext: async () => context, getOrgRole: async () => role },
    },
  });
  return { ...mod, writes };
}

const form = (fields) => ({ get: (key) => fields[key] ?? null });

test("a viewer cannot record a decision", async () => {
  const app = actions({ role: "viewer" });
  const result = await app.recordCandidateDecision(form({ screenId, gene: "PARG", state: "shortlisted" }));
  assert.equal(result.ok, false);
  assert.match(result.error, /administrator/i);
  assert.equal(app.writes.length, 0);
});

test("a state the product does not define is refused before any read", async () => {
  const app = actions();
  const result = await app.recordCandidateDecision(form({ screenId, gene: "PARG", state: "definitely_real" }));
  assert.equal(result.ok, false);
  assert.equal(app.writes.length, 0);
});

test("a screen in another workspace is refused", async () => {
  const app = actions({ screen: null });
  const result = await app.recordCandidateDecision(form({ screenId, gene: "PARG", state: "shortlisted" }));
  assert.equal(result.ok, false);
  assert.match(result.error, /not in this workspace/i);
  // The ownership check happened, and nothing was inserted after it.
  assert.ok(!app.writes.some((write) => write.table === "candidate_decisions"));
});

test("the snapshot is structured values from the stored row, not anything the client sent", async () => {
  const app = actions({
    hit: {
      comparison_id: "cmp", run_id: "run", direction: "enriched", lfc: 3.4051,
      p_value: 1.1977e-6, fdr: 0.006188, n_guides: 3, n_good_guides: 3,
      guide_lfcs: [4.34, 3.41, 1.55],
      hit_flags: [{ flag: "multi_gene_guide", severity: "warn", message: "m" }],
    },
  });
  const result = await app.recordCandidateDecision(form({
    screenId, gene: " parg ", state: "shortlisted", reason: "worth a look",
    // A client trying to dictate the evidence is simply not read.
    fdr: "0.00000001", evidence: '{"fdr":0}',
  }));
  assert.equal(result.ok, true);
  const insert = app.writes.find((write) => write.table === "candidate_decisions").values;
  assert.equal(insert.gene_symbol, "PARG");
  assert.equal(insert.org_id, orgId);
  assert.equal(insert.decided_by, userId);
  assert.equal(insert.state, "shortlisted");
  assert.equal(insert.evidence.fdr, 0.006188, "the stored FDR, not the one the form carried");
  assert.equal(insert.evidence.lfc, 3.4051);
  assert.deepEqual(insert.evidence.guide_lfcs, [4.34, 3.41, 1.55]);
  assert.equal(insert.evidence.engine_version, "0.1.0");
  assert.equal(insert.evidence.schema, "splicr.candidate_evidence.v1");
  // Structured values only: no rendered sentence is the source of truth.
  for (const value of Object.values(insert.evidence)) {
    assert.ok(typeof value !== "string" || value.length < 60 || insert.evidence.schema === value,
      `a formatted string was snapshotted as evidence: ${value}`);
  }
});

test("a gene the run never recorded is still decidable, and the snapshot says so", async () => {
  const app = actions({ hit: null });
  const result = await app.recordCandidateDecision(form({ screenId, gene: "NOTINRUN", state: "hold" }));
  assert.equal(result.ok, true);
  const insert = app.writes.find((write) => write.table === "candidate_decisions").values;
  assert.equal(insert.evidence.recorded, false);
  assert.equal(insert.evidence.fdr, null);
});

test("the board does not keep decisions in the browser", () => {
  const source = fs.readFileSync(srcPath("components/dashboard/evidence/candidate-board.tsx"), "utf8");
  for (const forbidden of ["localStorage", "sessionStorage"]) {
    assert.ok(!source.includes(forbidden), `decisions must not live in ${forbidden}`);
  }
  // And no optimistic write: the state shown is the state the server returned.
  assert.ok(!source.includes("useOptimistic"));
});
