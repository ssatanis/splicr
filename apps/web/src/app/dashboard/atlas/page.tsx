import { Suspense } from "react";

import { Card, PageHeader } from "@/components/dashboard/ui";
import { getCurrentContext } from "@/lib/data/org";

export const metadata = { title: "Atlas" };
export const dynamic = "force-dynamic";

export default async function AtlasPage() {
  const context = await getCurrentContext();
  if (context.isDemo) {
    const { AtlasExplorer } = await import("@/components/dashboard/atlas-explorer");
    return <Suspense fallback={<div aria-hidden="true" />}><AtlasExplorer /></Suspense>;
  }
  return <div className="flex flex-col gap-4">
    <PageHeader dense title="Atlas" body="Public screen evidence" />
    <Card title="Atlas browsing is not connected">
      <p className="text-sm">The analysis engine can use imported public screen evidence, but this workspace does not yet have a connected Atlas browser. Historical evidence recorded by an analysis is available with that run when it has been persisted.</p>
    </Card>
  </div>;
}
