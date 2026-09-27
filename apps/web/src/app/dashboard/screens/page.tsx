import { Suspense } from "react";

import { ScreensTable } from "@/components/dashboard/screens-table";

export const metadata = { title: "Screens" };

/**
 * The page is the table. There is no page header block above it beyond one line,
 * because the filter, sort and status state all live in the query string and the
 * table reads them with `useSearchParams`, which has to sit inside a Suspense
 * boundary or the whole route falls back to client rendering.
 */
export default function ScreensPage() {
  return (
    <Suspense fallback={<div className="min-h-0 flex-1" aria-hidden="true" />}>
      <ScreensTable />
    </Suspense>
  );
}
