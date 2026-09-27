"use client";

import { createBrowserClient } from "@supabase/ssr";

import { supabasePublishableKey, supabaseUrl } from "./env";

/** Browser-side Supabase client (singleton per tab). */
export function createClient() {
  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
