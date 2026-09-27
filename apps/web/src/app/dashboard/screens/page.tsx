import { Plus } from "lucide-react";
import Link from "next/link";

import { ScreensTable } from "@/components/dashboard/screens-table";
import { PageHeader } from "@/components/dashboard/ui";

export const metadata = { title: "Screens" };

export default function ScreensPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Screens"
        title="All screens"
        body="Every upload becomes a screen with a versioned pipeline run. Click one to open its workspace."
        actions={
          <Link href="/dashboard/upload" className="btn btn-orange btn-sm">
            <Plus className="w-4 h-4" /> New run
          </Link>
        }
      />
      <ScreensTable />
    </div>
  );
}
