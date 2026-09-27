import { Suspense } from "react";

import { AtlasExplorer } from "@/components/dashboard/atlas-explorer";

export const metadata = { title: "Atlas" };

/**
 * The page is the explorer. There is no header block above it beyond the one
 * dense line the explorer draws itself, because the facets, the sort and the gene
 * lookup all live in the query string and the explorer reads them with
 * `useSearchParams`, which has to sit inside a Suspense boundary or the whole
 * route falls back to client rendering.
 */
export default function AtlasPage() {
  return (
    <Suspense fallback={<div className="min-h-0 flex-1" aria-hidden="true" />}>
      <AtlasExplorer />
    </Suspense>
  );
}
