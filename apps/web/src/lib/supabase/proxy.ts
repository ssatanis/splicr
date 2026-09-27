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
 * Keeps the Supabase session fresh on every request and gates the
 * dashboard. Visitors without a session can still explore the dashboard
 * in demo mode (cookie set by /api/demo) so the product can be reviewed
 * before the backend is connected.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const pathname = request.nextUrl.pathname;
  if (DISABLED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
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
