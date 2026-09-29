/** Execute the report handler and real demo serializers without a live session/database. */
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
for (const [context, status, code] of [
  [{ isDemo: false, user: null }, 401, "authentication_required"],
]) {
  test(`non-demo ${status} response never imports or renders sample reports`, async () => {
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
  const app = handler({ isDemo: false, user: null });
  assert.equal((await app.get("invalid", "not-a-screen")).status, 401);
  assert.deepEqual(app.sampleImports(), []);
});

for (const format of ["csv", "json", "pdf"]) {
  test(`explicit demo ${format} export retains actual sample labels`, async () => {
    const app = handler({ isDemo: true, user: null });
    const response = await app.get(format);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("X-SplicR-Data-Source"), "sample-dataset");
    assert.match(response.headers.get("Content-Disposition"), new RegExp(`_SAMPLE\\.${format}`));
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    if (format === "json") {
      const doc = await response.json();
      assert.equal(doc.sample_data, true);
    } else if (format === "csv") {
      assert.match((await response.text()).slice(0, 300), /SAMPLE DATA/);
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
      assert.ok(bytes.length > 1000);
    }
    assert.ok(app.sampleImports().includes("@/lib/mock/data"));
  });
}

test("demo malformed format fails before loading sample data", async () => {
  const app = handler({ isDemo: true, user: null });
  assert.equal((await app.get("invalid")).status, 400);
  assert.deepEqual(app.sampleImports(), []);
});

test("demo unknown screen remains a labelled error, not a fallback report", async () => {
  const app = handler({ isDemo: true, user: null });
  const response = await app.get("json", "not-a-screen");
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "not_found");
});
