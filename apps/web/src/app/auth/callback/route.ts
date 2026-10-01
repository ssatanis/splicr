import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/supabase/redirect";

/**
 * Where every SplicR email link lands.
 *
 * Supabase sends one of two shapes depending on the flow, and this handles
 * both rather than assuming one:
 *
 *  - `?code=` from the PKCE flow, exchanged for a session.
 *  - `?token_hash=&type=` from an invitation, a recovery or an email change,
 *    verified here so the researcher ends up inside SplicR with a session
 *    instead of on a Supabase-hosted page with nothing to do next.
 *
 * `next` decides where they go afterwards and comes from the query string, so
 * it is validated: an unchecked `next` turns any SplicR email link into an open
 * redirect, which is the ingredient a convincing phishing page is missing.
 */

/** Flows that have to end at a password field rather than the dashboard: the
 *  researcher has just proved they own the address and has no usable password
 *  yet, or is replacing one. */
const NEEDS_PASSWORD: EmailOtpType[] = ["invite", "recovery"];

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const requested = safeNext(searchParams.get("next"));
  const destination = type && NEEDS_PASSWORD.includes(type) ? "/reset-password" : requested;

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${destination}`);
    return NextResponse.redirect(`${origin}/login?error=link`);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${destination}`);
  }

  return NextResponse.redirect(`${origin}/login?error=link`);
}
