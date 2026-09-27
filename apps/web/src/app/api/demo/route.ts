import { NextResponse } from "next/server";

import { DEMO_COOKIE } from "@/lib/supabase/proxy";

/** Enables demo mode: the dashboard renders with fixture data, no account needed. */
export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  response.cookies.set(DEMO_COOKIE, "1", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
