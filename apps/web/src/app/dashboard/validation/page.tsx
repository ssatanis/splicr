import { Suspense } from "react";

import { TruthLoop } from "./truth-loop";

export const metadata = { title: "Truth Loop" };

/**
 * The page is the loop. The sort lives in the query string so a reader can send
 * their PI the exact ordering they are looking at, and reading it with
 * `useSearchParams` has to sit inside a Suspense boundary or the whole route
 * falls back to client rendering.
 */
export default function ValidationPage() {
  return (
    <Suspense fallback={<div className="min-h-0 flex-1" aria-hidden="true" />}>
      <TruthLoop />
    </Suspense>
  );
}
