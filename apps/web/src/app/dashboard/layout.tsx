import { cookies } from "next/headers";

import { DashboardShell, RAIL_COOKIE, type ShellUser } from "@/components/dashboard/shell";
import { getCurrentContext } from "@/lib/data/org";

export const metadata = { title: "Dashboard" };

async function resolveUser(): Promise<ShellUser> {
  const { user, profile, org, workspaces } = await getCurrentContext();
  return {
    name: profile?.full_name ?? user?.email?.split("@")[0] ?? "Researcher",
    email: user?.email ?? "",
    org: org?.name ?? "Workspace pending",
    orgId: org?.id ?? null,
    orgLogo: org?.logo_url ?? null,
    workspaces,
    demo: false,
  };
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
