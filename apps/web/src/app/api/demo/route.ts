import { NextResponse } from "next/server";

/**
 * Enables demo mode: the dashboard renders with fixture data, no account
 * needed. Disabled while the console is not open to the public — the
 * proxy blocks /dashboard outright regardless of this cookie, so this just
 * sends visitors home instead of setting it.
 */
export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/", request.url));
}

