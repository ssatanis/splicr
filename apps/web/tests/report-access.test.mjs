/** Execute the report handler without a live session/database. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const src = path.join(import.meta.dirname, "../src");
class TestResponse extends Response {
  static json(body, init = {}) {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    return new TestResponse(JSON.stringify(body), { ...init, headers });
  }
}

function handler(context) {
  const imports = [];
  const cache = new Map();
  function load(file) {
    const absolute = path.resolve(file);
    if (cache.has(absolute)) return cache.get(absolute);
    const exports = {};
    cache.set(absolute, exports);
    const compiled = ts.transpileModule(fs.readFileSync(absolute, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const requireAdapter = (name) => {
      imports.push(name);
      if (name === "next/server") return { NextResponse: TestResponse };
      if (name === "@/lib/data/org") return { getCurrentContext: async () => context };
      if (name.startsWith("@/")) return load(path.join(src, `${name.slice(2)}.ts`));
      if (name.startsWith(".")) return load(path.resolve(path.dirname(absolute), `${name}.ts`));
      return nativeRequire(name);
    };
    vm.runInNewContext(compiled, { exports, require: requireAdapter, URL, Headers, Request, Response, Buffer, TextEncoder, TextDecoder, Uint8Array });
    return exports;
  }
  const route = load(path.join(src, "app/api/report/[id]/route.ts"));
  return {
    async get(format = "json", id = "scr_demo") {
      return route.GET(new Request(`https://splicr.test/api/report/${id}?format=${format}`), { params: Promise.resolve({ id }) });
    },
    sampleImports: () => imports.filter((name) => name.startsWith("@/lib/mock/") || name.startsWith("@/lib/report/")),
  };
}

// A signed-in workspace member is not refused any more: they get the recorded run
// of their own screens as CSV or JSON. That path has its own tests in
// report-workspace.test.mjs. What stays here is that a request with no session is
// refused before anything sample or workspace is loaded.
for (const [context, status, code] of [[{ user: null }, 401, "authentication_required"]]) {
  test(`${status} response never imports or renders sample reports`, async () => {
    const app = handler(context);
    for (const format of ["csv", "json", "pdf"]) {
      const response = await app.get(format);
      assert.equal(response.status, status);
      assert.equal((await response.json()).error.code, code);
      assert.equal(response.headers.get("X-SplicR-Data-Source"), null);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
    assert.deepEqual(app.sampleImports(), []);
  });
}

test("authentication precedes format parsing and sample-screen lookup", async () => {
  const app = handler({ user: null });
  assert.equal((await app.get("invalid", "not-a-screen")).status, 401);
  assert.deepEqual(app.sampleImports(), []);
});

test("the retired demo marker grants no report access", async () => {
  const app = handler({ isDemo: true, user: null });
  assert.equal((await app.get("json")).status, 401);
  assert.deepEqual(app.sampleImports(), []);
});
