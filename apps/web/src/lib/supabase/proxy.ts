import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { supabaseConfigured, supabasePublishableKey, supabaseUrl } from "./env";

/** Product experiments with invented figures are never public routes. */
const DISABLED_PREFIXES = [
  "/pitch",
];

/**
 * Keeps the Supabase session fresh on every request and gates the
 * dashboard. The console has no anonymous product mode: a verified session is
 * required before any workspace route renders.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const pathname = request.nextUrl.pathname;
  if (DISABLED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const isDashboard = pathname.startsWith("/dashboard");
  if (!supabaseConfigured) {
    if (isDashboard) {
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

  if (isDashboard && !user) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // A signed-in researcher has no use for the sign-in page. `/reset-password`
  // is deliberately not in this list: a recovery link signs somebody in first
  // and then sends them there, so bouncing an authenticated visitor away from
  // it would break the one flow it exists for.
  if (user && ["/login", "/signup", "/forgot-password"].includes(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}
