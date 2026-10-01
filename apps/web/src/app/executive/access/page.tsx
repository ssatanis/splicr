import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthPanel } from "@/components/auth/auth-panel";
import { ExecutiveAccessForm } from "@/components/executive/executive-access-form";
import { getExecutiveIdentity } from "@/lib/executive/access";

export const metadata: Metadata = { title: "Executive access" };
export const dynamic = "force-dynamic";

export default async function ExecutiveAccessPage() {
  if (await getExecutiveIdentity()) redirect("/executive");
  return <AuthPanel><ExecutiveAccessForm /></AuthPanel>;
}
