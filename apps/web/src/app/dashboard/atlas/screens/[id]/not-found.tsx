import Link from "next/link";

import { Card, PageHeader } from "@/components/dashboard/ui";

export default function AtlasScreenNotFound() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader dense title="Atlas screen not found" />
      <Card title="No such screen">
        <p className="text-sm text-body">
          The Atlas has no screen with that id. Screen ids are the BioGRID ORCS screen numbers, so a
          mistyped or retired id ends here.
        </p>
        <p className="mt-3 text-sm">
          <Link href="/dashboard/atlas" className="text-cyan-600 underline decoration-line-strong underline-offset-2">
            Browse all screens
          </Link>
        </p>
      </Card>
    </div>
  );
}
