import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { LOGO_CID, PREVIEW_REQUEST, confirmationEmail, notificationEmail } from "@/lib/email/templates";

/**
 * Renders the demo request emails in a browser, in development only.
 *
 * Email markup is hard to review in a diff, so this exists to look at the thing
 * itself. The inline `cid:` reference only resolves inside a mail client, so it
 * is swapped for the real logo here.
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

  const logo = await readFile(path.join(process.cwd(), "src", "lib", "email", "assets", "splicr-logo.png"));
  const dataUri = `data:image/png;base64,${logo.toString("base64")}`;

  return new NextResponse(email.html.replaceAll(`cid:${LOGO_CID}`, dataUri), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
