import { Card, PageHeader } from "@/components/dashboard/ui";
import { DiscoveryWorkspace } from "@/components/dashboard/discovery/workspace";
import { getDiscoveryView } from "@/lib/data/discovery";

export const dynamic = "force-dynamic";
export const metadata = { title: "Discovery worklists" };

export default async function DiscoveryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const value = (key: string) => typeof search[key] === "string" ? search[key] as string : undefined;
  const view = await getDiscoveryView(value("screen"), value("comparison"));
  return <div className="flex flex-col gap-4 pb-6"><PageHeader dense title="Discovery worklists" body="Choose target, perturbation, model and follow-up experiment" />
    <p className="text-sm text-body">Use measured evidence to plan useful experiments and collect independent outcomes. Experimental yield and superiority over expert practice have not been established.</p>
    {view.status === "ready" ? <DiscoveryWorkspace key={`${view.selected?.screen.id}:${view.selected?.comparison.id}:${view.selected?.runId}:${view.selected?.inputId}`} view={view} /> : <Card title="Discovery workspace unavailable"><p className="text-sm">{view.status === "workspace_required" ? "Sign in to a workspace to build discovery worklists." : "Workspace records could not be read. Reload to try again."}</p></Card>}
  </div>;
}
