/**
 * New screen.
 *
 * WHAT THIS PAGE CAN AND CANNOT DO, AND WHY IT SAYS SO
 *
 * SplicR has one path from nothing to a reanalysed screen that works end to
 * end today: the autonomous ingest engine, which takes a public accession,
 * infers the design from the deposited metadata and from the reads themselves,
 * counts, runs QC and hits, and publishes the result to the Atlas. This page is
 * the way a lab puts an accession into that queue.
 *
 * It cannot accept a file. There is no browser upload path and no worker
 * consuming a job from one, and a drop zone that wrote a row nobody reads would
 * be worse than no drop zone: the researcher would wait for a run that was
 * never going to start. So the page says what the engine does accept, and says
 * plainly what it does not.
 */
import { FlaskConical } from "lucide-react";
import Link from "next/link";

import { RequestForm } from "@/components/dashboard/request-form";
import { Card, PageHeader, Panel } from "@/components/dashboard/ui";
import { getCurrentContext } from "@/lib/data/org";
import { listScreenRequests } from "@/lib/data/screen-requests";
import { ROLE_RANK } from "@/lib/data/types";

export const metadata = { title: "New screen" };
export const dynamic = "force-dynamic";

export default async function NewScreenPage() {
  const [context, requests] = await Promise.all([getCurrentContext(), listScreenRequests()]);
  const role = context.role;
  const canRequest = role !== null && ROLE_RANK[role] >= ROLE_RANK.member;

  return (
    <div className="flex flex-col gap-3 pb-6">
      <PageHeader dense title="New screen" body="Analyse a public accession, or bring your own reads to the engine." />

      <div className="grid grid-cols-12 content-start gap-4">
        <Panel
          title="Analyse a public accession"
          count="GEO, BioProject, SRA, ENA or DDBJ"
          span={8}
          bodyClassName="space-y-4"
        >
          <p className="max-w-prose text-[12.5px] leading-snug text-body">
            SplicR reads the deposit, works out which runs are the treated arm, the control arm and
            the reference, counts the guides from the raw reads, runs QC and calls hits. Results are
            shared evidence and appear in the{" "}
            <Link href="/dashboard/atlas" className="text-cyan-600 underline decoration-line-strong underline-offset-2">
              Atlas
            </Link>
            , not in this workspace&rsquo;s private screen list.
          </p>

          {canRequest ? (
            <RequestForm requests={requests.status === "found" ? requests.requests : []} />
          ) : (
            <p className="rounded-md bg-mist-soft px-3 py-2 text-[12.5px] leading-snug text-body">
              Your role in this workspace is read-only, so you cannot queue an analysis. An
              administrator can, from this page.
            </p>
          )}

          {requests.status === "unavailable" && (
            <p role="alert" className="rounded-md bg-orange-50 px-3 py-2 text-[12.5px] leading-snug text-orange-700">
              This workspace&rsquo;s earlier requests could not be read, so they are not listed below.
              That says nothing about whether they are running.
            </p>
          )}
        </Panel>

        <div className="col-span-12 flex flex-col gap-4 md:col-span-6 lg:col-span-4">
          <Card title="Bringing your own reads">
            <p className="text-[12.5px] leading-snug text-body">
              The analysis engine processes FASTQ files and count tables, and writes its results into
              this workspace. It runs from the command line and on Modal, not from this page: there
              is no browser upload yet, so nothing here would queue a run.
            </p>
            <p className="mt-2 text-[12.5px] leading-snug text-body">
              A run started that way appears under{" "}
              <Link href="/dashboard/screens" className="text-cyan-600 underline decoration-line-strong underline-offset-2">
                Screens
              </Link>{" "}
              as soon as it writes its first stage.
            </p>
          </Card>

          <Card title="What an accession needs to carry">
            <ul className="space-y-1.5 text-[12.5px] leading-snug text-body">
              {[
                "Raw reads in SRA, ENA or DDBJ. A deposit of processed counts alone cannot be recounted.",
                "A pooled CRISPR library the engine holds, or one the study's own supplementary files describe.",
                "Enough sample description to tell the arms apart. Where it is ambiguous the request goes to review rather than guessing.",
              ].map((line) => (
                <li key={line} className="flex gap-2">
                  <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
