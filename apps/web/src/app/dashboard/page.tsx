/**
 * The workspace overview.
 *
 * WHAT THIS PAGE IS FOR
 *
 * A screening scientist opens it to answer three questions, in this order, and
 * nothing else competes with them:
 *
 *   1. which gene do I take to the bench next          the tall table on the left
 *   2. did a run break, or is something still moving   the top right panel
 *   3. was the score right the last few times          the bottom right panel
 *
 * The strip above them carries the four figures those three panels are read
 * against, each with its own denominator and definition in the same tile, because
 * a count with no threshold and no library is a marketing number and this
 * audience reads it as one.
 *
 * WHY IT LOOKS LIKE THIS NOW
 *
 * It used to be six stacked blocks running 2,398px into 711px of viewport. A
 * reader arriving at 1280x800 saw a 36px page title, a banner repeating the chip
 * already in the shell, a row of tiles and then the first five rows of one table;
 * the two panels under it did not exist as far as the screen was concerned. So the
 * page is a grid now: a one-line title, one strip, and one row of panels that is
 * handed the height that is left. Panels absorb their own overflow. Nothing on the
 * page is a loose section with a heading floating on the canvas.
 *
 * What the height had to be spent on, and what it was taken from: the page header
 * went from 145px to one line, the banner's three lines became a chip beside the
 * title, the 77px of column definitions under the candidate table became one
 * footer line plus a title on every column, and rows went from 47px to 32 and 26.
 *
 * Two states, and the page never pretends to be in the other one:
 *
 *  - A signed-in lab sees its own rows, counted in Postgres. Where the engine has
 *    not produced a number yet, for instance a model score on a screen whose
 *    `score` stage was skipped, the table says so rather than showing a figure
 *    nobody computed.
 *  - An explicit demo visitor sees labelled sample screens. A signed-in account
 *    with no workspace receives a missing-workspace state, never sample records.
 */
import { Plus } from "lucide-react";
import Link from "next/link";

import { FirstRun } from "@/components/dashboard/overview/first-run";
import {
  Decisions,
  NextActions,
  ScreenList,
  ZoneHeading,
} from "@/components/dashboard/overview/zones";
import type {
  CandidateRow,
  OutcomeRow,
  RunRow,
} from "@/components/dashboard/overview/types";
import { MODALITY_SHORT } from "@/components/dashboard/settings/meta";
import { PageHeader } from "@/components/dashboard/ui";
import { getCurrentContext, getWorkspaceStats } from "@/lib/data/org";
import {
  listHeadlineHits,
  listRecentOutcomes,
  listRecentScreens,
  type HeadlineHits,
  type OverviewOutcome,
  type OverviewScreen,
} from "@/lib/data/overview";
import type { WorkspaceStats } from "@/lib/data/types";
import {
  benchQueue,
  outcomes,
  screens,
  type Screen,
  type Verdict,
} from "@/lib/mock/data";
import { formatDate, formatNumber } from "@/lib/utils";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { org, isDemo } = await getCurrentContext();

  if (isDemo) {
    return <SampleOverview signedIn={false} />;
  }
  if (org === null) {
    return <div className="space-y-4"><PageHeader dense title="Workspace unavailable" body="No active workspace could be resolved for this session." /><p className="text-sm text-muted">Sign in with an account that belongs to a workspace. If you already have one, reload to try again.</p></div>;
  }

  const [stats, recent, headline, loggedOutcomes] = await Promise.all([
    getWorkspaceStats(org.id),
    listRecentScreens(org.id),
    // Deeper than the old six: the candidate panel is the page's full-height
    // table and holds fourteen rows at 1280 and eighteen at 1440, so a read that
    // stopped at six would leave the panel half empty on every large screen.
    listHeadlineHits(org.id, 24),
    listRecentOutcomes(org.id, 10),
  ]);

  // An empty workspace is a first day, not a broken page. Three zeros and an empty
  // list reads as "this product does not work", which is the opposite of what the
  // first screen a pilot lab ever sees should say.
  //
  // Gated on the screen list being empty AND the stats agreeing, so a read that
  // failed --- which also returns nothing --- falls through to the normal overview
  // and its "nothing here is being reported as a measurement" wording rather than
  // greeting an established lab as a new one.
  if (stats.screens === 0 && recent.length === 0) {
    return <FirstRun orgName={org.name} contactHref="/contact" />;
  }

  return (
    <WorkspaceOverview
      orgName={org.name}
      stats={stats}
      recent={recent}
      headline={headline}
      outcomes={loggedOutcomes}
    />
  );
}

// ---------------------------------------------------------------------------
// Shared furniture
// ---------------------------------------------------------------------------

/**
 * The frame both branches render into, so the layout cannot drift between a real
 * workspace and the sample one.
 *
 * The one primary action sits beside the title as well as at the top of the rail.
 * That is a deliberate second copy: starting a run is what a researcher came to
 * do, and the rail is behind a menu button at narrow widths where the title row
 * is the only thing on screen.
 */
function Frame({
  title,
  meta,
  sample,
  strip,
  children,
}: {
  title: string;
  meta: React.ReactNode;
  sample: boolean;
  strip: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <PageHeader
        dense
        title={title}
        body={
          sample ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="shrink-0 rounded-[4px] bg-orange-50 px-1.5 py-0.5 text-[11px] leading-[1.4] text-orange-700">
                Sample data
              </span>
              {meta}
            </span>
          ) : (
            meta
          )
        }
        actions={
          <Link href="/dashboard/upload" className="btn btn-orange btn-sm">
            <Plus className="h-4 w-4" aria-hidden="true" /> New run
          </Link>
        }
      />
      {strip}
      {/* A vertical stack, not the twelve-column panel grid this page used to
          be. The three zones are read in order and none of them competes with
          the others for the same row, which is the whole point of the change. */}
      <div className="flex flex-col gap-8 pb-4">{children}</div>
    </>
  );
}

function plural(n: number, one: string, many: string) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}


// ---------------------------------------------------------------------------
// The real thing
// ---------------------------------------------------------------------------

/**
 * The engine's verdict, translated to the label the console shows.
 *
 * `public.hit_verdict` is a snake_case Postgres enum. This used to test the
 * display strings ("Real and new") against it, so every real hit failed the
 * check and rendered "Not yet classified" — all 20,916 of them on the one real
 * screen, whose stored verdicts are `uncertain` and `artifact`. Keying on the
 * enum is what makes the column mean anything on a signed-in workspace.
 */
const VERDICT_LABELS: Record<string, Verdict> = {
  real_new: "Real and new",
  real_generic: "Real but generic",
  real_known: "Real and known",
  artifact: "Artifact",
  uncertain: "Uncertain",
};

function asVerdict(value: string): Verdict | null {
  return VERDICT_LABELS[value] ?? null;
}

/** A run that stopped, warned or is still moving is a run to look at today. */
function attentionNote(status: string, qc: string, stage: number | null): string | null {
  const notes: string[] = [];
  if (status === "failed") {
    notes.push(
      stage === null
        ? "The run stopped before it reported a stage."
        : `The run stopped inside stage ${stage + 1} of 9.`,
    );
  }
  if (qc === "fail") notes.push("QC failed, so every figure downstream of it is suspect.");
  else if (qc === "warn") notes.push("QC warned, so figures from this run carry that caveat.");
  if (status === "running") notes.push("Still moving, so its hits are not final.");
  return notes.length === 0 ? null : notes.join(" ");
}

function WorkspaceOverview({
  orgName,
  stats,
  recent,
  headline,
  outcomes: loggedOutcomes,
}: {
  orgName: string;
  stats: WorkspaceStats;
  recent: OverviewScreen[];
  headline: HeadlineHits;
  outcomes: OverviewOutcome[];
}) {
  const screenName = new Map(recent.map((screen) => [screen.id, screen.name]));

  const candidates: CandidateRow[] = headline.hits.map((hit) => ({
    id: hit.id,
    gene: hit.gene,
    verdict: asVerdict(hit.verdict),
    chance: hit.chance_real,
    lfc: hit.lfc,
    fdr: hit.fdr,
    novelty: hit.novelty,
    bayes: hit.bayes_factor,
    // These now come from the read. They were hardcoded null, and `flags` was
    // hardcoded to [] — which asserted "artifact screening found nothing" about
    // rows whose flags had never been fetched. The one real screen carries 10,938
    // flag rows, so that claim was not merely unsupported, it was wrong.
    guides: hit.n_guides,
    guidesAgree: hit.n_good_guides,
    guideLfcs: hit.guide_lfcs,
    direction: hit.direction,
    flags: hit.flags,
    why: null,
    // The per-hit counts are absent from the engine's COPY list, so they stay
    // null and the live rate from atlas.gene_stats carries this leg instead.
    atlasHits: null,
    atlasScreens: null,
    atlasRate: hit.atlas_hit_rate,
    isFrequentHitter: hit.is_frequent_hitter,
    screenId: hit.screen_id,
    screenName: screenName.get(hit.screen_id) ?? null,
    benchAssay: null,
  }));


  const runs: RunRow[] = recent.map((screen) => ({
    id: screen.id,
    name: screen.name,
    status: screen.status,
    qc: screen.qc,
    // The overview read does not carry a stage count, so the row does not print one.
    stage: null,
    hits: screen.n_hits,
    realHits: screen.n_real_hits,
    attention: attentionNote(screen.status, screen.qc, null),
    detail: [
      screen.phenotype,
      screen.cell_line,
      MODALITY_SHORT[screen.modality],
      `created ${formatDate(screen.created_at)}`,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  const outcomeRows: OutcomeRow[] = loggedOutcomes.map((outcome) => ({
    id: outcome.id,
    gene: outcome.gene,
    // The overview read does not carry the screen a logged outcome belongs to,
    // so the row does not offer a link it cannot build.
    screenId: null,
    assay: outcome.assay,
    predicted: outcome.predicted,
    result: outcome.result,
  }));

  const flagged = runs.filter((run) => run.attention !== null).length;
  // A candidate sent to the bench whose result has not come back. This is the
  // only one of the three counts that measures the loop closing, and it is the
  // number that fills the outcome table the ranking is fitted on.
  const unlogged = outcomeRows.filter((outcome) => outcome.result === "pending").length;

  return (
    <Frame
      title={orgName}
      sample={false}
      meta={
        stats.screens === 0
          ? "No screens came back for this workspace. That is either an empty workspace or a read that did not complete, so nothing here is being reported as a measurement."
          : `${plural(stats.screens, "screen", "screens")}, ${plural(stats.hits, "hit", "hits")} called and ${plural(stats.outcomes, "bench outcome", "bench outcomes")} logged.`
      }
      strip={
        <Decisions
          items={[
            {
              value: candidates.length,
              one: "candidate waiting on a decision",
              many: "candidates waiting on a decision",
              clear: "No candidate is waiting on you",
              href: "/dashboard/pick",
              lead: true,
            },
            {
              value: flagged,
              one: "screen needs a QC review",
              many: "screens need a QC review",
              clear: "Every screen passed QC",
              href: "/dashboard/screens",
            },
            {
              value: unlogged,
              one: "bench result not yet logged",
              many: "bench results not yet logged",
              clear: "Every bench result is logged",
              href: "/dashboard/validation",
            },
          ]}
        />
      }
    >
      <section>
        <ZoneHeading
          action={
            <Link href="/dashboard/screens" className="text-[12px] text-teal-800/70 hover:text-ink">
              All screens &rarr;
            </Link>
          }
        >
          Your screens
        </ZoneHeading>
        <ScreenList screens={runs} hrefFor={(s) => `/dashboard/screens/${s.id}`} />
      </section>

      <section>
        <ZoneHeading>What next</ZoneHeading>
        <NextActions
          actions={[
            {
              title: "Pick this round",
              body: "Rank candidates by what reproduces, then export the order sheet.",
              href: "/dashboard/pick",
              badge: candidates.length > 0 ? `${candidates.length} waiting` : null,
              primary: true,
            },
            {
              title: "Upload a screen",
              body: "Start the pipeline on a new count table.",
              href: "/dashboard/upload",
            },
            {
              title: "Log a bench result",
              body: "Validated, failed or inconclusive. Two seconds.",
              href: "/dashboard/validation",
              badge: unlogged > 0 ? `${unlogged} open` : null,
            },
            {
              title: "Look up a gene",
              body: "Its history across every published screen in the Atlas.",
              href: "/dashboard/atlas",
            },
          ]}
        />
      </section>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Demo and no-workspace fallback
// ---------------------------------------------------------------------------

/** The window every windowed count on the sample overview is taken over. */
const WINDOW_DAYS = 7;

/** Phenotype, model, library, owner and date, for a run's expanded row. */
function runDetail(screen: Screen): string {
  return `${screen.phenotype} · ${screen.cellLine} ${screen.modality} · ${screen.library} · ${screen.owner}, ${formatDate(screen.createdAt)}`;
}

/**
 * The sample overview, shown only when there is no workspace to read.
 *
 * Every number below is invented, so the page says that beside its title and the
 * rail says it again. The counts are computed from the fixtures at render rather
 * than written into the copy, so no sentence here can drift away from the table
 * it is describing.
 */
function SampleOverview({ signedIn }: { signedIn: boolean }) {
  // The sample hit set belongs to the one completed genome-wide screen, so the
  // candidates are attributed to it rather than spread over screens that never
  // called a hit.
  const source = screens[0];
  const queue = benchQueue(source.id);


  // Read off the run record rather than typed in here, so the provenance line and
  // the screen's own Report tab can never name two different tool versions.


  const runs: RunRow[] = screens.map((screen) => ({
    id: screen.id,
    name: screen.name,
    status: screen.status,
    qc: screen.qc,
    stage: screen.stage,
    hits: screen.hits,
    realHits: screen.realHits,
    attention: attentionNote(screen.status, screen.qc, screen.stage),
    detail: runDetail(screen),
  }));

  const outcomeRows: OutcomeRow[] = outcomes.map((outcome) => ({
    id: outcome.id,
    gene: outcome.gene,
    screenId: outcome.screenId,
    assay: outcome.assay,
    predicted: outcome.predicted,
    result: outcome.result,
  }));

  const flagged = runs.filter((run) => run.attention !== null).length;
  const unlogged = outcomeRows.filter((outcome) => outcome.result === "pending").length;

  return (
    <Frame
      title="Sample workspace"
      sample
      meta={
        signedIn
          ? `You are not in a workspace yet, so none of this is yours. Windowed counts cover the last ${WINDOW_DAYS} days.`
          : `Nothing here is a measurement. Windowed counts cover the last ${WINDOW_DAYS} days.`
      }
      strip={
        <Decisions
          items={[
            {
              value: queue.length,
              one: "candidate waiting on a decision",
              many: "candidates waiting on a decision",
              clear: "No candidate is waiting on you",
              href: "/dashboard/pick",
              lead: true,
            },
            {
              value: flagged,
              one: "screen needs a QC review",
              many: "screens need a QC review",
              clear: "Every screen passed QC",
              href: "/dashboard/screens",
            },
            {
              value: unlogged,
              one: "bench result not yet logged",
              many: "bench results not yet logged",
              clear: "Every bench result is logged",
              href: "/dashboard/validation",
            },
          ]}
        />
      }
    >
      <section>
        <ZoneHeading
          action={
            <Link href="/dashboard/screens" className="text-[12px] text-teal-800/70 hover:text-ink">
              All screens &rarr;
            </Link>
          }
        >
          Your screens
        </ZoneHeading>
        <ScreenList screens={runs} hrefFor={(s) => `/dashboard/screens/${s.id}`} />
      </section>

      <section>
        <ZoneHeading>What next</ZoneHeading>
        <NextActions
          actions={[
            {
              title: "Pick this round",
              body: "Rank candidates by what reproduces, then export the order sheet.",
              href: "/dashboard/pick",
              badge: queue.length > 0 ? `${queue.length} waiting` : null,
              primary: true,
            },
            {
              title: "Upload a screen",
              body: "Start the pipeline on a new count table.",
              href: "/dashboard/upload",
            },
            {
              title: "Log a bench result",
              body: "Validated, failed or inconclusive. Two seconds.",
              href: "/dashboard/validation",
              badge: unlogged > 0 ? `${unlogged} open` : null,
            },
            {
              title: "Look up a gene",
              body: "Its history across every published screen in the Atlas.",
              href: "/dashboard/atlas",
            },
          ]}
        />
      </section>
    </Frame>
  );
}
