/**
 * Loads a TypeScript module from `src/` into the test process.
 *
 * The web app has no unit-test runner of its own, and the existing tests
 * compile one file at a time with a hand-written `require`. That stops working
 * the moment a module imports its neighbours, so this is the same idea with a
 * resolver: relative and `@/` imports are compiled recursively, `mocks` replaces
 * anything by exact specifier, and node built-ins and packages resolve normally.
 *
 * Modules run in the test's own realm (a `Function`, not a fresh VM context),
 * so arrays and objects they return compare equal to the ones a test builds.
 * A separate context would make every `deepStrictEqual` fail on prototypes.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const here = import.meta.dirname;
const SRC = path.resolve(here, "../../src");
const nodeRequire = createRequire(path.resolve(here, "../../package.json"));

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx", ".json"];

function resolveFile(specifier, from) {
  const base = specifier.startsWith("@/")
    ? path.join(SRC, specifier.slice(2))
    : path.resolve(path.dirname(from), specifier);
  for (const ext of ["", ...EXTENSIONS]) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`Cannot resolve ${specifier} from ${from}`);
}

export function loadTs(entry, { mocks = {}, globals = {} } = {}) {
  const cache = new Map();

  const load = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    if (file.endsWith(".json")) return JSON.parse(fs.readFileSync(file, "utf8"));
    const mod = { exports: {} };
    cache.set(file, mod);
    const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    });
    const localRequire = (specifier) => {
      if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
      // A stylesheet import is a bundler instruction, not a module. Next.js turns
      // it into a CSS chunk; here it has no meaning and parsing it as JavaScript
      // fails on the first selector. Components that import their own stylesheet
      // are ordinary components to these tests.
      if (/\.(css|scss|sass)$/.test(specifier)) return {};
      if (specifier.startsWith(".") || specifier.startsWith("@/")) return load(resolveFile(specifier, file));
      return nodeRequire(specifier);
    };
    const names = Object.keys(globals);
    new Function("exports", "require", "module", "__filename", ...names, outputText)(
      mod.exports,
      localRequire,
      mod,
      file,
      ...names.map((name) => globals[name]),
    );
    return mod.exports;
  };

  return load(entry.startsWith("/") ? entry : path.join(SRC, entry));
}

export const srcPath = (...parts) => path.join(SRC, ...parts);
