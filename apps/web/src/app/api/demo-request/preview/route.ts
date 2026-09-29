import { NextResponse } from "next/server";

import { PREVIEW_REQUEST, confirmationEmail, notificationEmail } from "@/lib/email/templates";

/**
 * Renders the demo request emails in a browser, in development only.
 *
 * Email markup is hard to review in a diff, so this exists to look at the thing itself.
 *
 *   /api/demo-request/preview            the confirmation
 *   /api/demo-request/preview?kind=team  the internal notification
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const kind = new URL(request.url).searchParams.get("kind");
  const email = kind === "team" ? notificationEmail(PREVIEW_REQUEST) : confirmationEmail(PREVIEW_REQUEST);

  return new NextResponse(email.html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
