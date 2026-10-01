import Link from "next/link";

import { Card, DenseTable, PageHeader } from "@/components/dashboard/ui";
import { RecordPages, WorkspaceReadNotice } from "@/components/dashboard/workspace-records";
import { getCurrentContext } from "@/lib/data/org";
import { getWorkspaceScreens } from "@/lib/data/workspace-lists";

export const metadata = { title: "Screens" };
export const dynamic = "force-dynamic";

export default async function ScreensPage(props: PageProps<"/dashboard/screens">) {
  const [, search] = await Promise.all([getCurrentContext(), props.searchParams]);
  const page = typeof search.page === "string" ? Number(search.page) : 1;
  const result = await getWorkspaceScreens(page);
  return <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-6">
    <PageHeader dense title="Screens" body="Experiments recorded in your workspace" />
    {result.status !== "ready" ? <WorkspaceReadNotice status={result.status} /> : <Card title={`${result.total.toLocaleString("en-US")} recorded screens`}>
      {result.rows.length === 0 ? <p className="text-sm">{result.total === 0 ? "Your workspace has no recorded screens yet." : "No screens on this page. Open the first page."}</p> : <DenseTable minWidth={760}>
        <caption className="sr-only">Your workspace experiments and recorded analysis status</caption>
        <thead><tr>{["Screen", "Cell line", "Phenotype", "Modality", "Status", "QC"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
        <tbody>{result.rows.map((screen) => <tr key={screen.id}>
          <td><Link href={`/dashboard/screens/${screen.id}`} className="underline">{screen.name}</Link></td>
          <td>{screen.cell_line ?? "Not recorded"}</td><td>{screen.phenotype ?? "Not recorded"}</td>
          <td>{screen.modality}</td><td>{screen.status}</td><td>{screen.qc}</td>
        </tr>)}</tbody>
      </DenseTable>}
      <RecordPages path="/dashboard/screens" page={page} total={result.total} />
    </Card>}
  </div>;
}
