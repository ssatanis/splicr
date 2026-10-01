import { cookies } from "next/headers";

import { DashboardShell, RAIL_COOKIE, type ShellUser } from "@/components/dashboard/shell";
import { supabaseConfigured } from "@/lib/supabase/env";
import { DEMO_COOKIE } from "@/lib/supabase/proxy";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Dashboard" };

async function resolveUser(): Promise<ShellUser> {
  const cookieStore = await cookies();
  const demo = cookieStore.get(DEMO_COOKIE)?.value === "1";

  if (supabaseConfigured) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims as
      | { email?: string; user_metadata?: { full_name?: string; organization_name?: string } }
      | undefined;
    if (claims?.email) {
      return {
        name: claims.user_metadata?.full_name ?? claims.email.split("@")[0],
        email: claims.email,
        org: claims.user_metadata?.organization_name ?? "Personal workspace",
        demo: false,
      };
    }
  }

  // Demo mode (cookie set by /api/demo). The proxy already redirected
  // anyone without a session or the demo cookie to /login.
  return demo
    ? { name: "Demo user", email: "demo@splicr.org", org: "Demo workspace", demo: true }
    : { name: "Session unavailable", email: "", org: "No active workspace", demo: false };
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, cookieStore] = await Promise.all([resolveUser(), cookies()]);
  // Read here rather than in the shell so the rail is already the right width
  // in the first HTML, instead of widening and then closing after hydration.
  const railCollapsed = cookieStore.get(RAIL_COOKIE)?.value === "1";
  return (
    <DashboardShell user={user} railCollapsed={railCollapsed}>
      {children}
    </DashboardShell>
  );
}
