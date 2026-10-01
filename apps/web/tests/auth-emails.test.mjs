/* The six Supabase Auth templates, held to one standard. Sends nothing. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const templatesDir = path.join(root, "supabase/templates");

const { AUTH_EMAILS, authEmail, renderPreview, PREVIEW_VALUES } = loadTs("lib/email/auth-templates.ts");

/** What a researcher actually reads: the body with its markup and entities
 *  removed. The head holds `!important` and font stacks, which are not copy. */
const visible = (html) =>
  (html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const KEYS = [
  "confirm_signup",
  "invite",
  "magic_link",
  "change_email",
  "reset_password",
  "reauthentication",
];

/** Every colour the six messages are allowed to paint with: the public SplicR
 * brand palette plus its accessible text and line neutrals. */
const PALETTE = new Set([
  "#ffffff",
  "#174f62",
  "#113d4c",
  "#bfd8de",
  "#c2560a",
  "#fee8c9",
  "#fff6ea",
  "#4f6470",
  "#626b78",
  "#d3dbe1",
  "#e6ebef",
  "#eef5f7",
]);

test("the set is the six Supabase templates, once each", () => {
  assert.deepEqual(
    AUTH_EMAILS.map((email) => email.key),
    KEYS,
  );
  assert.equal(new Set(AUTH_EMAILS.map((email) => email.file)).size, KEYS.length);
  assert.equal(new Set(AUTH_EMAILS.map((email) => email.subject)).size, KEYS.length);
  assert.throws(() => authEmail("nope"), /Unknown auth email template/);
});

test("subjects are the agreed lines, with no exclamation and no product jargon", () => {
  assert.deepEqual(
    AUTH_EMAILS.map((email) => email.subject),
    [
      "Confirm your SplicR email",
      "Your SplicR invitation code",
      "Your SplicR sign-in code",
      "Confirm your new SplicR email",
      "Your SplicR password reset code",
      "Verify your SplicR identity",
    ],
  );
});

for (const email of AUTH_EMAILS) {
  test(`${email.key}: substitutes the variables Supabase provides`, () => {
    for (const variable of email.variables) assert.ok(email.html.includes(variable), variable);

    // Anything that looks like a Go variable must be one this template declares,
    // so a typo cannot ship as literal "{{ .Emai }}" in a researcher's inbox.
    const used = new Set(email.html.match(/\{\{[^}]*\}\}/g) ?? []);
    for (const variable of used) assert.ok(email.variables.includes(variable), `undeclared ${variable}`);
  });

  test(`${email.key}: is a self-contained document with nothing to load`, () => {
    assert.match(email.html, /^<!DOCTYPE html>/);
    assert.match(email.html, /<html lang="en">/);
    assert.ok(!/<img\b/i.test(email.html), "no images, so nothing can be blocked");
    assert.ok(!/<script\b/i.test(email.html), "no script");
    assert.ok(!/<link\b/i.test(email.html), "no web fonts or external stylesheet");
    assert.ok(!/@import|url\(/i.test(email.html), "no remotely loaded asset");
    assert.ok(!/<form\b|<input\b/i.test(email.html), "no form controls");
  });

  test(`${email.key}: uses only the product palette`, () => {
    for (const colour of email.html.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
      assert.ok(PALETTE.has(colour.toLowerCase()), `${colour} is outside the palette`);
    }
    assert.ok(!/rgba?\(/i.test(email.html), "opacities are resolved to hex for Outlook");
  });

  test(`${email.key}: carries no middle dot separator`, () => {
    for (const form of ["·", "&middot;", "&#183;", "•", "∙"]) {
      assert.ok(!email.html.includes(form), `found ${JSON.stringify(form)}`);
    }
  });

  test(`${email.key}: uses no implementation language and no marketing voice`, () => {
    const text = visible(email.html);
    const banned = [
      /\bAI[- ]powered\b/i,
      /\bAI\b/,
      /\bLLMs?\b/i,
      /\bClaude\b/i,
      /\bChatGPT\b/i,
      /\bagents?\b/i,
      /\bunlock\b/i,
      /\bsupercharge/i,
      /\bget started\b/i,
    ];
    for (const pattern of banned) assert.ok(!pattern.test(text), `found ${pattern}`);
    assert.ok(!text.includes("!"), "no exclamation marks");
  });

  test(`${email.key}: states no expiry Supabase has not told it`, () => {
    // Supabase exposes no lifetime variable, so a number of hours in the body
    // would be a claim the template cannot keep in step with Auth settings.
    const text = visible(email.html);
    assert.ok(!/\b\d+\s*(hour|hours|minute|minutes|day|days)\b/i.test(text), "hardcoded lifetime");
  });

  test(`${email.key}: is laid out for email clients`, () => {
    const tables = email.html.match(/<table\b[^>]*>/g) ?? [];
    assert.ok(tables.length > 0);
    for (const table of tables) assert.match(table, /role="presentation"/, table);
    assert.ok(email.html.includes('width="600"'), "fixed width for Outlook");
    assert.ok(email.html.includes("max-width:600px"), "fluid ceiling everywhere else");
    assert.ok(email.html.includes('name="color-scheme" content="light"'));
  });

  test(`${email.key}: opens with a preheader and the masthead`, () => {
    assert.ok(email.preheader.length > 20 && email.preheader.length < 120);
    assert.ok(email.html.includes(email.preheader), "preheader is in the hidden line");
    assert.ok(email.html.includes(">SplicR</td>"), "wordmark is type, not an image");
  });
}

test("every message is code-only and exposes no authentication infrastructure", () => {
  for (const email of AUTH_EMAILS) {
    assert.ok(email.variables.includes("{{ .Token }}"), `${email.key} has a one-time code`);
    assert.ok(!email.html.includes("{{ .ConfirmationURL }}"), `${email.key} has no token link`);
    assert.ok(!/<a\b|href\s*=/i.test(email.html), `${email.key} has no clickable link`);
    assert.ok(!/supabase|auth\/v1\/verify|token_hash/i.test(email.html), `${email.key} hides infrastructure`);
    assert.ok(!/paste this address into your browser/i.test(email.html), `${email.key} has no URL fallback`);
  }
  assert.deepEqual(authEmail("reauthentication").variables, ["{{ .Token }}"]);
});

test("every message says what to do if it was not expected", () => {
  for (const email of AUTH_EMAILS) {
    assert.match(visible(email.html), /(did not|were not) (expect|expecting|request|start)/i, email.key);
  }
});

test("the checked-in templates match the module", () => {
  for (const email of AUTH_EMAILS) {
    const file = path.join(templatesDir, email.file);
    assert.ok(fs.existsSync(file), `${email.file} is missing, run npm run emails:auth`);
    assert.equal(fs.readFileSync(file, "utf8"), `${email.html}\n`, `${email.file} is stale`);
  }
});

test("the preview substitutes placeholders that cannot be mistaken for live ones", () => {
  const preview = renderPreview(authEmail("invite"));
  assert.ok(!preview.includes("{{"), "no variable survives the preview");
  assert.ok(preview.includes("418902"));
  assert.ok(!/supabase|auth\/v1\/verify|token_hash/i.test(preview));
  assert.ok(Object.values(PREVIEW_VALUES).every((value) => value.length > 0));
});
