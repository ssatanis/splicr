/**
 * Asking SplicR to analyse a public accession.
 *
 * What these guard. The page that replaced the dead upload screen can start
 * exactly one thing, and the request it records has to be honest about that:
 * an accession the engine cannot resolve is refused before anything is written,
 * a reader who cannot spend the workspace's compute is told so rather than
 * silently no-opped, and a queued request is described as queued rather than
 * as progress nobody has made yet.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { loadTs, srcPath } from "./helpers/load-ts.mjs";

const orgId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";
const member = { isDemo: false, user: { id: userId }, org: { id: orgId }, role: "member" };

const shape = loadTs("lib/data/request-shape.ts");

// ---------------------------------------------------------------------------
// What counts as an accession
// ---------------------------------------------------------------------------

test("the accessions accepted are the ones the ingest engine resolves", () => {
  for (const good of [
    "GSE145743", "gse145743", " GSE145743 ",
    "PRJNA607255", "PRJEB40001", "PRJDB9001",
    "SRP250108", "ERP120001", "DRP005001",
  ]) {
    assert.ok(shape.isSupportedAccession(good), `${good} should be accepted`);
  }
  for (const bad of [
    "", "GSE", "GS145743", "SRR11086081", "SAMN14086081", "GSM4330101",
    "10.1038/nprot.2017.016", "https://www.ncbi.nlm.nih.gov/geo/?acc=GSE145743",
    "GSE145743; drop table", "GSE145743 OR 1=1",
  ]) {
    assert.ok(!shape.isSupportedAccession(bad), `${bad} should be refused`);
  }
});

test("a run or sample accession is refused, because a study is what can be planned", () => {
  // SRR is one sequencing run and GSM is one sample. Queuing either would hand
  // the engine something it cannot infer a design from.
  assert.ok(!shape.isSupportedAccession("SRR11086081"));
  assert.ok(!shape.isSupportedAccession("GSM4330101"));
});

test("normalising upper-cases and strips whitespace and nothing else", () => {
  assert.equal(shape.normaliseAccession("  gse145743\n"), "GSE145743");
  assert.equal(shape.normaliseAccession("GSE 145 743"), "GSE145743");
});

// ---------------------------------------------------------------------------
// What each state is allowed to claim
// ---------------------------------------------------------------------------

test("a queued request is not described as progress", () => {
  const queued = shape.REQUEST_COPY.queued;
  assert.match(queued.label, /queued/i);
  for (const word of ["analysing", "analyzing", "processing", "running"]) {
    assert.ok(!queued.body.toLowerCase().includes(word),
      `a queued request must not say "${word}": nothing has looked at it yet`);
  }
});

test("rejection is about the deposit, never about the experiment", () => {
  const rejected = shape.REQUEST_COPY.rejected;
  assert.match(rejected.body, /not about the experiment/i);
});

test("a published request says where the result went", () => {
  // Reanalysed screens are shared evidence and land in the Atlas, not in the
  // requesting workspace's screen list. A reader must not go looking.
  assert.match(shape.REQUEST_COPY.published.body, /Atlas/);
});

test("every status has copy, and no status is left to a fallback", () => {
  const source = fs.readFileSync(srcPath("lib/data/request-shape.ts"), "utf8");
  const declared = [...source.matchAll(/^\s*\|\s*"(\w+)"/gm)].map((match) => match[1]);
  assert.ok(declared.length >= 6);
  for (const status of declared) {
    assert.ok(shape.REQUEST_COPY[status], `${status} has no copy`);
    assert.ok(shape.REQUEST_COPY[status].body.length > 20);
  }
});

// ---------------------------------------------------------------------------
// The action's boundaries
// ---------------------------------------------------------------------------

function actions({
  context = member,
  role = "member",
  insert = { data: { id: "req-new" }, error: null },
  existing = { data: { id: "req-existing" }, error: null },
  status = { data: { status: "planning" }, error: null },
  kickResult = { started: true },
  kickError = null,
} = {}) {
  const writes = [];
  const adminWrites = [];
  const kicks = [];
  const makeClient = (isAdmin = false) => ({
    from(table) {
      const query = { table, values: null, update: null, filters: [] };
      (isAdmin ? adminWrites : writes).push(query);
      const chain = new Proxy({}, {
        get(_, method) {
          if (method === "then") return (resolve) => {
            if (query.update) return resolve({ error: null });
            if (query.values) return resolve(insert);
            if (query.filters.some(([key]) => key === "id")) return resolve(status);
            return resolve(existing);
          };
          return (...args) => {
            if (method === "insert") query.values = args[0];
            else if (method === "update") query.update = args[0];
            else if (method === "eq") query.filters.push([args[0], args[1]]);
            return chain;
          };
        },
      });
      return chain;
    },
  });
  const client = makeClient();
  const mod = loadTs("lib/data/request-actions.ts", {
    mocks: {
      "server-only": {},
      "next/cache": { revalidatePath: () => {} },
      "@/lib/ingest/modal": {
        kickPublicIngestQueue: async () => {
          kicks.push("sweep");
          if (kickError) throw kickError;
          return kickResult;
        },
      },
      "@/lib/supabase/admin": { createAdminClient: () => makeClient(true) },
      "@/lib/supabase/server": { createClient: async () => client },
      "./org": { getCurrentContext: async () => context, getOrgRole: async () => role },
    },
    globals: { setTimeout: (fn) => { fn(); return 0; } },
  });
  return { ...mod, writes, adminWrites, kicks };
}

function form(fields) {
  return { get: (key) => fields[key] ?? null };
}

test("an accession the engine cannot resolve is refused before anything is written", async () => {
  const app = actions();
  const result = await app.requestScreenAnalysis(form({ accession: "SRR11086081" }));
  assert.equal(result.ok, false);
  assert.match(result.error, /SRA/);
  assert.equal(app.writes.length, 0, "nothing may be queued for an accession that cannot be planned");
  assert.equal(app.kicks.length, 0);
});

test("an empty accession asks for one rather than queueing a blank", async () => {
  const app = actions();
  const result = await app.requestScreenAnalysis(form({ accession: "   " }));
  assert.equal(result.ok, false);
  assert.equal(app.writes.length, 0);
  assert.equal(app.kicks.length, 0);
});

test("a viewer is told why, not silently ignored", async () => {
  const app = actions({ role: "viewer" });
  const result = await app.requestScreenAnalysis(form({ accession: "GSE145743" }));
  assert.equal(result.ok, false);
  assert.match(result.error, /administrator/i);
  assert.equal(app.writes.length, 0);
  assert.equal(app.kicks.length, 0);
});

test("a signed-out caller writes nothing", async () => {
  const app = actions({ context: { user: null, org: null, role: null } });
  const result = await app.requestScreenAnalysis(form({ accession: "GSE145743" }));
  assert.equal(result.ok, false);
  assert.equal(app.writes.length, 0);
  assert.equal(app.kicks.length, 0);
});

test("the request carries the session's organization and member, normalised, then starts a sweep", async () => {
  const app = actions();
  const result = await app.requestScreenAnalysis(form({ accession: " gse145743 " }));
  assert.equal(result.ok, true);
  const inserts = app.writes.filter((write) => write.values);
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0].values, {
    org_id: orgId,
    requested_by: userId,
    accession: "GSE145743",
  });
  // The organization is never taken from the caller, so there is no field for
  // a forged POST to set.
  assert.ok(!("status" in inserts[0].values));
  assert.deepEqual(app.kicks, ["sweep"]);
});

test("asking twice for the same accession is the same ask, not an error", async () => {
  const app = actions({ insert: { data: null, error: { code: "23505", message: "duplicate key" } } });
  const result = await app.requestScreenAnalysis(form({ accession: "GSE145743" }));
  assert.equal(result.ok, true);
  assert.deepEqual(app.kicks, ["sweep"]);
});

test("a recorded request still succeeds if the immediate sweep kick fails", async () => {
  const app = actions({ kickError: new Error("modal unavailable") });
  const result = await app.requestScreenAnalysis(form({ accession: "GSE145743" }));
  assert.equal(result.ok, true);
  assert.deepEqual(app.kicks, ["sweep"]);
  assert.match(app.adminWrites[0].update.detail, /could not start/);
});

test("a recorded request says so when Modal credentials are missing", async () => {
  const app = actions({ kickResult: { started: false, reason: "not_configured" } });
  const result = await app.requestScreenAnalysis(form({ accession: "GSE145743" }));
  assert.equal(result.ok, true);
  assert.match(app.adminWrites[0].update.detail, /missing Modal credentials/);
});

test("a kicked request is annotated if it remains queued after the wait", async () => {
  const app = actions({ status: { data: { status: "queued" }, error: null } });
  const result = await app.requestScreenAnalysis(form({ accession: "GSE145743" }));
  assert.equal(result.ok, true);
  assert.match(app.adminWrites[0].update.detail, /not reported its first status/);
});

test("a write failure says nothing was queued", async () => {
  const app = actions({ insert: { data: null, error: { code: "08006", message: "connection reset" } } });
  const result = await app.requestScreenAnalysis(form({ accession: "GSE145743" }));
  assert.equal(result.ok, false);
  assert.match(result.error, /Nothing was queued/);
  // And never the database's own message, which can carry row values.
  assert.ok(!result.error.includes("connection reset"));
  assert.equal(app.kicks.length, 0);
});

test("withdrawing is scoped to this workspace and to a request still queued", async () => {
  const app = actions({ insert: { error: null } });
  const result = await app.withdrawScreenRequest(form({ id: "req-1" }));
  assert.equal(result.ok, true);
  assert.deepEqual(app.writes[0].filters, [["id", "req-1"], ["org_id", orgId], ["status", "queued"]]);
});

// ---------------------------------------------------------------------------
// The page's claims
// ---------------------------------------------------------------------------

test("the page offers a real private-upload path and separates public studies", () => {
  const source = fs.readFileSync(srcPath("app/dashboard/new/page.tsx"), "utf8");
  assert.match(source, /UploadFlow/);
  assert.match(source, /My experiment/);
  assert.match(source, /Published study/);
  assert.match(source, /lands in workspace storage, records a manifest/);
  assert.doesNotMatch(source, /there is no browser upload yet|cannot accept a file/i);
});
