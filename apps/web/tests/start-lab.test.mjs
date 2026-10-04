/**
 * Starting a lab, and the greeting the lab then gets.
 *
 * Two things are worth pinning. The action must refuse the callers it should
 * refuse even though it is the one workspace action that cannot use
 * `authorize()` -- that helper rejects a caller with no organization, which is
 * exactly who creates a lab. And it must go through the database function rather
 * than inserting the organization and the membership itself, because a caller
 * may insert the first but not the second: "admins manage membership" wants an
 * admin role in the organization they are joining, so two statements leave an
 * orphan organization nobody can read or delete.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const USER = "00000000-0000-4000-8000-0000000000c1";
const NEW_ORG = "00000000-0000-4000-8000-0000000000e1";

function harness({ context, rpc } = {}) {
  const calls = [];
  const client = {
    from() {
      throw new Error("createOrganization must not touch tables directly; it calls the rpc");
    },
    async rpc(name, args) {
      calls.push({ name, args });
      return rpc ? rpc(name, args) : { data: { id: NEW_ORG, name: args.p_name }, error: null };
    },
  };
  const mod = loadTs("lib/data/actions.ts", {
    mocks: {
      "server-only": {},
      "next/cache": { revalidatePath() {} },
      "./org": {
        getCurrentContext: async () =>
          context ?? { isDemo: false, user: { id: USER, email: "a@b.c" }, org: null, role: null },
        getOrgRole: async () => null,
        countOrgOwners: async () => 1,
        getOrgSettings: async () => ({}),
        listMembers: async () => [],
      },
      "@/lib/supabase/server": { createClient: async () => client },
    },
  });
  return { ...mod, calls };
}

const form = (fields) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

test("a signed-in user with no workspace can create one, and becomes its owner", async () => {
  const app = harness();
  const result = await app.createOrganization(form({ name: "  Franklin Lab  ", kind: "academic" }));

  assert.equal(result.ok, true);
  assert.equal(result.orgId, NEW_ORG);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].name, "create_organization");
  // Trimmed before it reaches the database, so organizations_name_length cannot
  // be satisfied by whitespace.
  assert.equal(app.calls[0].args.p_name, "Franklin Lab");
  assert.equal(app.calls[0].args.p_kind, "academic");
});

test("the kind defaults rather than failing when the form omits it", async () => {
  const app = harness();
  const result = await app.createOrganization(form({ name: "Doudna" }));
  assert.equal(result.ok, true);
  assert.equal(app.calls[0].args.p_kind, "academic");
});

test("an unknown kind is refused instead of being sent on", async () => {
  const app = harness();
  const result = await app.createOrganization(form({ name: "Doudna", kind: "starship" }));
  assert.equal(result.ok, false);
  assert.match(result.error, /not a workspace kind/);
  assert.equal(app.calls.length, 0);
});

test("a nameless lab is refused before any statement runs", async () => {
  for (const name of ["", "   "]) {
    const app = harness();
    const result = await app.createOrganization(form({ name }));
    assert.equal(result.ok, false, JSON.stringify(name));
    assert.equal(app.calls.length, 0, "nothing may be sent for an empty name");
  }
});

test("a demo visitor and a signed-out caller are both refused", async () => {
  const demo = harness({ context: { isDemo: true, user: null, org: null, role: null } });
  const asDemo = await demo.createOrganization(form({ name: "Franklin" }));
  assert.equal(asDemo.ok, false);
  assert.equal(demo.calls.length, 0);

  const anon = harness({ context: { isDemo: false, user: null, org: null, role: null } });
  const asAnon = await anon.createOrganization(form({ name: "Franklin" }));
  assert.equal(asAnon.ok, false);
  assert.match(asAnon.error, /session/i);
  assert.equal(anon.calls.length, 0);
});

test("a database failure is reported, not swallowed into a false success", async () => {
  const app = harness({ rpc: () => ({ data: null, error: { message: "permission denied" } }) });
  const result = await app.createOrganization(form({ name: "Franklin" }));
  assert.equal(result.ok, false);
  // The raw Postgres text must not reach the UI.
  assert.doesNotMatch(result.error, /permission denied/);
});

test("a row that comes back unreadable is not reported as a created lab", async () => {
  for (const data of [null, {}, [], [{ id: 7 }]]) {
    const app = harness({ rpc: () => ({ data, error: null }) });
    const result = await app.createOrganization(form({ name: "Franklin" }));
    assert.equal(result.ok, false, JSON.stringify(data));
  }
});

test("the rpc result is read whether it arrives as a row or a one-element array", async () => {
  const app = harness({ rpc: () => ({ data: [{ id: NEW_ORG }], error: null }) });
  const result = await app.createOrganization(form({ name: "Franklin" }));
  assert.equal(result.ok, true);
  assert.equal(result.orgId, NEW_ORG);
});

// ---------------------------------------------------------------------------
// The greeting
// ---------------------------------------------------------------------------

test("a lab is greeted by name, and never gains a second noun", () => {
  const { labGreeting } = loadTs("lib/utils.ts");
  // Names that already carry their own noun keep it exactly as written.
  assert.equal(labGreeting("Franklin Lab"), "Welcome to Franklin Lab");
  assert.equal(labGreeting("Zhang Laboratory"), "Welcome to Zhang Laboratory");
  assert.equal(labGreeting("Broad Institute"), "Welcome to Broad Institute");
  // The personal workspace the signup trigger creates must not become a lab.
  assert.equal(labGreeting("Ada's workspace"), "Welcome to Ada's workspace");
  // A bare surname gets one.
  assert.equal(labGreeting("Franklin"), "Welcome to Franklin Lab");
  assert.equal(labGreeting("  Doudna  "), "Welcome to Doudna Lab");
  // A word that merely contains "lab" is not the word, so it still gets one.
  assert.equal(labGreeting("Lablab"), "Welcome to Lablab Lab");
  // Nothing to greet by: no stray "Welcome to  Lab".
  assert.equal(labGreeting("   "), "Welcome back");
  assert.equal(labGreeting(""), "Welcome back");
});
