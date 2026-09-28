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
 *    not produced a number yet, for instance a calibrated chance on a screen whose
 *    `score` stage was skipped, the table says so rather than showing a figure
 *    nobody computed.
 *  - A demo visitor, or a signed-in account with no workspace, sees the sample
 *    screens from `@/lib/mock/data`, labelled as sample data beside the title and
 *    again in the rail.
 */
import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { CandidatesPanel } from "@/components/dashboard/overview/candidates-panel";
import { OverviewGrid } from "@/components/dashboard/overview/grid";
import { OutcomesPanel } from "@/components/dashboard/overview/outcomes-panel";
import { RunsPanel } from "@/components/dashboard/overview/runs-panel";
import type {
  CandidateRow,
  OutcomeRow,
  RunRow,
} from "@/components/dashboard/overview/types";
import { MODALITY_SHORT } from "@/components/dashboard/settings/meta";
import { KpiStrip, KpiTile, PageHeader, PanelStack } from "@/components/dashboard/ui";
import { listLibraries } from "@/lib/data/libraries";
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
  FDR_THRESHOLD,
  LIKELY_REAL_THRESHOLD,
  outcomes,
  screens,
  stagesForScreen,
  testsForScreen,
  type Screen,
  type Verdict,
} from "@/lib/mock/data";
import { formatDate, formatNumber } from "@/lib/utils";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { org, isDemo } = await getCurrentContext();

  if (isDemo || org === null) {
    return <SampleOverview signedIn={!isDemo} />;
  }

  const [stats, recent, headline, loggedOutcomes, catalog] = await Promise.all([
    getWorkspaceStats(org.id),
    listRecentScreens(org.id),
    // Deeper than the old six: the candidate panel is the page's full-height
    // table and holds fourteen rows at 1280 and eighteen at 1440, so a read that
    // stopped at six would leave the panel half empty on every large screen.
    listHeadlineHits(org.id, 24),
    listRecentOutcomes(org.id, 10),
    listLibraries(),
  ]);

  return (
    <WorkspaceOverview
      orgName={org.name}
      stats={stats}
      recent={recent}
      headline={headline}
      outcomes={loggedOutcomes}
      libraries={catalog.libraries.length}
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
      {/* One Suspense boundary for the whole grid. The panels read their sort and
          filter state out of the query string, which needs a boundary or the
          route falls back to client rendering; wrapping each panel separately
          would put a fallback element into the grid with no span of its own. */}
      <Suspense fallback={<div className="lg:min-h-0 lg:flex-1" aria-hidden="true" />}>
        <OverviewGrid>{children}</OverviewGrid>
      </Suspense>
    </>
  );
}

function plural(n: number, one: string, many: string) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/**
 * How the two grid cells behave at each width.
 *
 * One column until lg rather than the system's default of two from md: a 354px
 * column at 768 gives the candidate table half the width it needs and hands the
 * outcomes panel 2,348px of empty white to stretch into beside it. Two columns
 * start where there is room for two.
 *
 * The cap below lg is what keeps the rest of the page reachable on a phone. The
 * panel is as tall as its rows there, and seventy-six of them put the runs and
 * the outcomes 2,500px down a page nobody scrolls that far. Capped, the table
 * scrolls inside the panel and the panels below it stay one thumb away.
 */
const CANDIDATES_CELL = "panel-in min-h-0 max-h-[70vh] md:col-span-12 lg:col-span-6 lg:max-h-none";
const STACK_CELL = "md:col-span-12 lg:col-span-6";

/** Where the likely-real cut sits, spelled out once for every label that cites it. */
const REAL_CUT = `chance real ${LIKELY_REAL_THRESHOLD.toFixed(2)} or above`;

// ---------------------------------------------------------------------------
// The real thing
// ---------------------------------------------------------------------------

const VERDICTS: readonly string[] = [
  "Real and new",
  "Real but generic",
  "Real and known",
  "Artifact",
  "Uncertain",
];

/** The engine's verdict column is free text in Postgres, so it is checked here. */
function asVerdict(value: string): Verdict | null {
  return VERDICTS.includes(value) ? (value as Verdict) : null;
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
  libraries,
}: {
  orgName: string;
  stats: WorkspaceStats;
  recent: OverviewScreen[];
  headline: HeadlineHits;
  outcomes: OverviewOutcome[];
  libraries: number;
}) {
  const screenName = new Map(recent.map((screen) => [screen.id, screen.name]));

  const candidates: CandidateRow[] = headline.hits.map((hit) => ({
    id: hit.id,
    gene: hit.gene,
    verdict: asVerdict(hit.verdict),
    chance: hit.chance_real,
    lfc: hit.lfc,
    fdr: hit.fdr,
    novelty: null,
    bayes: null,
    // Guide agreement, artifact flags, Atlas context and the screen's re-test
    // assay are per-hit detail the overview read does not fetch. They stay null
    // so the panel says so rather than drawing a figure nobody supplied.
    guides: null,
    guidesAgree: null,
    flags: [],
    why: null,
    atlasHits: null,
    atlasScreens: null,
    screenId: hit.screen_id,
    screenName: screenName.get(hit.screen_id) ?? null,
    benchAssay: null,
  }));

  // Headline hits can belong to screens outside the recent-screen window.
  // Missing QC is pending, never an implied pass.
  const candidateQc = candidates.map((candidate) => ({
    id: candidate.screenId,
    qc: recent.find((screen) => screen.id === candidate.screenId)?.qc ?? "pending",
  }));
  const qcSource = candidateQc.find((screen) => screen.qc === "fail")
    ?? candidateQc.find((screen) => screen.qc === "warn")
    ?? candidateQc.find((screen) => screen.qc === "pending");

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
        <KpiStrip
          title="Where this workspace stands"
          count={plural(stats.screens, "screen", "screens")}
          className="panel-in shrink-0"
        >
          <KpiTile
            label="Candidates ranked"
            value={formatNumber(candidates.length)}
            denominator={`of ${formatNumber(stats.hits)} called`}
            definition={
              headline.scored
                ? "Ranked by calibrated chance real."
                : "No calibrated chance yet, so ranked by FDR."
            }
            tone="orange"
            href="/dashboard/screens"
          />
          <KpiTile
            label="Runs needing a look"
            value={formatNumber(flagged)}
            denominator={`of ${formatNumber(runs.length)} recent`}
            definition="QC warned or failed, or the run itself stopped."
            href="/dashboard/screens"
          />
          <KpiTile
            label="Bench outcomes logged"
            value={formatNumber(stats.outcomes)}
            denominator="all time"
            definition="Re-tests recorded against a called hit."
            href="/dashboard/validation"
          />
          <KpiTile
            label="Libraries available"
            value={formatNumber(libraries)}
            denominator={`${formatNumber(stats.runs)} runs started`}
            definition="Reference libraries the detect stage can call."
          />
        </KpiStrip>
      }
    >
      <CandidatesPanel
        className={CANDIDATES_CELL}
        rows={candidates}
        ranked={headline.scored ? "chance" : "fdr"}
        total={candidates.length}
        unit={candidates.length === 1 ? "candidate" : "candidates"}
        sample={false}
        qc={qcSource && qcSource.qc !== "pass" ? {
          verdict: qcSource.qc,
          note: qcSource.qc === "fail"
            ? "Some candidates come from a screen that failed QC; downstream figures are suspect."
            : qcSource.qc === "warn"
              ? "Some candidates come from a screen with QC warnings; review before validation."
              : "QC has not been verified for every candidate's screen; review before validation.",
          href: `/dashboard/screens/${qcSource.id}?tab=qc`,
        } : null}
        provenance={
          headline.scored
            ? `Ranked by calibrated chance real, net of artifact flags.`
            : `Ranked by FDR, because no hit here carries a calibrated chance yet.`
        }
        emptyBody="Either no run has called a hit yet, or the read did not complete. Nothing is being reported as zero."
      />
      <PanelStack span={6} className={STACK_CELL}>
        <RunsPanel className="panel-in min-h-0" runs={runs} realCut={REAL_CUT} />
        <OutcomesPanel className="panel-in" outcomes={outcomeRows} />
      </PanelStack>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Demo and no-workspace fallback
// ---------------------------------------------------------------------------

/** The window every windowed count on the sample overview is taken over. */
const WINDOW_DAYS = 7;

/**
 * Pinned at module load, next to the fixtures themselves, which are also dated
 * relative to load time. Reading the clock during render would make the counts
 * drift away from the rows they are counting.
 */
const WINDOW_START = Date.now() - WINDOW_DAYS * 864e5;

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

  const outcomesThisWeek = outcomes.filter((o) => Date.parse(o.loggedAt) >= WINDOW_START).length;
  const settled = outcomes.filter((o) => o.result !== "pending");
  const held = settled.filter((o) => o.result === "validated").length;

  // Read off the run record rather than typed in here, so the provenance line and
  // the screen's own Report tab can never name two different tool versions.
  const stages = stagesForScreen(source);
  const scoreTool = stages.find((stage) => stage.key === "score")?.tool ?? null;

  const candidates: CandidateRow[] = queue.map((hit) => ({
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
    flags: hit.flags,
    why: hit.why,
    atlasHits: hit.atlasHits,
    atlasScreens: hit.atlasScreens,
    screenId: source.id,
    screenName: source.name,
    benchAssay: source.benchAssay,
  }));

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
  const tests = testsForScreen(source);

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
        <KpiStrip
          title="Where this workspace stands"
          count={plural(screens.length, "screen", "screens")}
          className="panel-in shrink-0"
        >
          <KpiTile
            label="Candidates waiting"
            value={formatNumber(queue.length)}
            denominator={`of ${formatNumber(source.hits)} called`}
            definition={`At ${REAL_CUT}, unanswered by the bench.`}
            tone="orange"
            href={`/dashboard/screens/${source.id}?tab=hits`}
          />
          <KpiTile
            label="Runs needing a look"
            value={formatNumber(flagged)}
            denominator={`of ${formatNumber(screens.length)} screens`}
            definition="QC warned or failed, or the run itself stopped."
            href="/dashboard/screens"
          />
          <KpiTile
            label="Bench outcomes logged"
            value={formatNumber(outcomes.length)}
            denominator={`${formatNumber(outcomesThisWeek)} this week`}
            definition={`${held} of ${settled.length} resolved calls held up.`}
            href="/dashboard/validation"
          />
          <KpiTile
            label="Candidate cut"
            value={`FDR ${FDR_THRESHOLD.toFixed(2)}`}
            denominator={source.library}
            definition={`Benjamini-Hochberg over ${formatNumber(tests)} gene-level tests.`}
          />
        </KpiStrip>
      }
    >
      <CandidatesPanel
        className={CANDIDATES_CELL}
        rows={candidates}
        ranked="chance"
        total={queue.length}
        unit={queue.length === 1 ? "candidate" : "candidates"}
        sample
        qc={source.qc === "pass" ? null : {
          verdict: source.qc,
          note: source.qc === "fail"
            ? "This screen failed QC; downstream figures are suspect."
            : source.qc === "warn"
              ? "This screen has QC warnings; review before validation."
              : "This screen's QC is pending; review before validation.",
          href: `/dashboard/screens/${source.id}?tab=qc`,
        }}
        provenance={`${scoreTool ?? "Scoring stage"} · FDR ${FDR_THRESHOLD.toFixed(2)} · ${source.library}, ${formatNumber(tests)} genes`}
        emptyBody="Every candidate on this screen has been answered at the bench."
      />
      <PanelStack span={6} className={STACK_CELL}>
        <RunsPanel className="panel-in min-h-0" runs={runs} realCut={REAL_CUT} />
        <OutcomesPanel className="panel-in" outcomes={outcomeRows} />
      </PanelStack>
    </Frame>
  );
}
