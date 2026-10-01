/**
 * The Truth Loop's reads and writes, executed for real against an in-memory
 * stand-in for the database client. This proves the application's own rules:
 * who may write, which organization a statement is scoped to, what is refused
 * before the database is touched, and that a failed read is never presented as
 * an empty workspace. It does not prove the deployed Row Level Security
 * policies, which are a second lock behind these and are checked in SQL.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const OTHER_ORG = "00000000-0000-4000-8000-0000000000bb";
const USER = "00000000-0000-4000-8000-000000000001";
const SCREEN = "00000000-0000-4000-8000-000000000001";
const RUN = "00000000-0000-4000-8000-000000000003";
const OUTCOME = "00000000-0000-4000-8000-000000000009";

/** A chainable, awaitable query that records what it was asked and answers from `handler`. */
function makeClient(handler) {
  const queries = [];
  const client = {
    from(table) {
      const q = { table, op: "select", filters: [], order: [], range: null, payload: null, columns: null, options: null, limit: null };
      queries.push(q);
      const chain = new Proxy({}, {
        get(_, method) {
          if (method === "then") return (resolve, reject) => Promise.resolve(handler(q)).then(resolve, reject);
          return (...args) => {
            if (method === "select") { q.columns = args[0]; q.options = args[1] ?? null; }
            else if (method === "insert" || method === "update") { q.op = method; q.payload = args[0]; }
            else if (method === "delete") q.op = "delete";
            else if (method === "range") q.range = args;
            else if (method === "order") q.order.push(args);
            else if (method === "limit") q.limit = args[0];
            else if (method !== "single" && method !== "maybeSingle") q.filters.push([method, ...args]);
            else q.terminal = method;
            return chain;
          };
        },
      });
      return chain;
    },
  };
  return { client, queries };
}

const filterValue = (q, method, column) => q.filters.find((f) => f[0] === method && f[1] === column)?.[2];

function readerHarness({ context, handler, members = [] } = {}) {
  const { client, queries } = makeClient(handler ?? (() => ({ data: [], error: null, count: 0 })));
  const mod = loadTs("lib/data/outcomes.ts", {
    mocks: {
      "server-only": {},
      "@/lib/data/org": { getCurrentContext: async () => context, listMembers: async () => members },
      "@/lib/supabase/server": { createClient: async () => client },
    },
  });
  return { ...mod, queries };
}

const member = { isDemo: false, user: { id: USER }, org: { id: ORG }, role: "member" };
const filters = (over = {}) => ({ result: null, screen: null, q: "", page: 1, ...over });

const dbRow = (over = {}) => ({
  id: OUTCOME, screen_id: SCREEN, gene_symbol: "TP53", result: "validated", assay: "Arrayed KO", effect_size: 0,
  n_guides: 3, predicted: "0.912", model_version: "v1", notes: null, evidence_url: null, hit_id: "h1",
  logged_by: USER, logged_at: "2026-09-01T10:00:00Z", screens: { name: "RSL3 screen" }, ...over,
});

function answer(rows, counts = { validated: 2, failed: 1, inconclusive: 0, pending: 1 }, total = rows.length) {
  return (q) => {
    if (q.table === "screens") return { data: [{ id: SCREEN, name: "RSL3 screen" }], error: null };
    if (q.options?.head) return { data: null, error: null, count: counts[filterValue(q, "eq", "result")] ?? 0 };
    return { data: rows, error: null, count: total };
  };
}

test("anonymous and demo sessions never query the workspace", async () => {
  for (const context of [{ isDemo: true, user: null, org: null }, { isDemo: false, user: null, org: null }, { isDemo: false, user: { id: USER }, org: null }]) {
    const app = readerHarness({ context });
    assert.equal((await app.getOutcomeView(filters())).status, "workspace_required");
    assert.equal(app.queries.length, 0);
  }
});

test("reads are scoped to the session's organization and page from the right offset", async () => {
  const app = readerHarness({ context: member, handler: answer([dbRow()], undefined, 120) });
  const view = await app.getOutcomeView(filters({ page: 2 }));
  assert.equal(view.status, "ready");
  assert.equal(view.total, 120);
  assert.equal(view.page, 2);
  for (const q of app.queries) assert.equal(filterValue(q, "eq", "org_id"), ORG, `${q.table} is scoped`);
  const rows = app.queries.find((q) => q.table === "validation_outcomes" && !q.options?.head);
  assert.deepEqual(rows.range, [50, 99]);
  assert.deepEqual(rows.order, [["logged_at", { ascending: false }], ["id"]]);
  assert.equal(rows.options.count, "exact");
});

test("filters reach the query, and a gene search cannot inject wildcards or PostgREST syntax", async () => {
  const app = readerHarness({ context: member, handler: answer([]) });
  await app.getOutcomeView(filters({ result: "failed", screen: SCREEN, q: "TP_5%,or=(x)" }));
  const rows = app.queries.find((q) => q.table === "validation_outcomes" && !q.options?.head);
  assert.equal(filterValue(rows, "eq", "result"), "failed");
  assert.equal(filterValue(rows, "eq", "screen_id"), SCREEN);
  // Everything outside letters, digits and . _ @ - is dropped, and the underscore is escaped.
  assert.equal(filterValue(rows, "ilike", "gene_symbol"), "%TP\\_5orx%");
  // The counts honour the screen filter and ignore the result filter.
  const heads = app.queries.filter((q) => q.options?.head);
  assert.equal(heads.length, 4);
  assert.ok(heads.every((q) => filterValue(q, "eq", "screen_id") === SCREEN));
  assert.deepEqual(heads.map((q) => filterValue(q, "eq", "result")).sort(), ["failed", "inconclusive", "pending", "validated"]);
});

test("counts come from the database's own totals, not from the page of rows", async () => {
  const app = readerHarness({ context: member, handler: answer([dbRow()], { validated: 30, failed: 10, inconclusive: 4, pending: 6 }, 50) });
  const view = await app.getOutcomeView(filters());
  assert.deepEqual(view.counts, { validated: 30, failed: 10, inconclusive: 4, pending: 6, total: 50 });
  assert.equal(view.rows.length, 1);
});

test("a row is mapped without inventing anything: zero effect stays zero, blanks stay null", async () => {
  const app = readerHarness({
    context: member,
    handler: answer([dbRow({ effect_size: 0, assay: null, n_guides: null, predicted: null, model_version: null, hit_id: null, screens: [{ name: "Array shape" }] })]),
  });
  const { rows } = await app.getOutcomeView(filters());
  assert.equal(rows[0].effectSize, 0);
  assert.equal(rows[0].assay, null);
  assert.equal(rows[0].nGuides, null);
  assert.equal(rows[0].predicted, null);
  assert.equal(rows[0].hitLinked, false);
  assert.equal(rows[0].screenName, "Array shape");
});

test("an unknown result value is dropped, never displayed as a result it is not", async () => {
  const app = readerHarness({ context: member, handler: answer([dbRow({ result: "artifact" }), dbRow({ id: "b", result: "pending" })]) });
  const { rows } = await app.getOutcomeView(filters());
  assert.deepEqual(rows.map((r) => r.id), ["b"]);
});

test("who logged an outcome is a name, and a departed member is not a blank", async () => {
  const members = [{ id: "u2", name: "R. Alvarez" }];
  const app = readerHarness({
    context: member, members,
    handler: answer([dbRow({ id: "a", logged_by: USER }), dbRow({ id: "b", logged_by: "u2" }), dbRow({ id: "c", logged_by: "gone" }), dbRow({ id: "d", logged_by: null })]),
  });
  const { rows } = await app.getOutcomeView(filters());
  assert.deepEqual(rows.map((r) => r.loggedBy), ["You", "R. Alvarez", "A former member", null]);
});

test("a failed read is 'unavailable', never an empty workspace, and leaks no message", async () => {
  for (const handler of [
    () => ({ data: null, error: { code: "42501", message: "secret row value" }, count: null }),
    () => ({ data: [], error: null, count: null }),
    (q) => (q.options?.head ? { data: null, error: { code: "57014" }, count: null } : { data: [], error: null, count: 0 }),
  ]) {
    const app = readerHarness({ context: member, handler });
    const view = await app.getOutcomeView(filters());
    assert.equal(view.status, "unavailable");
    assert.equal(JSON.stringify(view).includes("secret"), false);
  }
  const throwing = readerHarness({ context: member, handler: () => { throw new Error("boom"); } });
  assert.equal((await throwing.getOutcomeView(filters())).status, "unavailable");
});

test("write and delete permissions follow the role, as the policies do", async () => {
  const expectations = { viewer: [false, false], member: [true, false], admin: [true, true], owner: [true, true] };
  for (const [role, [write, del]] of Object.entries(expectations)) {
    const app = readerHarness({ context: { ...member, role }, handler: answer([]) });
    const view = await app.getOutcomeView(filters());
    assert.equal(view.canWrite, write, `${role} write`);
    assert.equal(view.canDelete, del, `${role} delete`);
  }
});

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function actionsHarness({ context = member, role = "member", handler } = {}) {
  const { client, queries } = makeClient(handler ?? (() => ({ data: null, error: null })));
  const revalidated = [];
  const mod = loadTs("lib/data/outcome-actions.ts", {
    mocks: {
      "server-only": {},
      "next/cache": { revalidatePath: (...args) => revalidated.push(args) },
      "@/lib/data/org": { getCurrentContext: async () => context, getOrgRole: async () => role },
      "@/lib/supabase/server": { createClient: async () => client },
    },
  });
  return { ...mod, queries, revalidated };
}

const draft = (over = {}) => ({
  screenId: SCREEN, gene: "tp53", result: "validated", assay: "Arrayed KO", nGuides: "3", effectSize: "-1.2",
  notes: "", evidenceUrl: "", ...over,
});

function writeHandler({ screen = { id: SCREEN, name: "RSL3 screen", current_run_id: RUN }, hit = { id: "hit-1", gene_symbol: "TP53", chance_real: 0.912, model_version: "v1" }, insert } = {}) {
  return (q) => {
    if (q.table === "screens") return { data: screen, error: null };
    if (q.table === "hits") return { data: hit ? [hit] : [], error: null };
    if (q.op === "insert") return insert ?? { data: dbRow({ id: OUTCOME, gene_symbol: q.payload.gene_symbol, predicted: q.payload.predicted, hit_id: q.payload.hit_id, result: q.payload.result, logged_by: q.payload.logged_by }), error: null };
    if (q.op === "update") return { data: dbRow({ ...q.payload, result: q.payload.result }), error: null };
    if (q.op === "delete") return { data: [{ id: OUTCOME }], error: null };
    return { data: null, error: null };
  };
}

test("logging an outcome writes to the session's organization, as the caller, and links the recorded hit", async () => {
  const app = actionsHarness({ handler: writeHandler() });
  const result = await app.logOutcome({ ...draft(), orgId: OTHER_ORG, org_id: OTHER_ORG, loggedBy: "someone-else" });
  assert.equal(result.ok, true);
  const insert = app.queries.find((q) => q.op === "insert");
  assert.equal(insert.table, "validation_outcomes");
  assert.equal(insert.payload.org_id, ORG, "the organization is the session's, whatever the request says");
  assert.equal(insert.payload.logged_by, USER);
  assert.equal(insert.payload.hit_id, "hit-1");
  assert.equal(insert.payload.gene_symbol, "TP53", "the hit's own spelling wins over what was typed");
  assert.equal(insert.payload.predicted, 0.912, "the score recorded at the time travels with the outcome");
  assert.equal(insert.payload.model_version, "v1");
  assert.equal(insert.payload.effect_size, -1.2);
  assert.equal(insert.payload.n_guides, 3);
  assert.match(result.note, /Linked to the hit recorded/);
  assert.deepEqual(app.revalidated[0], ["/dashboard", "layout"]);
  // The screen and the hit were looked up inside the organization.
  const screenQuery = app.queries.find((q) => q.table === "screens");
  assert.equal(filterValue(screenQuery, "eq", "org_id"), ORG);
  const hitQuery = app.queries.find((q) => q.table === "hits");
  assert.equal(filterValue(hitQuery, "eq", "run_id"), RUN);
});

test("a gene with no recorded hit is saved without a link, without a score, and says so", async () => {
  const app = actionsHarness({ handler: writeHandler({ hit: null }) });
  const result = await app.logOutcome(draft({ gene: "Trp53" }));
  assert.equal(result.ok, true);
  const insert = app.queries.find((q) => q.op === "insert");
  assert.equal(insert.payload.hit_id, null);
  assert.equal(insert.payload.predicted, null);
  assert.equal(insert.payload.model_version, null);
  assert.equal(insert.payload.gene_symbol, "Trp53");
  assert.match(result.note, /Saved without a link/);
});

test("a screen that has not been run has nothing to link and does not query hits", async () => {
  const app = actionsHarness({ handler: writeHandler({ screen: { id: SCREEN, name: "Unrun", current_run_id: null } }) });
  const result = await app.logOutcome(draft());
  assert.equal(result.ok, true);
  assert.equal(app.queries.some((q) => q.table === "hits"), false);
});

test("the gene lookup is exact and case-insensitive: underscores are escaped, wildcards cannot get in", async () => {
  const app = actionsHarness({ handler: writeHandler() });
  await app.logOutcome(draft({ gene: "KRAS_G12V" }));
  const hitQuery = app.queries.find((q) => q.table === "hits");
  assert.equal(filterValue(hitQuery, "ilike", "gene_symbol"), "KRAS\\_G12V");
});

test("signed-out and non-member callers are refused before anything is read", async () => {
  const cases = [
    [{ user: null, org: null }, /session has ended/],
    [{ user: { id: USER }, org: null }, /not a member of a SplicR workspace/],
  ];
  for (const [context, message] of cases) {
    const app = actionsHarness({ context });
    const result = await app.logOutcome(draft());
    assert.equal(result.ok, false);
    assert.match(result.error, message);
    assert.equal(app.queries.length, 0);
  }
  const removed = actionsHarness({ role: null });
  assert.match((await removed.logOutcome(draft())).error, /no longer a member/);
  assert.equal(removed.queries.length, 0);
});

test("a viewer cannot log, a member cannot delete, and both are told why", async () => {
  const viewer = actionsHarness({ role: "viewer", handler: writeHandler() });
  const denied = await viewer.logOutcome(draft());
  assert.equal(denied.ok, false);
  assert.match(denied.error, /need the member role.*Your role is viewer/i);
  assert.equal(viewer.queries.length, 0);
  assert.equal((await viewer.updateOutcome(OUTCOME, draft())).ok, false);

  const memberApp = actionsHarness({ role: "member", handler: writeHandler() });
  const cannotDelete = await memberApp.deleteOutcome(OUTCOME);
  assert.equal(cannotDelete.ok, false);
  assert.match(cannotDelete.error, /need the admin role/i);
  assert.equal(memberApp.queries.length, 0);

  const admin = actionsHarness({ role: "admin", handler: writeHandler() });
  assert.equal((await admin.deleteOutcome(OUTCOME)).ok, true);
});

test("invalid input is refused with per-field messages and never reaches the database", async () => {
  const app = actionsHarness({ handler: writeHandler() });
  const result = await app.logOutcome(draft({ gene: "TP 53", result: "artifact", nGuides: "0", evidenceUrl: "javascript:alert(1)" }));
  assert.equal(result.ok, false);
  assert.ok(result.fieldErrors.gene && result.fieldErrors.result && result.fieldErrors.nGuides && result.fieldErrors.evidenceUrl);
  assert.equal(app.queries.length, 0);
  const notUuid = await app.logOutcome(draft({ screenId: "not-a-uuid" }));
  assert.equal(notUuid.ok, false);
  assert.match(notUuid.fieldErrors.screenId, /not in this workspace/);
  assert.equal(app.queries.length, 0);
});

test("a screen from another workspace is refused as not being in this one", async () => {
  const app = actionsHarness({ handler: writeHandler({ screen: null }) });
  const result = await app.logOutcome(draft({ screenId: "00000000-0000-4000-8000-00000000ffff" }));
  assert.equal(result.ok, false);
  assert.match(result.fieldErrors.screenId, /not in this workspace/);
  assert.equal(app.queries.some((q) => q.op === "insert"), false);
});

test("database failures become plain sentences and the action never throws", async () => {
  const refused = actionsHarness({ handler: writeHandler({ insert: { data: null, error: { code: "42501", message: "row-level security ... secret" } } }) });
  const a = await refused.logOutcome(draft());
  assert.equal(a.ok, false);
  assert.match(a.error, /refused that change for your role/);
  assert.doesNotMatch(a.error, /secret|row-level/);

  const range = actionsHarness({ handler: writeHandler({ insert: { data: null, error: { code: "23514" } } }) });
  assert.match((await range.logOutcome(draft())).error, /out of range/);

  const broken = actionsHarness({ handler: () => { throw new Error("connection reset"); } });
  const b = await broken.logOutcome(draft());
  assert.equal(b.ok, false);
  assert.doesNotMatch(b.error, /connection reset/);
});

test("an edit changes only what the assay found, never the screen, gene or organization", async () => {
  const app = actionsHarness({ handler: writeHandler() });
  const result = await app.updateOutcome(OUTCOME, draft({ result: "failed", gene: "SOMETHING_ELSE", screenId: OTHER_ORG }));
  assert.equal(result.ok, true);
  const update = app.queries.find((q) => q.op === "update");
  assert.deepEqual(Object.keys(update.payload).sort(), ["assay", "effect_size", "evidence_url", "n_guides", "notes", "result"]);
  assert.equal(update.payload.result, "failed");
  assert.equal(filterValue(update, "eq", "id"), OUTCOME);
  assert.equal(filterValue(update, "eq", "org_id"), ORG);
});

test("editing or deleting an outcome that is not there says so, once", async () => {
  const gone = actionsHarness({ role: "admin", handler: (q) => (q.op === "delete" ? { data: [], error: null } : { data: null, error: null }) });
  assert.match((await gone.updateOutcome(OUTCOME, draft())).error, /not in this workspace/);
  assert.match((await gone.deleteOutcome(OUTCOME)).error, /not in this workspace/);
  assert.match((await gone.updateOutcome("nope", draft())).error, /not in this workspace/);
  assert.match((await gone.deleteOutcome("nope")).error, /not in this workspace/);
});

test("delete is scoped to the session's organization", async () => {
  const app = actionsHarness({ role: "owner", handler: writeHandler() });
  await app.deleteOutcome(OUTCOME);
  const del = app.queries.find((q) => q.op === "delete");
  assert.equal(filterValue(del, "eq", "org_id"), ORG);
  assert.equal(filterValue(del, "eq", "id"), OUTCOME);
});
