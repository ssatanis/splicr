import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

function gateway(overrides = {}, response = { status: 202, json: async () => ({ accepted: true }) }) {
  const calls = [];
  const env = { MODAL_GATEWAY_URL: "https://fixture--queue-gateway.modal.run", MODAL_PROXY_TOKEN_ID: "wk-fixture", MODAL_PROXY_TOKEN_SECRET: "ws-fixture", ...overrides };
  const mod = loadTs("lib/ingest/modal.ts", { mocks: { "server-only": {} }, globals: { process: { env }, fetch: async (...args) => { calls.push(args); if (response instanceof Error) throw response; return response; } } });
  return { ...mod, calls };
}

test("only acknowledged authenticated asynchronous dispatch is called started", async () => {
  const app = gateway();
  assert.deepEqual(await app.kickPrivateScreenQueue(2), { started: true });
  const [url, request] = app.calls[0];
  assert.equal(url.hostname, "fixture--queue-gateway.modal.run");
  assert.equal(request.redirect, "error"); assert.equal(request.cache, "no-store");
  assert.equal(request.headers["Modal-Key"], "wk-fixture"); assert.equal(request.headers["Modal-Secret"], "ws-fixture");
  assert.deepEqual(JSON.parse(request.body), { kind: "private", count: 2 });
  assert.ok(request.signal instanceof AbortSignal);
  await app.kickPublicIngestQueue();
  assert.deepEqual(JSON.parse(app.calls[1][1].body), { kind: "public", count: 1 });
});

test("missing credentials and an explicit disable never launch local or remote compute", async () => {
  for (const key of ["MODAL_GATEWAY_URL", "MODAL_PROXY_TOKEN_ID", "MODAL_PROXY_TOKEN_SECRET"]) {
    const app = gateway({ [key]: "" });
    assert.deepEqual(await app.kickPrivateScreenQueue(), { started: false, reason: "not_configured" }); assert.equal(app.calls.length, 0);
  }
  const app = gateway({ SPLICR_INGEST_AUTOSTART: "0" });
  assert.deepEqual(await app.kickPublicIngestQueue(), { started: false, reason: "disabled" }); assert.equal(app.calls.length, 0);
});

test("gateway credentials cannot be sent to an unrelated origin, cleartext URL or redirect", async () => {
  for (const url of ["http://fixture.modal.run", "https://modal.run.attacker.invalid", "https://modal.run", "https://fixture.modal.run@evil.invalid", "https://user:pass@fixture.modal.run", "https://fixture.modal.run?redirect=evil", "https://fixture.modal.run#fragment"]) {
    const app = gateway({ MODAL_GATEWAY_URL: url });
    await assert.rejects(app.kickPrivateScreenQueue()); assert.equal(app.calls.length, 0);
  }
});

test("failed or malformed acknowledgements preserve a failure rather than claiming compute started", async () => {
  for (const status of [200, 301, 401, 403, 422, 500, 503]) await assert.rejects(gateway({}, { status }).kickPublicIngestQueue(), /refused dispatch/);
  for (const payload of [null, {}, { accepted: false }, { accepted: "true" }]) await assert.rejects(gateway({}, { status: 202, json: async () => payload }).kickPublicIngestQueue(), /did not acknowledge/);
  await assert.rejects(gateway({}, new Error("network timed out")).kickPublicIngestQueue(), /network timed out/);
});

test("invalid worker counts cannot create calls; the declared upper bound works", async () => {
  for (const count of [0, -1, 65, 1.5, NaN, Infinity, "2", true]) {
    const app = gateway(); await assert.rejects(app.kickPrivateScreenQueue(count), /integer from 1 to 64/); assert.equal(app.calls.length, 0);
  }
  assert.deepEqual(await gateway().kickPrivateScreenQueue(64), { started: true });
});
