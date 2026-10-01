/* The authenticated console's design system, held in place.
   Renders nothing and starts no server: these read source. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const CSS = read("apps/web/src/app/globals.css");

/** Everything a signed-in researcher sees. */
const CONSOLE_DIRS = [
  "apps/web/src/components/dashboard",
  "apps/web/src/app/dashboard",
  "apps/web/src/components/auth",
  "apps/web/src/app/(auth)",
];

function consoleFiles() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  CONSOLE_DIRS.forEach((d) => walk(path.join(root, d)));
  return out;
}

const FILES = consoleFiles();

/** The `.console { ... }` token block, up to its closing brace. */
function consoleScope() {
  const start = CSS.indexOf("\n.console {");
  assert.ok(start > -1, "the console theme scope exists");
  const end = CSS.indexOf("\n}", start);
  return CSS.slice(start, end);
}

test("the console scope exists and is the only theme the console reads", () => {
  const scope = consoleScope();
  // The tokens that decide whether the console is white, black and navy. If a
  // future change drops one of these, the console silently inherits the
  // marketing teal again, which is exactly the failure this guards.
  for (const token of [
    "--color-ink: #111111",
    "--color-canvas: #ffffff",
    "--color-teal-800: #24334b",
  ]) {
    assert.ok(scope.includes(token), `missing ${token}`);
  }
});

test("every colour the console scope defines is white, near black, navy or the attention amber", () => {
  const scope = consoleScope();

  /** Documented, one line each, so adding a colour means arguing for it here. */
  const ALLOWED = new Set([
    "#ffffff", // surfaces
    "#111111", // primary text
    "#3d3d3d", // body prose, near black at 82%
    "#6b6b6b", // muted text, near black at 58%, 5.1:1 on white
    "#0b111c", // navy, the modal scrim
    "#141c2a", // navy, the execution terminal
    "#162133",
    "#1b2740",
    "#1e2b40",
    "#24334b", // the accent
    "#32455f",
    "#324563",
    "#3f5678",
    "#4d668c",
    "#5c3208", // attention amber, darkest
    "#703c0b",
    "#8a4b0f",
    "#93500f",
    "#a25812",
    "#b8671a",
    "rgb(17 17 17 /", // near black at an opacity: borders, rows, hovers
    "rgb(36 51 75 /", // navy at an opacity: selected navigation, tints
    "rgb(138 75 15 /", // attention amber at an opacity
  ]);

  const found = scope.match(/#[0-9a-fA-F]{3,8}\b|rgb\([^)]*\//g) ?? [];
  const rejected = found.map((c) => c.toLowerCase()).filter((c) => !ALLOWED.has(c));
  assert.deepEqual(rejected, [], `colours outside the console palette: ${rejected.join(", ")}`);
});

test("no console source hardcodes a marketing colour", () => {
  // A hex in a `stroke` or a `fill` is invisible to the theme scope, so this is
  // the one way the old palette could survive a repaint: inside the figures.
  const LEGACY = ["#f87315", "#174f62", "#07b6d3", "#fdd7a9", "#fee8c9", "#fff6ea", "#e2e7ef"];
  const offenders = [];
  for (const file of FILES) {
    const source = fs.readFileSync(file, "utf8");
    for (const hex of LEGACY) {
      if (source.toLowerCase().includes(hex)) offenders.push(`${path.relative(root, file)}: ${hex}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("figures take their colours from one module, not from literals", () => {
  const palette = read("apps/web/src/components/dashboard/chart-colors.ts");
  for (const token of ["DEPLETED", "ENRICHED", "NAVY", "SEQUENTIAL", "axisStyle"]) {
    assert.match(palette, new RegExp(`export const ${token}\\b`), `chart-colors exports ${token}`);
  }
  for (const relative of [
    "apps/web/src/components/dashboard/charts.tsx",
    "apps/web/src/components/dashboard/ui.tsx",
    "apps/web/src/components/dashboard/evidence/guide-chart.tsx",
  ]) {
    assert.match(read(relative), /chart-colors/, `${relative} reads the shared data palette`);
  }
});

test("the console is rounded, on a scale, and never a bubble", () => {
  const offenders = [];
  for (const file of FILES) {
    const source = fs.readFileSync(file, "utf8");
    const relative = path.relative(root, file);
    // Sharp geometry: a previous direction, deliberately reversed.
    for (const match of source.match(/rounded-none/g) ?? []) offenders.push(`${relative}: ${match}`);
    // 24px and up is the marketing radius. Console surfaces step 8, 12, 16.
    for (const match of source.match(/rounded-(3xl|4xl)/g) ?? []) offenders.push(`${relative}: ${match}`);
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));

  // And the panel token, which most surfaces inherit rather than naming a class.
  assert.match(consoleScope(), /--radius-panel: 0\.75rem/, "panels are 12px");
});

test("the rail is white with a navy selected state, not a dark wall", () => {
  const shell = read("apps/web/src/components/dashboard/shell.tsx");
  // The rail element itself, wherever its className sits. Matching `<aside
  // className="` on one line made this fail the moment the attribute wrapped,
  // which is formatting rather than design.
  const rail = shell.slice(shell.indexOf("<aside"), shell.indexOf(">", shell.indexOf("<Sidebar")));
  assert.match(rail, /border-r border-line bg-white/, "the rail is white");
  // Scoped to the rail, not the file: a tooltip is allowed to be dark, and
  // banning the token everywhere caught RailTip rather than the rail.
  assert.ok(!/bg-teal-900|bg-teal-800|text-white\/\d/.test(rail),
    "no dark rail treatment remains");
  assert.match(shell, /btn btn-navy/, "the one primary action is navy");
  assert.match(shell, /New screen/, "and is named for what a researcher starts");

  const scope = CSS.slice(CSS.indexOf('.console .dash-nav-link[data-active="true"] {'));
  assert.match(scope, /background: var\(--color-navy-tint\)/, "selected navigation is a navy tint");
});

test("the console theme scope is actually applied", () => {
  assert.match(read("apps/web/src/components/dashboard/shell.tsx"), /className="console /);
  assert.doesNotMatch(
    read("apps/web/src/app/(auth)/layout.tsx"),
    /className="console /,
    "auth intentionally inherits the landing-page visual system",
  );
  assert.match(CSS, /body:has\(\.console\)/, "the page behind the console is white too");
});

test("no console copy uses a middle dot separator", () => {
  const offenders = [];
  for (const file of FILES) {
    const source = fs.readFileSync(file, "utf8");
    for (const form of ["·", "&middot;", "&#183;"]) {
      if (source.includes(form)) offenders.push(path.relative(root, file));
    }
  }
  assert.deepEqual([...new Set(offenders)], []);
});
