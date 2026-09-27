import { Planner } from "@/components/dashboard/planner";
import { PageHeader } from "@/components/dashboard/ui";

export const metadata = { title: "Screen Planner" };

export default function PlannerPage() {
  return (
    <div>
      <PageHeader eyebrow="Screen Planner" title="Screen smarter, not bigger" body="A focused library from past screens like yours, plus the coverage, replicates and cost the screen needs to actually work." />
      <Planner />
    </div>
  );
}
