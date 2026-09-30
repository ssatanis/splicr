import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { supabaseConfigured, supabasePublishableKey, supabaseUrl } from "./env";

export const DEMO_COOKIE = "splicr_demo";

/**
 * The console (dashboard, login, signup, invite links) isn't open to the
 * public yet. Routed to the marketing homepage here instead of deleted so
 * the code is ready to flip back on later.
 */
const DISABLED_PREFIXES = ["/login", "/signup", "/dashboard", "/invite"];

/**
 * Whether the console answers on this deployment.
 *
 * This used to test `NODE_ENV !== "development"`, which meant production was
 * closed permanently and there was no way to open it: the first lab to be
 * invited would have been redirected to the marketing page, and the only remedy
 * would have been a code change and a deploy. Meanwhile NEXT_PUBLIC_ENABLE_CONSOLE
 * was already set in apps/web/.env.local and nothing anywhere read it, so the
 * switch somebody had reached for did nothing at all.
 *
 * It is an explicit flag now. Absent, the console stays closed, so nothing about
 * the current public deployment changes by merging this. Set it in Vercel when a
 * lab is ready, and it opens without a code change.
 *
 * Local `next dev` keeps working because the flag lives in .env.local, which is
 * where it already was.
 */
const CONSOLE_OPEN = process.env.NEXT_PUBLIC_ENABLE_CONSOLE === "1";

/**
 * Keeps the Supabase session fresh on every request and gates the
 * dashboard. Visitors without a session can still explore the dashboard
 * in demo mode (cookie set by /api/demo) so the product can be reviewed
 * before the backend is connected.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const pathname = request.nextUrl.pathname;
  if (
    !CONSOLE_OPEN &&
    DISABLED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  ) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const isDashboard = pathname.startsWith("/dashboard");
  const isDemo = request.cookies.get(DEMO_COOKIE)?.value === "1";

  if (!supabaseConfigured) {
    if (isDashboard && !isDemo) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Do not put logic between createServerClient and getClaims: it can
  // cause hard-to-debug session issues. getClaims verifies the JWT
  // signature locally against the project's JWKS (asymmetric keys).
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims ?? null;

  if (isDashboard && !user && !isDemo) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (user && (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/signup")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}
