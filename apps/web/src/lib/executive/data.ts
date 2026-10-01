import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type ExecutiveLab = { id: string; name: string; location: string | null };
export type ExecutiveInvite = {
  id: string;
  email: string;
  fullName: string | null;
  labName: string;
  institution: string | null;
  status: string;
  createdAt: string;
  preparedBy: string | null;
};

export type ExecutiveOverview = {
  labCount: number;
  researcherCount: number;
  pendingCount: number;
  institutionCount: number;
  labs: ExecutiveLab[];
  recentInvites: ExecutiveInvite[];
};

export async function getExecutiveOverview(): Promise<ExecutiveOverview> {
  const admin = createAdminClient();
  if (!admin) throw new Error("Executive data access is not configured.");

  const [labsResult, profilesResult, pendingResult, institutionsResult, invitesResult] = await Promise.all([
    admin.from("organizations").select("id, name, location", { count: "exact" }).order("name").limit(250),
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin
      .from("splicr_access_allowlist")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "invited"]),
    admin.from("profiles").select("institution").not("institution", "is", null).limit(1000),
    admin
      .from("splicr_access_allowlist")
      .select("id, email, full_name, workspace_name, institution, status, created_at, prepared_by_email")
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  for (const result of [labsResult, profilesResult, pendingResult, institutionsResult, invitesResult]) {
    if (result.error) throw new Error("Executive overview could not be loaded.");
  }

  const institutions = new Set(
    (institutionsResult.data ?? [])
      .map((row) => row.institution?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );

  return {
    labCount: labsResult.count ?? labsResult.data?.length ?? 0,
    researcherCount: profilesResult.count ?? 0,
    pendingCount: pendingResult.count ?? 0,
    institutionCount: institutions.size,
    labs: (labsResult.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      location: row.location,
    })),
    recentInvites: (invitesResult.data ?? []).map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      labName: row.workspace_name ?? "Existing laboratory",
      institution: row.institution,
      status: row.status,
      createdAt: row.created_at,
      preparedBy: row.prepared_by_email,
    })),
  };
}
