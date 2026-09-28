/** Execute the real Connect route with isolated RPC adapters; no live DB writes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const source = fs.readFileSync(path.join(import.meta.dirname, "../src/app/api/v1/hits/route.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const screenId = "00000000-0000-4000-8000-000000000001";
const token = "spk_test_adapter_only";
const hash = createHash("sha256").update(token).digest("hex");
class TestResponse extends Response {
  static json(body, init) { return new TestResponse(JSON.stringify(body), init); }
}
const key = { key_id: "key", org_id: "organization", org_name: "Test organization", org_slug: "test", scopes: ["hits:read"], revoked: false, expired: false };
const screen = { screen_id: screenId, org_id: key.org_id, name: "Recorded screen", run_id: "run", library_slug: null };
const baseHit = {
  n_total: 1, hit_id: "hit", gene_symbol: "TEST1", direction: "depleted", verdict: "uncertain", comparison: "treated vs control",
  chance_real: null, chance_lower: null, chance_upper: null, novelty: null, lfc: null, fdr: null, p_value: null,
  n_guides: 4, n_good_guides: 3, cn_corrected: null, atlas_hit_count: null, atlas_screen_count: null, atlas_hit_rate: null,
  model_version: "recorded-v1", reason: null, flags: null,
};
function harness({ hits = [baseHit], keyRows = [key], screenRows = [screen] } = {}) {
  const calls = [];
  const exports = {};
  const rpc = async (name, args) => {
    calls.push({ name, args });
    const data = { api_key_resolve: keyRows, api_key_touch: null, api_key_screen: screenRows, api_key_hits: hits }[name];
    assert.ok(["api_key_resolve", "api_key_touch", "api_key_screen", "api_key_hits"].includes(name));
    return { data, error: null };
  };
  vm.runInNewContext(compiled, { exports, require(name) {
    if (name === "next/server") return { NextResponse: TestResponse };
    if (name === "@/lib/connect/config") return { HITS_SCOPE: "hits:read" };
    if (name === "@/lib/connect/supabase") return { apiSupabase: () => ({ rpc }) };
    return nativeRequire(name);
  }, console: { error() {}, warn() {} } });
  return {
    calls,
    get: async (query = "", authenticated = true) => {
      const nextUrl = new URL(`https://splicr.test/api/v1/hits?screen=${screenId}${query}`);
      const request = { nextUrl, headers: new Headers(authenticated ? { Authorization: `Bearer ${token}` } : {}) };
      return exports.GET(request);
    },
  };
}

test("Connect preserves tiny nonzero statistics and complete recorded numeric precision", async () => {
  const recorded = { ...baseHit, fdr: 1.234567890123e-24, p_value: Number.MIN_VALUE, lfc: -0.0000000123456789012, novelty: 0.1234567890123, chance_real: 0.9876543210987, atlas_hit_rate: 1.23456789e-9 };
  const app = harness({ hits: [recorded] });
  const response = await app.get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const [hit] = (await response.json()).hits;
  for (const field of ["fdr", "p_value", "lfc", "novelty", "chance_real"]) assert.equal(hit[field], recorded[field], field);
  assert.ok(hit.fdr > 0 && hit.p_value > 0);
  assert.equal(hit.atlas.hit_rate, recorded.atlas_hit_rate);
  for (const call of app.calls) {
    assert.equal(call.args.p_key_hash, hash);
    assert.ok(!JSON.stringify(call).includes(token));
  }
});

test("Connect distinguishes measured zeros, missing values and nonfinite invalid outputs", async () => {
  const app = harness({ hits: [
    { ...baseHit, p_value: 0, fdr: 0, chance_real: 0, cn_corrected: false },
    { ...baseHit },
    { ...baseHit, fdr: NaN, p_value: Infinity, chance_real: -Infinity, chance_lower: NaN, chance_upper: Infinity },
  ] });
  const { hits } = await (await app.get()).json();
  for (const field of ["p_value", "fdr", "chance_real"]) {
    assert.equal(hits[0][field], 0);
    assert.equal(hits[1][field], null);
    assert.equal(hits[2][field], null);
  }
  assert.equal(hits[0].cn_corrected, false);
  assert.equal(hits[1].cn_corrected, null);
  assert.equal(hits[2].chance_interval, null);
});

test("stored bounds are preserved without inventing probability or uncertainty claims", async () => {
  const app = harness({ hits: [
    { ...baseHit, chance_real: 0.8, chance_lower: 0.654321098765, chance_upper: 0.912345678901 },
    { ...baseHit, chance_lower: null, chance_upper: 0.9 },
    { ...baseHit },
  ] });
  const { hits } = await (await app.get()).json();
  assert.deepEqual(hits[0].chance_interval, [0.654321098765, 0.912345678901]);
  assert.deepEqual(hits[1].chance_interval, [null, 0.9]);
  assert.equal(hits[2].chance_interval, null);
  for (const hit of hits) {
    assert.equal(hit.score_interpretation, "stored_uncalibrated_model_output");
    assert.equal(hit.chance_interval_interpretation, "stored_uncalibrated_bounds");
    assert.equal(hit.validation_probability, null);
    assert.equal(hit.validation_probability_interval, null);
  }
});

test("Connect forwards scientific filters exactly to the organization-bound RPC", async () => {
  const app = harness();
  assert.equal((await app.get("&max_fdr=1e-20&min_chance=0.87654321")).status, 200);
  const query = app.calls.find(({ name }) => name === "api_key_hits").args;
  assert.equal(query.p_max_fdr, 1e-20);
  assert.equal(query.p_min_chance, 0.87654321);
  assert.equal(query.p_screen_id, screenId);
  assert.equal(query.p_key_hash, hash);
});

test("unauthorized or unowned screens cannot reach hit serialization", async () => {
  const anonymous = harness();
  assert.equal((await anonymous.get("", false)).status, 401);
  assert.equal(anonymous.calls.length, 0);
  const unowned = harness({ screenRows: [] });
  assert.equal((await unowned.get()).status, 404);
  assert.ok(!unowned.calls.some(({ name }) => name === "api_key_hits"));
});
