#!/usr/bin/env node

/**
 * Prepare one invitation-only researcher and, only after credential rotation is
 * explicitly acknowledged, ask Supabase Auth to deliver the invitation.
 *
 * Examples:
 *   npm run auth:provision -- --email researcher@lab.edu --name "Researcher Name" --workspace "Example Lab"
 *   npm run auth:provision -- --email researcher@lab.edu --workspace "Existing Lab" --org-id 00000000-0000-0000-0000-000000000000
 *   SPLICR_KEYS_ROTATED=1 npm run auth:provision -- --email researcher@lab.edu --name "Researcher Name" --workspace "Example Lab" --send
 */
import process from "node:process";

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith("--")) continue;
  const next = process.argv[index + 1];
  args.set(key.slice(2), next && !next.startsWith("--") ? next : true);
  if (next && !next.startsWith("--")) index += 1;
}

const email = String(args.get("email") ?? "").trim().toLowerCase();
const name = String(args.get("name") ?? "").trim();
const workspace = String(args.get("workspace") ?? "").trim();
const orgId = String(args.get("org-id") ?? "").trim();
const send = args.get("send") === true;
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !workspace) {
  throw new Error("Provide --email and --workspace.");
}
if (orgId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orgId)) {
  throw new Error("--org-id must be a UUID.");
}

const databaseUrl = process.env.SUPABASE_DB_URL?.trim();
if (!databaseUrl) throw new Error("SUPABASE_DB_URL is required.");

const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(
    `insert into public.splicr_access_allowlist
       (email, org_id, create_workspace, workspace_name, role, status, expires_at)
     values ($1, $2, $3, $4, 'owner', 'pending', now() + interval '14 days')
     on conflict ((lower(email))) do update set
       create_workspace = excluded.create_workspace,
       workspace_name = excluded.workspace_name,
       org_id = excluded.org_id,
       role = 'owner',
       status = 'pending',
       consumed_at = null,
       expires_at = excluded.expires_at`,
    [email, orgId || null, !orgId, orgId ? null : workspace],
  );
} finally {
  await client.end();
}

console.log(`Prepared invitation authorization for ${email}. No email has been sent.`);

if (send) {
  if (process.env.SPLICR_KEYS_ROTATED !== "1") {
    throw new Error("Refusing delivery: set SPLICR_KEYS_ROTATED=1 only after Supabase and Resend keys are rotated.");
  }
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  const site = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://www.splicr.org").replace(/\/$/, "");
  if (!url || !secret) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  const supabase = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  const passwordSetup = `/reset-password?next=${encodeURIComponent("/dashboard/onboarding")}`;
  const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${site}/auth/callback?next=${encodeURIComponent(passwordSetup)}`,
    data: { organization_name: workspace, ...(name ? { full_name: name } : {}) },
  });
  if (error) throw error;
  console.log(`Supabase accepted the invitation delivery request for ${email}.`);
}
