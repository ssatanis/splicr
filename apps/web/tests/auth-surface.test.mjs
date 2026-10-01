/* The sign-in surface, and the rules that keep it invitation-only.
   Reads source and runs pure helpers. Sends nothing and signs nobody in. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

/** Source with its comments removed.
 *
 *  These tests look for words a researcher would see. A comment explaining why
 *  the form cannot create an account contains the phrase "create an account",
 *  and failing on that would train the next person to delete the explanation
 *  rather than keep the rule. */
const code = (relative) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const AUTH_SOURCES = [
  "apps/web/src/components/auth/auth-form.tsx",
  "apps/web/src/components/auth/auth-panel.tsx",
  "apps/web/src/components/auth/forgot-password-form.tsx",
  "apps/web/src/components/auth/set-password-form.tsx",
  "apps/web/src/components/auth/verify-code-form.tsx",
  "apps/web/src/app/(auth)/login/page.tsx",
  "apps/web/src/app/(auth)/signup/page.tsx",
  "apps/web/src/app/(auth)/forgot-password/page.tsx",
  "apps/web/src/app/(auth)/reset-password/page.tsx",
  "apps/web/src/app/(auth)/verify/page.tsx",
];

test("nothing on the auth surface offers to create an account", () => {
  const banned = [
    /Create an account/i,
    /Create your workspace/i,
    /\bSign up\b/i,
    /\bRegister\b/i,
    /Get started/i,
    /Continue with Google/i,
    /Continue with GitHub/i,
    /signInWithOAuth/,
    /auth\.signUp\(/,
  ];
  const offenders = [];
  for (const relative of AUTH_SOURCES) {
    const source = code(relative);
    for (const pattern of banned) {
      if (pattern.test(source)) offenders.push(`${relative}: ${pattern}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("the public login cannot request a code or enrol anybody", () => {
  const form = read("apps/web/src/components/auth/auth-form.tsx");
  assert.ok(!/signInWithOtp\(/.test(form), "login never sends public OTPs");
  assert.ok(!/Email me a code/i.test(form));
  assert.match(form, /I have an invitation code/);
  assert.match(form, /href="\/verify\?flow=invite"/);
});

test("password recovery is the only public code request and cannot create accounts", () => {
  const recovery = code("apps/web/src/components/auth/forgot-password-form.tsx");
  assert.match(recovery, /resetPasswordForEmail\(/);
  assert.ok(!/signUp\(|shouldCreateUser:\s*true/.test(recovery));
  assert.match(recovery, /setSent\(true\)/, "recovery proceeds to neutral code entry");
  assert.ok(!/No account (exists|was found)|that email is not registered/i.test(recovery));
});

test("the signup route leads nowhere but the sign-in page", () => {
  const page = read("apps/web/src/app/(auth)/signup/page.tsx");
  assert.match(page, /redirect\("\/login"\)/);
  assert.ok(!/AuthForm|AuthPanel/.test(page), "it renders no form at all");
});

test("the auth frame uses the landing-page sheet and artwork without a split panel", () => {
  const panel = read("apps/web/src/components/auth/auth-panel.tsx");
  assert.match(panel, /bg-peach/, "the page keeps the landing site's outer canvas");
  assert.match(panel, /rounded-\[2rem\]/, "the white landing-page sheet remains visible");
  assert.match(panel, /<HeroField/, "the landing hero artwork is reused from source");
  assert.match(panel, /bg-teal-800/, "navigation uses the landing-page teal");
  assert.match(panel, /max-w-\[460px\]/, "the form remains a focused readable width");
  assert.ok(!/<aside|grid-cols-/.test(panel), "there is no unrelated split-screen panel");
});

test("the public navigation calls the authenticated product Portal", () => {
  const nav = read("apps/web/src/components/marketing/nav.tsx");
  assert.match(nav, /href="\/login"[\s\S]*?>\s*Portal\s*</);
  assert.ok(!/href="\/login"[\s\S]{0,300}>\s*Request a Demo\s*</.test(nav));
});

test("email fields use an institutional address as their neutral example", () => {
  for (const relative of [
    "apps/web/src/components/auth/auth-form.tsx",
    "apps/web/src/components/auth/forgot-password-form.tsx",
    "apps/web/src/components/auth/verify-code-form.tsx",
  ]) {
    assert.match(read(relative), /placeholder="you@institution\.edu"/, relative);
  }
});

test("password setup asks for and validates a confirmation", () => {
  const form = read("apps/web/src/components/auth/set-password-form.tsx");
  assert.match(form, /id="confirm-password"/);
  assert.match(form, /password !== confirmation/);
  assert.match(form, /autoComplete="new-password"/);
});

test("new-user invitation codes pass through password setup before onboarding", () => {
  const verifier = read("apps/web/src/components/auth/verify-code-form.tsx");
  assert.match(verifier, /purpose === "invite"/);
  assert.match(verifier, /reset-password\?next=/);
  assert.match(verifier, /dashboard\/onboarding/);
  assert.match(verifier, /type:\s*EmailOtpType/);
});

test("errors are written for a researcher, not copied from the client", () => {
  const { authProblem, writeProblem } = loadTs("lib/errors.ts");

  const bad = authProblem(new Error("Invalid login credentials"));
  assert.equal(bad.message, "That email and password do not match an account.");

  // An unrecognised failure gets the house sentence, never its own text: an
  // unrecognised error is exactly where an internal string is most likely.
  const unknown = authProblem(new Error("PGRST301 jwt malformed for role anon in schema auth"));
  assert.ok(!/PGRST301|jwt|anon|schema/i.test(`${unknown.message} ${unknown.action}`));
  assert.match(unknown.message, /Nothing was changed/);

  const duplicate = writeProblem(new Error('23505 duplicate key value violates unique constraint "org_invites_email_key"'));
  assert.equal(duplicate.message, "That already exists here.");
  assert.ok(!/23505|constraint|org_invites/.test(duplicate.message));
});

test("a `next` from the query string cannot leave SplicR", () => {
  const { safeNext } = loadTs("lib/supabase/redirect.ts");
  assert.equal(safeNext("/dashboard/screens"), "/dashboard/screens");
  assert.equal(safeNext(null), "/dashboard");
  // The three that turn an auth link into an open redirect.
  assert.equal(safeNext("https://elsewhere.example"), "/dashboard");
  assert.equal(safeNext("//elsewhere.example"), "/dashboard");
  assert.equal(safeNext("/\\elsewhere.example"), "/dashboard");
});

test("every emailed code is verified on a first-party SplicR screen", () => {
  const verifier = read("apps/web/src/components/auth/verify-code-form.tsx");
  const page = read("apps/web/src/app/(auth)/verify/page.tsx");
  assert.match(verifier, /auth\.verifyOtp\(/);
  assert.match(verifier, /purpose === "magiclink" \? "email" : purpose/);
  assert.match(verifier, /safeNext\(/, "the destination is validated");
  assert.match(page, /PublicVerifyCodeForm/);
});
