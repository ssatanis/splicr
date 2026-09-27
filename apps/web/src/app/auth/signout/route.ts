import { NextResponse } from "next/server";

import { DEMO_COOKIE } from "@/lib/supabase/proxy";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  response.cookies.set(DEMO_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}
