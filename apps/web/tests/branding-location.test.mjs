/* Cornell is where SplicR started, not where it is. The origin belongs to the
   About page; everywhere else the company is in New York, NY. These tests fail
   if that leaks back into shared copy. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const { site } = loadTs("lib/site.ts");

// A booking account's URL is an integration address, not location copy.
// Remove only that configured URL so university wording elsewhere still fails.
const locationCopy = (text) => text.replaceAll(site.calendly, "");

/** The only source file allowed to name the university, and the generated
 *  research artifacts that record an older verified page state and are rewritten
 *  only by the verification pipeline, never by hand. */
const ALLOWED = [
  "apps/web/src/app/(marketing)/about/page.tsx",
  // Required executive email identities, not public location or brand copy.
  "apps/web/src/lib/executive/constants.ts",
  "apps/web/tests/branding-location.test.mjs",
];
const ALLOWED_DIRS = ["research/", "docs/", "data/", "apps/web/public/evidence/"];

/** Everything a researcher, a visitor or a search engine can see. */
const SCANNED = [
  "apps/web/src",
  "apps/web/public",
  "supabase/templates",
];

const BANNED = [/Cornell/i, /\bIthaca\b/i];

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      yield* walk(full);
    } else if (/\.(tsx?|mjs|js|json|html|md|txt|css)$/.test(entry.name)) {
      yield full;
    }
  }
}

test("the shared site location is exactly the canonical public one", () => {
  assert.equal(site.location, "New York, NY");
  // Origin history is not an address field. If a future field carries it, it
  // has to be named for what it is, not smuggled into the location.
  assert.ok(!/cornell|ithaca/i.test(locationCopy(JSON.stringify(site))), "site config names no university in location copy");
});

test("no product copy outside the About page names the university or Ithaca", () => {
  const offenders = [];
  for (const base of SCANNED) {
    const dir = path.join(root, base);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const relative = path.relative(root, file);
      if (ALLOWED.includes(relative)) continue;
      if (ALLOWED_DIRS.some((prefix) => relative.startsWith(prefix))) continue;
      const contents = locationCopy(fs.readFileSync(file, "utf8"));
      for (const pattern of BANNED) {
        if (pattern.test(contents)) offenders.push(`${relative}: ${pattern}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `banned location wording:\n${offenders.join("\n")}`);
});

test("the About page keeps the origin, and sources it locally", () => {
  const about = fs.readFileSync(path.join(root, "apps/web/src/app/(marketing)/about/page.tsx"), "utf8");
  assert.match(about, /Cornell University/, "the origin statement is still there");
  assert.ok(!/site\.location/.test(about), "origin history is not read from the shared location");
});

test("every rendered location is the canonical one", () => {
  // The footer, the legal pages and the emails all read the one field, so a
  // change lands everywhere at once rather than in five places by hand.
  for (const relative of [
    "apps/web/src/components/marketing/footer.tsx",
    "apps/web/src/app/(marketing)/terms/page.tsx",
    "apps/web/src/app/(marketing)/privacy/page.tsx",
    "apps/web/src/lib/email/templates.ts",
    "apps/web/src/lib/email/auth-templates.ts",
  ]) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    assert.match(source, /site\.location/, `${relative} reads the shared location`);
  }

  for (const file of fs.readdirSync(path.join(root, "supabase/templates"))) {
    if (!file.endsWith(".html")) continue;
    const html = fs.readFileSync(path.join(root, "supabase/templates", file), "utf8");
    assert.ok(html.includes(site.location), `${file} shows ${site.location}`);
  }
});

test("the footer carries no middle dot separator", () => {
  const footer = fs.readFileSync(path.join(root, "apps/web/src/components/marketing/footer.tsx"), "utf8");
  for (const form of ["·", "&middot;", "&#183;"]) {
    assert.ok(!footer.includes(form), `found ${JSON.stringify(form)}`);
  }
});
