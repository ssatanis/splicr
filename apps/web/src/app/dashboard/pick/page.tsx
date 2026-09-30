/**
 * Pick this round's validations.
 *
 * The candidate list used to be the left half of the overview, where it competed
 * with three other panels for the same screen. It has its own address now,
 * because choosing which genes go to a bench is a task a reader arrives to do
 * rather than something to be glanced at on the way past.
 *
 * This is the surface the slate replaces: budget in, ranked shortlist out, order
 * sheet and plate map at the end of it. For now it is the existing panel, moved
 * intact, so nothing is lost between the overview being simplified and the slate
 * being built.
 */
import { Suspense } from "react";

import { CandidatesPanel } from "@/components/dashboard/overview/candidates-panel";
import type { CandidateRow } from "@/components/dashboard/overview/types";
import { PageHeader } from "@/components/dashboard/ui";
import { getCurrentContext } from "@/lib/data/org";
import { listHeadlineHits, listRecentScreens } from "@/lib/data/overview";
import {
  benchQueue,
  FDR_THRESHOLD,
  screens,
  stagesForScreen,
  testsForScreen,
  type Verdict,
} from "@/lib/mock/data";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Pick this round" };

const VERDICT_LABELS: Record<string, Verdict> = {
  real_new: "Real and new",
  real_generic: "Real but generic",
  real_known: "Real and known",
  artifact: "Artifact",
  uncertain: "Uncertain",
};

export default async function PickPage() {
  const { org, isDemo } = await getCurrentContext();

  if (isDemo) return <SamplePick />;
  if (org === null) {
    return (
      <PageHeader
        dense
        title="Workspace unavailable"
        body="No active workspace could be resolved for this session."
      />
    );
  }

  const [recent, headline] = await Promise.all([
    listRecentScreens(org.id),
    listHeadlineHits(org.id, 24),
  ]);

  const screenName = new Map(recent.map((screen) => [screen.id, screen.name]));

  const rows: CandidateRow[] = headline.hits.map((hit) => ({
    id: hit.id,
    gene: hit.gene,
    verdict: VERDICT_LABELS[hit.verdict] ?? null,
    chance: hit.chance_real,
    lfc: hit.lfc,
    fdr: hit.fdr,
    novelty: hit.novelty,
    bayes: hit.bayes_factor,
    guides: hit.n_guides,
    guidesAgree: hit.n_good_guides,
    guideLfcs: hit.guide_lfcs,
    direction: hit.direction,
    flags: hit.flags === null ? null : hit.flags.map((f) => f.flag),
    why: null,
    atlasHits: hit.atlas_hit_count,
    atlasScreens: hit.atlas_screen_count,
    screenId: hit.screen_id,
    screenName: screenName.get(hit.screen_id) ?? null,
    benchAssay: null,
  }));

  // Missing QC is pending, never an implied pass.
  const qcOf = rows.map((row) => ({
    id: row.screenId,
    qc: recent.find((screen) => screen.id === row.screenId)?.qc ?? "pending",
  }));
  const qcSource =
    qcOf.find((s) => s.qc === "fail") ??
    qcOf.find((s) => s.qc === "warn") ??
    qcOf.find((s) => s.qc === "pending");

  return (
    <>
      <PageHeader
        dense
        title="Pick this round"
        body="Candidates ranked for the next round of bench work. Nothing here is a validation probability."
      />
      <Suspense fallback={<div aria-hidden="true" />}>
        <CandidatesPanel
          rows={rows}
          ranked={headline.scored ? "chance" : "fdr"}
          total={rows.length}
          unit={rows.length === 1 ? "candidate" : "candidates"}
          sample={false}
          qc={
            qcSource && qcSource.qc !== "pass"
              ? {
                  verdict: qcSource.qc,
                  note:
                    qcSource.qc === "fail"
                      ? "Some candidates come from a screen that failed QC; downstream figures are suspect."
                      : qcSource.qc === "warn"
                        ? "Some candidates come from a screen with QC warnings; review before validation."
                        : "QC has not been verified for every candidate's screen; review before validation.",
                  href: `/dashboard/screens/${qcSource.id}?tab=qc`,
                }
              : null
          }
          provenance={
            headline.scored
              ? "Ranked by recorded model score. This is not a validation probability."
              : "Ranked by FDR; no model score is recorded."
          }
          emptyBody="Either no run has called a hit yet, or the read did not complete. Nothing is being reported as zero."
        />
      </Suspense>
    </>
  );
}

function SamplePick() {
  const source = screens[0];
  const queue = benchQueue(source.id);
  const tests = testsForScreen(source);
  const scoreTool = stagesForScreen(source).find((stage) => stage.key === "score")?.tool ?? null;

  const rows: CandidateRow[] = queue.map((hit) => ({
    id: `${source.id}:${hit.gene}`,
    gene: hit.gene,
    verdict: hit.verdict,
    chance: hit.chance,
    lfc: hit.lfc,
    fdr: hit.fdr,
    novelty: hit.novelty,
    bayes: hit.bayesFactor,
    guides: hit.guides,
    guidesAgree: hit.guidesAgree,
    guideLfcs: null,
    direction: hit.lfc === null ? null : hit.lfc < 0 ? "depleted" : "enriched",
    flags: hit.flags,
    why: hit.why,
    atlasHits: hit.atlasHits,
    atlasScreens: hit.atlasScreens,
    screenId: source.id,
    screenName: source.name,
    benchAssay: source.benchAssay,
  }));

  return (
    <>
      <PageHeader
        dense
        title="Pick this round"
        body={
          <span className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 rounded-[4px] bg-orange-50 px-1.5 py-0.5 text-[11px] leading-[1.4] text-orange-700">
              Sample data
            </span>
            Nothing here is a measurement.
          </span>
        }
      />
      <Suspense fallback={<div aria-hidden="true" />}>
        <CandidatesPanel
          rows={rows}
          ranked="chance"
          total={queue.length}
          unit={queue.length === 1 ? "candidate" : "candidates"}
          sample
          qc={
            source.qc === "pass"
              ? null
              : {
                  verdict: source.qc,
                  note:
                    source.qc === "fail"
                      ? "This screen failed QC; downstream figures are suspect."
                      : source.qc === "warn"
                        ? "This screen has QC warnings; review before validation."
                        : "This screen's QC is pending; review before validation.",
                  href: `/dashboard/screens/${source.id}?tab=qc`,
                }
          }
          provenance={`${scoreTool ?? "Scoring stage"} · FDR ${FDR_THRESHOLD.toFixed(2)} · ${source.library}, ${formatNumber(tests)} genes`}
          emptyBody="Every candidate on this screen has been answered at the bench."
        />
      </Suspense>
    </>
  );
}
