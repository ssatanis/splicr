/**
 * Creating and revoking a Connect key, executed against an in-memory database
 * client. What matters here is what is stored and who may do it: the plaintext
 * key never reaches the database, only its SHA-256 does, the organization comes
 * from the session, and only an admin can mint or revoke.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const USER = "00000000-0000-4000-8000-0000000000c1";
const KEY_ID = "00000000-0000-4000-8000-0000000000d1";

function makeClient(handler) {
  const queries = [];
  const client = {
    from(table) {
      const q = { table, op: "select", filters: [], payload: null, columns: null };
      queries.push(q);
      const chain = new Proxy({}, {
        get(_, method) {
          if (method === "then") return (resolve, reject) => Promise.resolve(handler(q)).then(resolve, reject);
          return (...args) => {
            if (method === "select") q.columns = args[0];
            else if (method === "insert" || method === "update") { q.op = method; q.payload = args[0]; }
            else if (method !== "single" && method !== "maybeSingle") q.filters.push([method, ...args]);
            return chain;
          };
        },
      });
      return chain;
    },
  };
  return { client, queries };
}

function harness({ role = "admin", context, handler } = {}) {
  const { client, queries } = makeClient(
    handler ??
      ((q) => {
        if (q.op === "insert") return { data: { id: KEY_ID, name: q.payload.name, key_prefix: q.payload.key_prefix, scopes: q.payload.scopes, created_by: q.payload.created_by, created_at: "2026-09-29T00:00:00Z", last_used_at: null, expires_at: null, revoked_at: null }, error: null };
        if (q.op === "update") return { data: [{ id: KEY_ID }], error: null };
        return { data: null, error: null };
      }),
  );
  const mod = loadTs("lib/data/actions.ts", {
    mocks: {
      "server-only": {},
      "next/cache": { revalidatePath() {} },
      "./org": {
        getCurrentContext: async () =>
          context ?? { isDemo: false, user: { id: USER, email: "a@b.c" }, org: { id: ORG, name: "Lab", slug: "lab" }, role },
        getOrgRole: async () => role,
        countOrgOwners: async () => 2,
        getOrgSettings: async () => ({}),
        listMembers: async () => [],
      },
      "@/lib/supabase/server": { createClient: async () => client },
    },
  });
  return { ...mod, queries };
}

const insertOf = (app) => app.queries.find((q) => q.op === "insert");
const value = (q, method, column) => q.filters.find((f) => f[0] === method && f[1] === column)?.[2];

test("a key is spk_live_ plus 32 URL-safe characters, and only its hash is stored", async () => {
  const app = harness();
  const result = await app.createApiKey("Lab notebook sync", ["hits:read"]);
  assert.equal(result.ok, true);
  assert.match(result.key, /^spk_live_[A-Za-z0-9_-]{32}$/);
  const row = insertOf(app).payload;
  assert.equal(row.key_hash, createHash("sha256").update(result.key).digest("hex"));
  assert.equal(row.key_prefix, result.key.slice(0, 12));
  assert.equal(row.key_prefix.length, 12);
  // The plaintext appears nowhere in what was written.
  assert.equal(JSON.stringify(app.queries).includes(result.key), false);
  assert.equal(JSON.stringify(row).includes(result.key.slice(12)), false);
  assert.equal(result.apiKey.status, "active");
});

test("the organization and the creator come from the session, never from the request", async () => {
  const app = harness();
  await app.createApiKey("Sync", ["hits:read"]);
  const row = insertOf(app).payload;
  assert.equal(row.org_id, ORG);
  assert.equal(row.created_by, USER);
  assert.equal(insertOf(app).table, "api_keys");
});

test("keys are unpredictable: two hundred are all different", async () => {
  const app = harness();
  const keys = new Set();
  for (let i = 0; i < 200; i++) keys.add((await app.createApiKey("k", ["hits:read"])).key);
  assert.equal(keys.size, 200);
});

test("only an admin or owner can mint or revoke, and a member is told which role is needed", async () => {
  for (const role of ["viewer", "member"]) {
    const app = harness({ role });
    const created = await app.createApiKey("Sync", ["hits:read"]);
    assert.equal(created.ok, false);
    assert.match(created.error, new RegExp(`need the admin role.*Your role is ${role}`, "i"));
    const revoked = await app.revokeApiKey(KEY_ID);
    assert.equal(revoked.ok, false);
    assert.equal(app.queries.length, 0, `${role} touched nothing`);
  }
  for (const role of ["admin", "owner"]) {
    assert.equal((await harness({ role }).createApiKey("Sync", ["hits:read"])).ok, true, role);
  }
});

test("demo and signed-out callers are refused before the database is reached", async () => {
  for (const context of [{ isDemo: true, user: null, org: null }, { isDemo: false, user: null, org: null }]) {
    const app = harness({ context });
    assert.equal((await app.createApiKey("Sync", ["hits:read"])).ok, false);
    assert.equal((await app.revokeApiKey(KEY_ID)).ok, false);
    assert.equal(app.queries.length, 0);
  }
});

test("names and scopes are validated: a blank name, an unknown scope and a huge name are refused", async () => {
  const app = harness();
  for (const name of ["", "   ", "x".repeat(500)]) {
    const result = await app.createApiKey(name, ["hits:read"]);
    assert.equal(result.ok, false, JSON.stringify(name).slice(0, 20));
  }
  const unknown = await app.createApiKey("Sync", ["hits:read", "admin:everything"]);
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /Scopes must be chosen from/);
  assert.equal(app.queries.length, 0, "nothing was written for any of them");
});

test("scopes are de-duplicated, and none at all falls back to the column default", async () => {
  const app = harness();
  await app.createApiKey("Sync", ["hits:read", "hits:read", "atlas:read"]);
  assert.deepEqual(insertOf(app).payload.scopes, ["hits:read", "atlas:read"]);
  const app2 = harness();
  await app2.createApiKey("Sync", []);
  assert.deepEqual(insertOf(app2).payload.scopes, ["atlas:read", "hits:read"]);
});

test("a database refusal becomes a plain sentence and never leaks the error", async () => {
  const app = harness({ handler: () => ({ data: null, error: { code: "42501", message: "new row violates row-level security policy for table api_keys" } }) });
  const result = await app.createApiKey("Sync", ["hits:read"]);
  assert.equal(result.ok, false);
  assert.match(result.error, /refused that change for your role/);
  assert.doesNotMatch(result.error, /row-level|api_keys/);
});

test("revoking is scoped to the organization, only touches a live key, and says when there is nothing to revoke", async () => {
  const app = harness();
  assert.equal((await app.revokeApiKey(KEY_ID)).ok, true);
  const update = app.queries.find((q) => q.op === "update");
  assert.equal(value(update, "eq", "org_id"), ORG);
  assert.equal(value(update, "eq", "id"), KEY_ID);
  assert.ok(update.filters.some((f) => f[0] === "is" && f[1] === "revoked_at" && f[2] === null), "a key already revoked is not re-stamped");
  assert.match(typeof update.payload.revoked_at, /string/);

  const gone = harness({ handler: () => ({ data: [], error: null }) });
  const result = await gone.revokeApiKey(KEY_ID);
  assert.equal(result.ok, false);
  assert.match(result.error, /already revoked, or it no longer exists/);

  const bad = harness();
  assert.match((await bad.revokeApiKey("not-a-uuid")).error, /not valid/);
  assert.equal(bad.queries.length, 0);
});
