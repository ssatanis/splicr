import { NextResponse } from "next/server";

import { DEMO_COOKIE } from "@/lib/supabase/proxy";

/**
 * Enables demo mode: the dashboard renders with fixture data, no account
 * needed. Public deploys still block /dashboard in the proxy; local
 * development uses this cookie to open the console without a session.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  response.cookies.set(DEMO_COOKIE, "1", { path: "/" });
  return response;
}

