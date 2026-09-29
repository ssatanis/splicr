/* Metadata exports are evaluated without rendering or contacting external services. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "../../..");
const routes = ["/", "/technology", "/pipeline", "/evidence", "/about", "/careers", "/contact"];
function load(relative) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  const require = (name) => {
    if (name === "@/lib/site") return load("apps/web/src/lib/site.ts");
    if (name === "@/lib/marketing-metadata") return load("apps/web/src/lib/marketing-metadata.ts");
    // Components and unrelated data are not evaluated by these metadata exports.
    return {};
  };
  vm.runInNewContext(output, { exports, require, URL });
  return exports;
}

const descriptions = new Set();
const titles = new Set();
for (const route of routes) {
  test(`${route} exports its own canonical URL and consistent social metadata`, () => {
    const filename = `apps/web/src/app/(marketing)${route === "/" ? "" : route}/page.tsx`;
    const { metadata } = load(filename);
    const expected = `https://splicr.org${route}`;
    assert.equal(metadata.alternates.canonical, expected);
    assert.equal(metadata.openGraph.url, expected);
    assert.equal(metadata.openGraph.type, "website");
    assert.equal(metadata.openGraph.siteName, "SplicR");
    assert.equal(metadata.openGraph.description, metadata.description);
    assert.equal(metadata.twitter.description, metadata.description);
    assert.equal(metadata.twitter.title, metadata.openGraph.title);
    assert.equal(metadata.twitter.card, "summary_large_image");
    assert.ok(metadata.description.length > 30);
    assert.ok(!descriptions.has(metadata.description), "route description must be specific");
    assert.ok(!titles.has(metadata.openGraph.title), "route social title must be specific");
    descriptions.add(metadata.description);
    titles.add(metadata.openGraph.title);
    if (route === "/") assert.equal(metadata.title.absolute, "SplicR");
    else assert.equal(metadata.openGraph.title, `${metadata.title} | SplicR`);
  });
}
