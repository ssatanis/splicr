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
import { isUuid } from "@/lib/data/types";
import { createClient } from "@/lib/supabase/server";
import type { UploadItem } from "@/components/dashboard/intake/file-list";

export const metadata = { title: "New analysis" };
export const dynamic = "force-dynamic";

export default async function NewAnalysisPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const context = await getCurrentContext();
  const [requests, catalog, settings] = await Promise.all([
    listScreenRequests(),
    listLibraries(),
    context.org ? getOrgSettings(context.org.id) : Promise.resolve(DEFAULT_WORKSPACE_SETTINGS),
  ]);

  const role = context.role;
  const canRun = role !== null && ROLE_RANK[role] >= ROLE_RANK.member;
  const params = await searchParams;
  let initialDraft: { screenId: string; orgId: string; name: string; files: UploadItem[] } | undefined;
  let drafts: { id: string; name: string }[] = [];
  if (canRun && context.org && context.user) {
    const client = await createClient();
    const recent = await client.from("screens").select("id,name").eq("org_id", context.org.id).eq("created_by", context.user.id).eq("status", "draft").is("archived_at", null).order("created_at", { ascending: false }).limit(8);
    drafts = recent.data ?? [];
    if (params.draft && isUuid(params.draft)) {
      const screen = await client.from("screens").select("id,name").eq("id", params.draft).eq("org_id", context.org.id).eq("created_by", context.user.id).eq("status", "draft").is("archived_at", null).maybeSingle();
      if (screen.data) {
        const files = await client.from("screen_files").select("id,original_name,byte_size,kind,checksum_sha256,metadata").eq("screen_id", screen.data.id).eq("status", "complete").order("created_at");
        if (!files.error) initialDraft = { screenId: screen.data.id, orgId: context.org.id, name: screen.data.name, files: (files.data ?? []).map((file) => ({ key: file.id, name: file.original_name, bytes: Number(file.byte_size), kind: file.kind === "other" ? "context" : file.kind, sent: Number(file.byte_size), checksum: file.checksum_sha256, status: "done", error: null, fileId: file.id })) };
      }
    }
  }

  const libraries = catalog.libraries.map((library) => ({
    id: library.id,
    name: library.name,
    n_guides: library.n_guides,
  }));
  const librarySlugToId = Object.fromEntries(
    catalog.libraries.map((library) => [library.slug, library.id] as const),
  );

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 pb-6">
      <PageHeader
        title="New analysis"
        body="Turn your experiment files into clear, reproducible evidence."
      />

      <div className="grid grid-cols-12 content-start gap-4">
        <Panel title="Start an analysis" span={8} bodyClassName="space-y-5 !p-5 sm:!p-6">
          {canRun ? (
            <IntakeWorkspace
              own={
                <UploadFlow
                  key={initialDraft?.screenId ?? "new"}
                  initialDraft={initialDraft}
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
          {drafts.length > 0 && <details className="rounded-xl border border-line bg-white p-4"><summary className="cursor-pointer text-[12.5px] font-medium text-ink">Continue a draft</summary><ul className="mt-3 space-y-2">{drafts.map((draft) => <li key={draft.id}><Link href={`/dashboard/new?draft=${draft.id}`} className="text-[12.5px] text-cyan-600 underline underline-offset-2">{draft.name}</Link></li>)}</ul></details>}
          <Card title="A few things to bring" className="!rounded-xl !p-5">
            <p className="mb-4 text-[12.5px] leading-relaxed text-muted">Attach your experiment together. Review the detected samples and design before anything runs.</p>
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

          <Card title="Made for your workspace" className="!rounded-xl !p-5">
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
            <p className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-muted">All file types can be attached. Tables and reads are checked for analysis; readable documents are previewed. Files requiring OCR or a dedicated parser are flagged.</p>
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
