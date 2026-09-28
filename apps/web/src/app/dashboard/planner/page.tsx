import { Card, PageHeader } from "@/components/dashboard/ui";
import { getCurrentContext } from "@/lib/data/org";

export const metadata = { title: "Screen Planner" };
export const dynamic = "force-dynamic";

export default async function PlannerPage() {
  const context = await getCurrentContext();
  if (context.isDemo) {
    const { Planner } = await import("@/components/dashboard/planner");
    return <Planner />;
  }
  return <div className="flex flex-col gap-4">
    <PageHeader dense title="Screen Planner" body="Experimental design" />
    <Card title="Workspace planning is not connected">
      <p className="text-sm">A supported plan needs your library, assay design, coverage targets and variability estimates. This workspace does not yet compute statistical power, select a focused library or quote experimental costs.</p>
    </Card>
  </div>;
}
