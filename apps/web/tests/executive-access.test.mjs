/* The executive console has a deliberately separate, short-lived authority. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("the executive allowlist is exactly the three named people", () => {
  const source = read("apps/web/src/lib/executive/constants.ts");
  const addresses = source.match(/[a-z0-9.]+@cornell\.edu/g) ?? [];
  assert.deepEqual(addresses, ["ss4497@cornell.edu", "is455@cornell.edu", "prm93@cornell.edu"]);
  for (const name of ["Sahaj Satani", "Ishaan Samantray", "Pranav Mettu"]) assert.ok(source.includes(name));
});

test("ordinary authentication is insufficient for executive access", () => {
  const source = read("apps/web/src/lib/executive/access.ts");
  assert.match(source, /createHmac\("sha256"/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /httpOnly:\s*true/);
  assert.match(source, /sameSite:\s*"strict"/);
  assert.match(source, /EXECUTIVE_SESSION_SECONDS\s*=\s*15 \* 60/);
  assert.match(source, /auth\.getClaims\(\)/);
  assert.match(source, /userId !== proof\.userId/);
});

test("executive OTPs never create an account and are checked again after verification", () => {
  const source = read("apps/web/src/app/executive/actions.ts");
  assert.match(source, /shouldCreateUser:\s*false/);
  assert.match(source, /executiveByEmail/);
  assert.match(source, /verifyOtp\(/);
  assert.match(source, /type:\s*"email"/);
  assert.match(source, /markExecutiveVerified/);
});

test("personalized invitations are server-authorized and land in code verification", () => {
  const source = read("apps/web/src/app/executive/actions.ts");
  assert.match(source, /getExecutiveIdentity\(\)/);
  assert.match(source, /createAdminClient\(\)/);
  for (const field of ["full_name", "institution", "preferred_title", "professional_role", "lab_location", "time_zone", "prepared_by_email"]) {
    assert.ok(source.includes(field), field);
  }

  // Delivery is not written twice. The executive console hands the prepared
  // invitation to the same module the lab members page uses, so a code issued
  // here reaches an inbox by the route that reports why when it does not.
  assert.match(source, /deliverNewIdentityInvite\(/);
  assert.ok(!/inviteUserByEmail|generateLink/.test(source), "delivery is not reimplemented here");
  assert.match(source, /delivery\.state === "failed"/);

  const delivery = read("apps/web/src/lib/auth/invitations.ts");
  assert.match(delivery, /\/verify\?flow=invite/);
});

test("the database trigger copies prepared values into editable onboarding data", () => {
  const sql = read("supabase/migrations/20261001011700_executive_invitation_personalization.sql");
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /for update/);
  assert.match(sql, /v_access\.full_name/);
  assert.match(sql, /v_access\.institution/);
  assert.match(sql, /v_access\.lab_location/);
  assert.match(sql, /v_access\.time_zone/);
});
