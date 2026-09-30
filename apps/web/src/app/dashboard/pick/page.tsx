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
import Link from "next/link";

import { Slate } from "@/components/dashboard/evidence/slate";
import type { CandidateRow } from "@/components/dashboard/overview/types";
import { PageHeader } from "@/components/dashboard/ui";
import { getCurrentContext } from "@/lib/data/org";
import { listHeadlineHits, listRecentScreens } from "@/lib/data/overview";
import {
  benchQueue,
  screens,
  type Verdict,
} from "@/lib/mock/data";

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
      {qcSource && qcSource.qc !== "pass" ? (
        <QcWarning verdict={qcSource.qc} href={`/dashboard/screens/${qcSource.id}?tab=qc`} />
      ) : null}
      <Slate rows={rows} />
      <Provenance scored={headline.scored} />
    </>
  );
}

function SamplePick() {
  const source = screens[0];
  const queue = benchQueue(source.id);

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
    guideLfcs: hit.guideLfcs,
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
      {source.qc !== "pass" ? (
        <QcWarning verdict={source.qc} href={`/dashboard/screens/${source.id}?tab=qc`} />
      ) : null}
      <Slate rows={rows} />
      <Provenance scored />
    </>
  );
}

/**
 * A screen whose QC did not pass gates its candidates behind a warning the
 * reader has to read past. Decision 11: a figure downstream of a failed QC
 * verdict is suspect, and the console says so before the reader spends a month
 * of bench time on it.
 */
function QcWarning({ verdict, href }: { verdict: string; href: string }) {
  const note =
    verdict === "fail"
      ? "A screen behind these candidates failed QC. Every figure downstream of it is suspect."
      : verdict === "warn"
        ? "A screen behind these candidates raised QC warnings. Review before committing bench time."
        : "QC has not been verified for every screen behind these candidates.";
  return (
    <div className="rounded-xl border border-orange-500/30 bg-orange-50/70 px-5 py-3.5">
      <p className="text-[12.5px] leading-snug text-orange-800">
        {note}{" "}
        <Link href={href} className="underline underline-offset-2">
          Open the QC report
        </Link>
      </p>
    </div>
  );
}

/** What the ordering actually is on this path, stated rather than implied. */
function Provenance({ scored }: { scored: boolean }) {
  return (
    <p className="text-[11.5px] leading-relaxed text-muted">
      {scored
        ? "Ordered by evidence tier, then by recorded model score. The score is not calibrated and is used only for position."
        : "Ordered by evidence tier, then by q-value. No model score is recorded for these hits, so none is used."}{" "}
      Replication is a proxy for reproducibility, not proof that a candidate passes
      a validation assay.
    </p>
  );
}
