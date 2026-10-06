import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

function reader({ total = 2300, failedOffset = null, shortOffset = null } = {}) {
  const calls = [];
  const client = { from(table) {
    const call = { table, filters: {}, offset: 0, end: 0 }; calls.push(call);
    const query = { select(_columns, options) { call.count = options?.count; return this; }, eq(key, value) { call.filters[key] = value; return this; }, order() { return this; }, range(start, end) { call.offset = start; call.end = end; return this; },
      then(resolve, reject) { const n = Math.max(0, Math.min(total - call.offset, call.end - call.offset + 1)) - (shortOffset === call.offset ? 1 : 0);
        const data = Array.from({ length: n }, (_, i) => ({ gene_symbol: `G${call.offset + i}`, lfc: i === 0 ? null : "-1.2", fdr: 0, guide_lfcs: null, hit_flags: [] }));
        return Promise.resolve({ data, error: failedOffset === call.offset ? { message: "failure" } : null, count: call.count ? total : null }).then(resolve, reject); } };
    return query;
  } };
  const exports = loadTs("lib/data/discovery.ts", { mocks: { "server-only": {}, "@/lib/supabase/server": { createClient: async () => client }, "./org": { getCurrentContext: async () => ({ user: null, org: null }) } } });
  return { ...exports, calls };
}

test("discovery reads the complete run/comparison, preserves zero and missing, and bounds pages", async () => {
  const r = reader(); const hits = await r.readDiscoveryHits("screen", "run", "comparison");
  assert.equal(hits.length, 2300); assert.equal(hits[0].lfc, null); assert.equal(hits[0].fdr, 0); assert.equal(hits[1].lfc, -1.2);
  assert.deepEqual(r.calls.map((c) => c.offset), [0, 1000, 2000]);
  for (const c of r.calls) assert.deepEqual(c.filters, { screen_id: "screen", run_id: "run", comparison_id: "comparison" });
});

test("oversized, incomplete and failed comparison reads abort without returning a partial worklist", async () => {
  const oversized = reader({ total: 30_001 });
  await assert.rejects(oversized.readDiscoveryHits("screen", "run", "comparison"), /30,000/);
  assert.equal(oversized.calls.length, 1);
  await assert.rejects(reader({ failedOffset: 1000 }).readDiscoveryHits("screen", "run", "comparison"), /could not be read/);
  await assert.rejects(reader({ shortOffset: 2000 }).readDiscoveryHits("screen", "run", "comparison"), /changed while/);
  const empty = await reader({ total: 0 }).readDiscoveryHits("screen", "run", "comparison"); assert.deepEqual(empty, []);
});

test("anonymous discovery reads do not query private snapshots", async () => {
  const r = reader(); assert.deepEqual(await r.getDiscoveryView(), { status: "workspace_required" }); assert.equal(r.calls.length, 0);
  assert.equal(await r.getDiscoveryBatch("any"), null); assert.equal(r.calls.length, 0);
});
