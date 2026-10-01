import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { loadTs, srcPath } from "./helpers/load-ts.mjs";

const model = loadTs("components/pitch/model.ts");

test("the diligence score inverts risks and clamps every input", () => {
  assert.equal(model.translationalScore({
    structuralVulnerability: 84,
    contextualEscapeRisk: 24,
    toxicityRisk: 31,
  }), 77);
  assert.equal(model.translationalScore({
    structuralVulnerability: 200,
    contextualEscapeRisk: -50,
    toxicityRisk: -1,
  }), 100);
  assert.equal(model.translationalScore({
    structuralVulnerability: -1,
    contextualEscapeRisk: 200,
    toxicityRisk: 500,
  }), 0);
});

test("pitch mode can only return to an honest same-origin public route", () => {
  assert.equal(model.honestRoute("/evidence?source=pitch"), "/evidence?source=pitch");
  for (const value of [null, "", "https://example.test", "//example.test", "/pitch", "/pitch/run", "/dashboard/screens"]) {
    assert.equal(model.honestRoute(value), "/", String(value));
  }
});

test("the live run has the five ordered scientific stages and recorded logs", () => {
  assert.deepEqual(model.pipelineSteps.map((step) => step.key), [
    "ingest", "qc", "compute", "structure", "escape",
  ]);
  for (const step of model.pipelineSteps) {
    assert.equal(model.pipelineLogs[step.key].length, 3);
  }
  assert.match(model.pipelineLogs.structure.join(" "), /effect scores unchanged/i);
});

test("the global shortcut installs and removes one keyboard listener", () => {
  const source = fs.readFileSync(srcPath("components/pitch-mode-toggle.tsx"), "utf8");
  assert.match(source, /event\.code === "KeyD"/);
  assert.match(source, /addEventListener\("keydown", onKey\)/);
  assert.match(source, /removeEventListener\("keydown", onKey\)/);
  assert.match(source, /sessionStorage\.setItem/);
  assert.doesNotMatch(source, /clickCount|triple/i);
});

test("the heavy network is client-only and mounted from inside the drawer", () => {
  const drawer = fs.readFileSync(srcPath("components/pitch/target-drawer.tsx"), "utf8");
  const page = fs.readFileSync(srcPath("components/pitch/advanced-workspace.tsx"), "utf8");
  assert.match(drawer, /dynamic\(\(\) => import\("\.\/paralog-network"\)/);
  assert.match(drawer, /ssr: false/);
  assert.doesNotMatch(page, /paralog-network|react-force-graph/);
});

test("the advanced workspace labels its sample status and avoids forbidden branding", () => {
  const files = [
    "components/pitch/advanced-workspace.tsx",
    "components/pitch/live-run.tsx",
    "components/pitch/target-drawer.tsx",
    "components/pitch/cas12a-array.tsx",
  ].map((file) => fs.readFileSync(srcPath(file), "utf8")).join("\n");
  assert.match(files, /Illustrative advanced workspace/);
  assert.match(files, /paired perturbation/i);
  assert.doesNotMatch(files, /\bLLM\b|\bAI[- ]?(powered|generated|assistant|agent)\b/i);
});

test("the illustrative workspace is gated while the real console remains reachable", () => {
  // Every figure on /pitch is invented, so it is always unavailable. The real
  // dashboard remains reachable and applies its own session gate.
  const proxy = fs.readFileSync(srcPath("lib/supabase/proxy.ts"), "utf8");
  const list = proxy.slice(proxy.indexOf("const DISABLED_PREFIXES"),
                           proxy.indexOf("];", proxy.indexOf("const DISABLED_PREFIXES")));
  assert.match(list, /"\/pitch"/);
  assert.doesNotMatch(list, /"\/dashboard"/);
});

test("no hidden gesture reaches it from a public page", () => {
  // The toggle is not mounted in the root layout: a Cmd+Shift+D on the marketing
  // site that jumps to a console of invented figures is a surprise a visitor did
  // not ask for.
  const layout = fs.readFileSync(srcPath("app/layout.tsx"), "utf8");
  assert.doesNotMatch(layout, /PitchModeToggle/);
  const toggle = fs.readFileSync(srcPath("components/pitch-mode-toggle.tsx"), "utf8");
  assert.match(toggle, /NOT mounted in the root layout/);
});

test("the workspace says its figures are invented, not merely illustrative", () => {
  const shell = fs.readFileSync(srcPath("components/pitch/pitch-shell.tsx"), "utf8");
  assert.match(shell, /Every figure on it is invented/);
  assert.match(shell, /none of it is a measurement/);
  // And it points at where the measured results actually are.
  assert.match(shell, /evidence page/);
});
