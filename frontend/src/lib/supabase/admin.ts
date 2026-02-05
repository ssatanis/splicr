/**
 * Supabase admin client (service role).
 * No Next.js imports — safe to use in workers, scripts, and API routes.
 * For route handlers that also need cookies/auth, use server.ts createClient/getApiUser.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from './client';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabaseAdmin = createClient<Database>(url, key, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
