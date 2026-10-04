/* The console's navigation, greeting and empty states. Reads source. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const SHELL = read("apps/web/src/components/dashboard/shell.tsx");
const ZONES = read("apps/web/src/components/dashboard/overview/zones.tsx");
const GREETING = read("apps/web/src/components/dashboard/greeting.tsx");

test("the desktop rail collapses, and remembers it server side", () => {
  assert.match(SHELL, /aria-label="Collapse sidebar"/);
  assert.match(SHELL, /aria-label="Expand sidebar"/);
  assert.match(SHELL, /RAIL_WIDE = "15rem"/);
  assert.match(SHELL, /RAIL_NARROW = "4\.25rem"/);

  // A cookie rather than browser storage, so the server renders the chosen
  // width in the first HTML. With localStorage the rail would be wide in the
  // markup and close itself after hydration, on every page load.
  assert.match(SHELL, /RAIL_COOKIE = "splicr_rail"/);
  assert.match(
    read("apps/web/src/app/dashboard/layout.tsx"),
    /cookieStore\.get\(RAIL_COOKIE\)/,
    "the layout reads it before rendering",
  );
  assert.match(SHELL, /railCollapsed/, "and hands it to the shell");
});

test("the collapse animates width only, and not for anyone who asked it not to", () => {
  const aside = SHELL.match(/transition-\[width\][^"]*/)?.[0] ?? "";
  assert.match(aside, /duration-\[180ms\]/, "inside the 160-220ms band");
  assert.match(aside, /motion-reduce:transition-none/);
  assert.ok(!/transition-all/.test(SHELL), "nothing animates every property");
});

test("a collapsed rail still names everything, to a screen reader and on focus", () => {
  assert.match(SHELL, /function RailTip\(/);
  // Hover alone would leave the rail unusable from the keyboard.
  assert.match(SHELL, /onFocus=\{show\}/, "the label appears on keyboard focus");
  assert.match(SHELL, /onBlur=\{hide\}/, "and leaves again");
  // The label stays in the accessibility tree at both widths.
  assert.match(SHELL, /collapsed && "sr-only"/);
});

test("the rail label is positioned against the viewport, not inside the scroller", () => {
  const tip = SHELL.slice(SHELL.indexOf("function RailTip("));
  // The rail is overflow-hidden and the navigation inside it scrolls. An
  // absolutely positioned label at left-full was clipped by the first and
  // counted towards the scrollable width of the second, which is what put a
  // horizontal scrollbar across the bottom of a 68px rail.
  assert.ok(!/left-full/.test(tip), "no label hangs off the rail in flow");
  assert.match(tip, /className="pointer-events-none fixed/, "it is a fixed box");
  assert.match(tip, /getBoundingClientRect/, "placed from the control it describes");
  assert.match(tip, /addEventListener\("scroll", hide, true\)/, "and dismissed by a scroll");
});

test("the collapsed rail shows the SplicR logo, not a stand-in for it", () => {
  // The rail used to carry an abstract four-rectangle glyph that nothing else
  // in the brand uses. LogoGlyph is the S of the wordmark, cut from the same
  // file the wordmark itself is drawn from.
  assert.match(SHELL, /<LogoGlyph/, "the collapsed rail renders the logo");
  assert.ok(!/<LogoMark/.test(SHELL), "and not the marquee bullet");
  const logo = fs.readFileSync(path.join(root, "apps/web/src/components/brand/logo.tsx"), "utf8");
  assert.match(logo, /const MARK = "\/brand\/splicr-mark\.png"/);
  assert.ok(
    fs.existsSync(path.join(root, "apps/web/public/brand/splicr-mark.png")),
    "and the asset exists",
  );
});

test("the command palette field is the one control in the console without a focus ring", () => {
  const css = fs.readFileSync(path.join(root, "apps/web/src/app/globals.css"), "utf8");
  // The ring itself is still there for everything else.
  assert.match(css, /\.console :focus-visible \{\s*\n\s*outline: 2px solid var\(--color-navy\)/);
  assert.match(css, /\.console \.palette-input:focus-visible/, "and switched off for the palette");
  const rule = css.slice(css.indexOf(".palette-input:focus,"));
  assert.match(rule.slice(0, 220), /outline: none/);
  const palette = fs.readFileSync(
    path.join(root, "apps/web/src/components/dashboard/command-palette.tsx"),
    "utf8",
  );
  assert.match(palette, /className="palette-input/, "the input carries the class");
});

test("the mobile drawer is modal and gives focus back", () => {
  assert.match(SHELL, /role="dialog"/);
  assert.match(SHELL, /aria-modal="true"/);
  assert.match(SHELL, /event\.key === "Escape"/);
  assert.match(SHELL, /opener\?\.focus\(\)/, "focus returns to the control that opened it");
  assert.match(SHELL, /lg:hidden/, "and it exists only below the desktop breakpoint");
});

test("the greeting is the largest line on the overview, and steps down on a phone", () => {
  const heading = GREETING.match(/<h1 className="([^"]+)"/)?.[1] ?? "";
  assert.match(heading, /text-\[26px\]/, "phone");
  assert.match(heading, /md:text-\[30px\]/, "tablet");
  assert.match(heading, /lg:text-\[32px\]/, "desktop");
  assert.match(heading, /text-ink/, "near black, not an accent");
});

test("what to do next is a list of rows, not a wall of arrows", () => {
  const block = ZONES.slice(ZONES.indexOf("export function NextActions"));
  for (const arrow of ["&rarr;", "→", "ArrowRight", "ChevronRight"]) {
    assert.ok(!block.includes(arrow), `found ${arrow}`);
  }
  assert.ok(!/group-hover:translate-x/.test(block), "and nothing slides on hover");
  // Compact: a small radius, modest padding, and two columns rather than four.
  assert.match(block, /rounded-lg border px-3\.5 py-3/);
  assert.match(block, /lg:grid-cols-2/);
});

test("an empty workspace is given something to do, never invented records", () => {
  const empty = read("apps/web/src/components/dashboard/empty-state.tsx");
  assert.match(empty, /action\?: \{ label: string; href: string \}/);
  assert.match(ZONES, /<EmptyState/, "the screen list uses it");
  assert.match(ZONES, /Run your first screen/);

  const overview = read("apps/web/src/app/dashboard/page.tsx");
  assert.match(overview, /const fresh = stats\.screens === 0/);
  // The three queue counts are dropped rather than shown as zeroes, and the
  // page says the workspace is new rather than that a read failed.
  assert.match(overview, /fresh \? null : \(/);
  assert.match(overview, /This workspace has no screens yet/);
});

test("the settings page says what it is in one sentence", () => {
  const settings = read("apps/web/src/app/dashboard/settings/page.tsx");
  assert.match(
    settings,
    /Manage your profile, lab, and default settings for new runs\. Each section saves separately\./,
  );
  assert.ok(!/so each panel saves on its own/.test(settings), "the long version is gone");
});

test("the Atlas page states its provenance once", () => {
  const atlas = read("apps/web/src/app/dashboard/atlas/page.tsx");
  assert.ok(!/human screens from/.test(atlas), "no corpus subtitle");
  assert.ok(!/own analysis and hit rule/.test(atlas), "no caveat strip");
  assert.match(atlas, /MIT licence/, "the footer still carries release and licence");
});

test("the time zone falls back in the documented order", () => {
  const { greetingForHour, isValidTimeZone, FALLBACK_TIME_ZONE } = loadTs("lib/time.ts");
  assert.equal(greetingForHour(4), "Good evening");
  assert.equal(greetingForHour(5), "Good morning");
  assert.equal(greetingForHour(11), "Good morning");
  assert.equal(greetingForHour(12), "Good afternoon");
  assert.equal(greetingForHour(16), "Good afternoon");
  assert.equal(greetingForHour(17), "Good evening");
  assert.equal(greetingForHour(23), "Good evening");

  assert.ok(isValidTimeZone("America/New_York"));
  assert.ok(isValidTimeZone("Asia/Tokyo"));
  assert.ok(!isValidTimeZone("Mars/Olympus"));
  assert.ok(!isValidTimeZone(""));
  assert.equal(FALLBACK_TIME_ZONE, "UTC");

  // The greeting component consults the lab's zone before the browser's.
  assert.match(GREETING, /isValidTimeZone\(timeZone\) \? timeZone : browser/);
});
