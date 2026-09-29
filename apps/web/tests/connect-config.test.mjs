/**
 * Connect's snippets and reference, checked against the endpoint itself.
 *
 * The page describes GET /api/v1/hits in four languages and in two tables. Each
 * of those is tested against the route's own code and its real output, so the
 * documentation cannot promise a parameter the route rejects, omit a field it
 * returns, or hand a reader a snippet that does not parse.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

import { loadTs, srcPath } from "./helpers/load-ts.mjs";

const config = loadTs("lib/connect/config.ts");
const route = fs.readFileSync(srcPath("app/api/v1/hits/route.ts"), "utf8");

const SCREEN = "0199f4c2-1f8b-7c31-9a0e-2f4f1d8c77aa";
const inputs = (over = {}) => ({ origin: "https://splicr.test", screenId: SCREEN, apiKey: config.KEY_PLACEHOLDER, ...over });
const LANGUAGES = config.SNIPPET_LANGUAGES.map((l) => l.value);

test("the four languages are offered and each builds a non-empty snippet", () => {
  assert.deepEqual(LANGUAGES, ["curl", "python", "r", "javascript"]);
  for (const language of LANGUAGES) {
    const code = config.snippetFor(language, inputs());
    assert.ok(code.length > 80, language);
    assert.ok(code.includes("https://splicr.test/api/v1/hits"), `${language} points at this instance`);
    assert.ok(code.includes(SCREEN), `${language} names the screen`);
  }
});

test("every parameter a snippet sends is one the endpoint takes", () => {
  const allowed = new Set(config.HITS_PARAMS.map((p) => p.name));
  for (const language of LANGUAGES) {
    const code = config.snippetFor(language, inputs());
    const named = [...code.matchAll(/\b(screen|max_fdr|min_chance|direction|verdict|limit|offset)\b/g)].map((m) => m[1]);
    assert.ok(named.includes("screen"), `${language} sends the screen`);
    for (const name of named) assert.ok(allowed.has(name), `${language}: ${name}`);
  }
  const url = new URL(config.hitsUrl({ origin: "https://x.test", screenId: SCREEN }));
  for (const key of url.searchParams.keys()) assert.ok(allowed.has(key), key);
});

test("the snippets parse: Python, JavaScript and shell are valid as written", () => {
  const python = config.snippetFor("python", inputs());
  const py = spawnSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: python });
  assert.equal(py.status, 0, py.stderr?.toString());

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  assert.doesNotThrow(() => new AsyncFunction(config.snippetFor("javascript", inputs())));

  const sh = spawnSync("sh", ["-n"], { input: config.snippetFor("curl", inputs()) });
  assert.equal(sh.status, 0, sh.stderr?.toString());

  const rscript = spawnSync("Rscript", ["--version"]);
  if (rscript.status === 0) {
    const parsed = spawnSync("Rscript", ["-e", "invisible(parse(file('stdin')))"], { input: config.snippetFor("r", inputs()) });
    assert.equal(parsed.status, 0, parsed.stderr?.toString());
  }
});

test("a key is read from the environment in code, and appears only in the line that sets it", () => {
  const minted = "spk_live_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
  for (const language of ["python", "r", "javascript"]) {
    const code = config.snippetFor(language, inputs({ apiKey: minted }));
    assert.ok(code.includes("SPLICR_API_KEY"), language);
    const occurrences = code.split(minted).length - 1;
    assert.equal(occurrences, 1, `${language} carries the key exactly once, in the export line`);
    const exportLine = code.split("\n").find((line) => line.includes(minted));
    assert.match(exportLine, /export SPLICR_API_KEY/);
    assert.match(exportLine, /^(#|\/\/)/, "and that line is a comment, not code");
  }
  // curl is a single command a reader runs once, so it takes the key inline.
  assert.ok(config.snippetFor("curl", inputs({ apiKey: minted })).includes(`Authorization: Bearer ${minted}`));
  // With no key minted, no snippet contains anything that looks like a real one.
  for (const language of LANGUAGES) {
    assert.doesNotMatch(config.snippetFor(language, inputs()), /spk_live_[A-Za-z0-9]{20,}/);
    assert.ok(config.snippetFor(language, inputs()).includes(config.KEY_PLACEHOLDER));
  }
});

test("a screen id that could break out of a quoted string becomes the placeholder", () => {
  for (const hostile of [`x"; rm -rf ~; echo "`, "a b", "$(whoami)", "id'\n", "a".repeat(200), ""]) {
    for (const language of LANGUAGES) {
      const code = config.snippetFor(language, inputs({ screenId: hostile }));
      assert.ok(code.includes(config.SCREEN_PLACEHOLDER), `${language}: ${JSON.stringify(hostile)}`);
      assert.doesNotMatch(code, /rm -rf|whoami/);
    }
  }
});

test("the Python and R snippets follow paging to the last page", () => {
  assert.match(config.snippetFor("python", inputs()), /next_offset/);
  assert.match(config.snippetFor("python", inputs()), /while offset is not None/);
  assert.match(config.snippetFor("r", inputs()), /is\.null\(page\$paging\$next_offset\)/);
  assert.match(config.snippetFor("javascript", inputs()), /paging\.next_offset is null/);
});

test("only hits:read is presented as doing something, because only it does", () => {
  assert.deepEqual([...config.LIVE_SCOPES], ["hits:read"]);
  assert.equal(config.scopeIsLive("hits:read"), true);
  for (const scope of ["atlas:read", "screens:read", "screens:write", "outcomes:write"]) {
    assert.equal(config.scopeIsLive(scope), false, scope);
  }
  assert.equal(config.CONNECT_SCOPES[0], "hits:read", "the live scope is listed first");
  // The route really does check exactly that scope.
  assert.match(route, /HITS_SCOPE/);
  assert.equal(config.HITS_SCOPE, "hits:read");
  const otherScopeChecks = [...route.matchAll(/scopes\.includes\(([^)]+)\)/g)].map((m) => m[1]);
  assert.deepEqual(otherScopeChecks, ["HITS_SCOPE"]);
});

test("the parameter reference is exactly the route's own query schema", () => {
  const block = route.slice(route.indexOf("const querySchema = z.object({"), route.indexOf("// Row shapes returned by the RPCs"));
  const inSchema = [...block.matchAll(/^ {2}(\w+): z/gm)].map((m) => m[1]);
  assert.deepEqual(config.HITS_PARAMS.map((p) => p.name).sort(), inSchema.sort());
  assert.match(route, /const MAX_LIMIT = 500;/);
  assert.match(route, /const DEFAULT_LIMIT = 50;/);
  const limit = config.HITS_PARAMS.find((p) => p.name === "limit");
  assert.match(limit.type, /1 to 500/);
  assert.match(limit.note, /50/);
  for (const value of ["depleted", "enriched"]) assert.ok(route.includes(`"${value}"`));
  for (const value of ["real_new", "real_known", "real_generic", "artifact", "uncertain"]) {
    assert.ok(config.HITS_PARAMS.find((p) => p.name === "verdict").type.includes(value), value);
    assert.ok(route.includes(`"${value}"`), value);
  }
});

test("the response reference lists exactly the fields the route returns", async () => {
  class R extends Response {
    static json(body, init) {
      return new R(JSON.stringify(body), init);
    }
  }
  const key = { key_id: "k", org_id: "o", org_name: "Org", org_slug: "org", scopes: ["hits:read"], revoked: false, expired: false };
  const screen = { screen_id: SCREEN, org_id: "o", name: "S", run_id: "r", library_slug: null };
  const hit = {
    n_total: 1, hit_id: "h", gene_symbol: "TP53", direction: "depleted", verdict: null, comparison: null, chance_real: null,
    chance_lower: null, chance_upper: null, novelty: null, lfc: null, fdr: null, p_value: null, n_guides: null,
    n_good_guides: null, cn_corrected: null, atlas_hit_count: null, atlas_screen_count: null, atlas_hit_rate: null,
    model_version: null, reason: null, flags: null,
  };
  const rpc = async (name) => ({ data: { api_key_resolve: [key], api_key_touch: null, api_key_screen: [screen], api_key_hits: [hit] }[name], error: null });
  const mod = loadTs("app/api/v1/hits/route.ts", {
    mocks: {
      "server-only": {},
      "next/server": { NextResponse: R },
      "@/lib/connect/supabase": { apiSupabase: () => ({ rpc }) },
    },
  });
  const response = await mod.GET({
    nextUrl: new URL(`https://x.test/api/v1/hits?screen=${SCREEN}`),
    headers: new Headers({ Authorization: "Bearer spk_live_test" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  const returned = Object.keys(body.hits[0]);
  const documented = config.HITS_FIELDS.map((f) => f.name);
  assert.deepEqual([...documented].sort(), [...returned].sort());
  assert.equal(new Set(documented).size, documented.length, "no field is documented twice");
  assert.equal(body.hits[0].validation_probability, null);
  assert.deepEqual(Object.keys(body.hits[0].atlas).sort(), ["hit_count", "hit_rate", "screen_count"]);
  for (const top of ["organization", "screen", "query", "paging", "hits"]) assert.ok(top in body, top);
  for (const paging of ["total", "returned", "limit", "offset", "next_offset"]) assert.ok(paging in body.paging, paging);
});

test("every status the page lists is one the route can return, and none is missing", () => {
  const listed = config.HITS_STATUS.map((s) => s.code);
  const returned = new Set([...route.matchAll(/fail\(\s*(\d{3})/g)].map((m) => m[1]));
  returned.add("200");
  assert.deepEqual([...listed].sort(), [...returned].sort());
});

test("the shell snippet is safe to paste", () => {
  const out = execFileSync("sh", ["-c", `printf %s '${config.snippetFor("curl", inputs()).replace(/'/g, "'\\''")}' | sh -n && echo ok`]);
  assert.equal(out.toString().trim(), "ok");
});
