/**
 * New analysis.
 *
 * Two workflows that produce different things, said apart at the top of the
 * page rather than implied by panel size:
 *
 *   My experiment     the lab's own reads or counts, uploaded from the browser
 *                     into the workspace's own storage prefix, analysed, and
 *                     kept private to the workspace.
 *   Published study   an accession the ingest engine reanalyses from raw reads.
 *                     The result is shared evidence and lands in the Atlas, not
 *                     in this workspace's screen list.
 *
 * The page prefills the pipeline settings from the workspace's own defaults, so
 * a lab that always runs the same library and the same callers never retypes
 * them. Everything it prefills stays editable and is shown as a default rather
 * than as a finding.
 *
 * This replaces the old "no browser upload yet" page. The browser upload now
 * lands in workspace storage, records a manifest, inspects the stored bytes and
 * queues the same engine path a command-line run uses.
 */
import Link from "next/link";

import { IntakeWorkspace } from "@/components/dashboard/intake/intake-workspace";
import { UploadFlow } from "@/components/dashboard/intake/upload-flow";
import { RequestForm } from "@/components/dashboard/request-form";
import { Card, PageHeader, Panel } from "@/components/dashboard/ui";
import { listLibraries } from "@/lib/data/libraries";
import { getCurrentContext, getOrgSettings } from "@/lib/data/org";
import { listScreenRequests } from "@/lib/data/screen-requests";
import { DEFAULT_WORKSPACE_SETTINGS, ROLE_RANK } from "@/lib/data/types";

export const metadata = { title: "New analysis" };
export const dynamic = "force-dynamic";

export default async function NewAnalysisPage() {
  const context = await getCurrentContext();
  const [requests, catalog, settings] = await Promise.all([
    listScreenRequests(),
    listLibraries(),
    context.org ? getOrgSettings(context.org.id) : Promise.resolve(DEFAULT_WORKSPACE_SETTINGS),
  ]);

  const role = context.role;
  const canRun = role !== null && ROLE_RANK[role] >= ROLE_RANK.member;

  const libraries = catalog.libraries.map((library) => ({
    id: library.id,
    name: library.name,
    n_guides: library.n_guides,
  }));
  const librarySlugToId = Object.fromEntries(
    catalog.libraries.map((library) => [library.slug, library.id] as const),
  );

  return (
    <div className="flex flex-col gap-3 pb-6">
      <PageHeader
        dense
        title="New analysis"
        body="Bring your own screen, or ask SplicR to reanalyse a published one."
      />

      <div className="grid grid-cols-12 content-start gap-4">
        <Panel title="Start an analysis" span={8} bodyClassName="space-y-4">
          {canRun ? (
            <IntakeWorkspace
              own={
                <UploadFlow
                  libraries={libraries}
                  librarySlugToId={librarySlugToId}
                  defaults={{
                    modality: settings.defaults.modality,
                    librarySlug: settings.defaults.library_slug,
                    normalization: settings.defaults.normalization,
                    hit_callers: settings.defaults.hit_callers,
                    fdr_threshold: settings.defaults.fdr_threshold,
                    cn_correction: settings.defaults.cn_correction,
                  }}
                />
              }
              published={
                <div className="space-y-3">
                  <p className="max-w-prose text-[12.5px] leading-snug text-body">
                    SplicR reads the deposit, works out which runs are the treated arm, counts the guides
                    from the raw reads, and calls hits. The result is shared evidence and appears in the{" "}
                    <Link
                      href="/dashboard/atlas"
                      className="text-cyan-600 underline decoration-line-strong underline-offset-2"
                    >
                      Atlas
                    </Link>
                    .
                  </p>
                  <RequestForm requests={requests.status === "found" ? requests.requests : []} />
                  {requests.status === "unavailable" && (
                    <p
                      role="alert"
                      className="rounded-md bg-orange-50 px-3 py-2 text-[12.5px] leading-snug text-orange-700"
                    >
                      This workspace&rsquo;s earlier requests could not be read, so they are not listed.
                      That says nothing about whether they are running.
                    </p>
                  )}
                </div>
              }
            />
          ) : (
            <p className="rounded-md bg-mist-soft px-3 py-2 text-[12.5px] leading-snug text-body">
              Your role in this workspace is read-only, so you cannot start an analysis. An administrator
              can, from this page.
            </p>
          )}
        </Panel>

        <div className="col-span-12 flex flex-col gap-4 md:col-span-6 lg:col-span-4">
          <Card title="What SplicR needs">
            <ul className="space-y-2 text-[12.5px] leading-snug text-body">
              <li>
                <span className="font-medium text-ink">A count table, or FASTQ.</span> Guide-level counts
                with one numeric column per sample, or the raw reads to count from.
              </li>
              <li>
                <span className="font-medium text-ink">Two arms to compare.</span> At least one control or
                start-of-screen sample, and at least one treated sample.
              </li>
              <li>
                <span className="font-medium text-ink">A pooled library.</span> SplicR identifies it from
                the guide sequences. Pin one yourself if the match is not what you expected.
              </li>
            </ul>
          </Card>

          <Card title="Where the result goes">
            <p className="text-[12.5px] leading-snug text-body">
              Your own screen stays private to this workspace and appears under{" "}
              <Link
                href="/dashboard/screens"
                className="text-cyan-600 underline decoration-line-strong underline-offset-2"
              >
                Screens
              </Link>
              . A reanalysed public study becomes shared evidence in the Atlas, where anyone using SplicR
              can see it.
            </p>
            <p className="mt-2 text-[12.5px] leading-snug text-muted">
              Uploaded reads are kept for{" "}
              <span className="num">{settings.retention.raw_reads_days}</span> days, then removed. Counts
              and results are kept.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
