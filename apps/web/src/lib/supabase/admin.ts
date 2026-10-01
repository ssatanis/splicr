import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { supabaseUrl } from "./env";

/**
 * Trusted Auth client. It is deliberately kept out of the shared server client:
 * a service credential must never inherit request cookies or reach a browser
 * bundle. The caller receives null when deployment secrets are not configured.
 */
export function createAdminClient() {
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!supabaseUrl || !secret) return null;

  return createSupabaseClient(supabaseUrl, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
