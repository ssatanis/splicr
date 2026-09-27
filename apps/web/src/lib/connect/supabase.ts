/**
 * The Supabase client the machine facing API uses.
 *
 * Deliberately not `@/lib/supabase/server`: that one reads and writes auth
 * cookies, which is right for a page and wrong here. A request to /api/v1
 * authenticates with a bearer key, so there is no session to refresh, and a
 * client that ignores cookies cannot accidentally act as whoever happens to be
 * signed in on the same browser.
 *
 * It lands on the `anon` Postgres role, which by design can read nothing in
 * `public` that matters. Every read goes through the `api_key_*` security
 * definer functions, which take the sha-256 digest of the caller's key.
 */
import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseConfigured, supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";

let client: SupabaseClient | null = null;

/**
 * One stateless client for the whole process. Safe to share: it holds no
 * session, so two requests cannot see each other's identity.
 *
 * Returns null when the environment has no Supabase project, which the route
 * turns into a 503 rather than a stack trace.
 */
export function apiSupabase(): SupabaseClient | null {
  if (!supabaseConfigured) return null;

  client ??= createClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-splicr-client": "connect-api" } },
  });

  return client;
}
