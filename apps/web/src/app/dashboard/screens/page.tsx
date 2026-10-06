import { Card, PageHeader } from "@/components/dashboard/ui";
import { RecordPages, WorkspaceReadNotice } from "@/components/dashboard/workspace-records";
import { getCurrentContext } from "@/lib/data/org";
import { getWorkspaceScreens } from "@/lib/data/workspace-lists";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { ScreensTable } from "@/components/dashboard/screens-table";

export const metadata = { title: "Screens" };
export const dynamic = "force-dynamic";

export default async function ScreensPage(props: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [context, search] = await Promise.all([getCurrentContext(), props.searchParams]);
  const page = typeof search.page === "string" ? Number(search.page) : 1;
  const result = await getWorkspaceScreens(page);
  const hasActive = result.status === "ready" && result.rows.some(s => ["queued", "running", "analysing", "pending"].includes(s.status));
  
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-6">
      <AutoRefresh active={hasActive} intervalMs={5000} />
      <PageHeader dense title="Screens" body="Experiments recorded in your workspace" />
      {result.status !== "ready" ? (
        <WorkspaceReadNotice status={result.status} />
      ) : (
        <Card>
          {result.rows.length === 0 ? (
            <div className="p-4">
              <h2 className="mb-4 text-lg font-medium text-ink">Recorded screens</h2>
              <p className="text-sm">
                {result.total === 0 ? "Your workspace has no recorded screens yet." : "No screens on this page. Open the first page."}
              </p>
            </div>
          ) : (
            <ScreensTable screens={result.rows} canDelete={context.role === "owner" || context.role === "admin"} />
          )}
          <RecordPages path="/dashboard/screens" page={page} total={result.total} />
        </Card>
      )}
    </div>
  );
}
