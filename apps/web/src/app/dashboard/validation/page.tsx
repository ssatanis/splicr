/**
 * Truth Loop: what the bench found, next to what the model said.
 *
 * A workspace reads its own recorded outcomes for the address in the address
 * bar and logs new ones through server actions that re-check the caller's role.
 * Anonymous and synthetic product paths do not reach this page.
 */
import { redirect } from "next/navigation";

import { Card, PageHeader } from "@/components/dashboard/ui";
import { TruthLoopView } from "@/components/dashboard/truth-loop/view";
import { WorkspaceReadNotice } from "@/components/dashboard/workspace-records";
import { getCurrentContext } from "@/lib/data/org";
import { deleteOutcome, logOutcome, updateOutcome } from "@/lib/data/outcome-actions";
import { getOutcomeView } from "@/lib/data/outcomes";
import {
  OUTCOME_PAGE_SIZE,
  outcomeHref,
  parseOutcomeFilters,
} from "@/lib/outcomes/model";
import { GENE_SYMBOL } from "@/lib/outcomes/schema";

export const metadata = { title: "Truth Loop" };
export const dynamic = "force-dynamic";

const BASE = "/dashboard/validation";
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function single(value: string | string[] | undefined): string {
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim();
}

/** `?log=TP53&logScreen=<id>` opens the form already filled in, from a link on a hit. */
function readPrefill(search: Record<string, string | string[] | undefined>) {
  const gene = single(search.log);
  const screenId = single(search.logScreen);
  if (!GENE_SYMBOL.test(gene)) return null;
  return { gene, screenId: ID.test(screenId) ? screenId : "" };
}

export default async function ValidationPage(props: PageProps<"/dashboard/validation">) {
  const [, search] = await Promise.all([getCurrentContext(), props.searchParams]);
  const filters = parseOutcomeFilters(search);
  const prefill = readPrefill(search);

  const view = await getOutcomeView(filters);
  if (view.status !== "ready") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader dense title="Truth Loop" body="Validation outcomes recorded in your workspace" />
        <WorkspaceReadNotice status={view.status} />
      </div>
    );
  }

  // A page past the end (a bookmarked page 9 after rows were deleted) goes to
  // the last page that exists rather than showing an empty table.
  const lastPage = Math.max(1, Math.ceil(view.total / OUTCOME_PAGE_SIZE));
  if (filters.page > lastPage) redirect(outcomeHref(BASE, filters, { page: lastPage }));

  return (
    <>
      {!view.canWrite && (
        <Card title="Read-only role">
          <p className="text-sm text-body">
            Your role in this workspace can read outcomes but not log them. Ask an owner or admin for the member role.
          </p>
        </Card>
      )}
      <TruthLoopView
        mode="workspace"
        rows={view.rows}
        total={view.total}
        counts={view.counts}
        screens={view.screens}
        filters={filters}
        canWrite={view.canWrite}
        canDelete={view.canDelete}
        actions={{ log: logOutcome, update: updateOutcome, remove: deleteOutcome }}
        prefill={prefill}
        exportHref={outcomeHref(`${BASE}/export`, filters, { page: null })}
      />
    </>
  );
}
