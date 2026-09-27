/**
 * The workspace overview.
 *
 * A screening scientist opens this to answer two questions in order: what moved
 * since I last looked, and which candidate do I take to the bench next. The page
 * is built in that order and nothing else competes with it. The reliability
 * curve moved to Truth Loop, where the outcomes that build it are logged, and
 * the per-stage run telemetry moved to the screen it belongs to; neither one is
 * a decision anybody makes from this page.
 *
 * Two states, and the page never pretends to be in the other one:
 *
 *  - A signed-in lab sees its own rows, counted in Postgres. Where the engine
 *    has not produced a number yet, for instance a calibrated chance on a screen
 *    whose `score` stage was skipped, the table says so rather than showing a
 *    figure nobody computed.
 *  - A demo visitor, or a signed-in account with no workspace, sees the sample
 *    screens from `@/lib/mock/data` behind a banner that says plainly that none
 *    of it is real.
 */
import { ArrowRight, ArrowUpRight, Info } from "lucide-react";
import Link from "next/link";

import {
  OutcomesTable,
  RecentScreensTable,
  TriageTable,
  type OutcomeRow,
  type ScreenRow,
  type TriageHit,
} from "@/components/dashboard/overview-tables";
import { MODALITY_SHORT } from "@/components/dashboard/settings/meta";
import { Card, Empty, PageHeader } from "@/components/dashboard/ui";
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
import { benchQueue, LIKELY_REAL_THRESHOLD, outcomes, screens, type Verdict } from "@/lib/mock/data";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { org, isDemo } = await getCurrentContext();

  if (isDemo || org === null) {
    return <SampleOverview signedIn={!isDemo} />;
  }

  const [stats, recent, headline, loggedOutcomes, catalog] = await Promise.all([
    getWorkspaceStats(org.id),
    listRecentScreens(org.id),
    listHeadlineHits(org.id),
    listRecentOutcomes(org.id),
    listLibraries(),
  ]);

  const libraryName = new Map(catalog.libraries.map((library) => [library.id, library.name]));

  return (
    <WorkspaceOverview
      orgName={org.name}
      stats={stats}
      recent={recent}
      headline={headline}
      outcomes={loggedOutcomes}
      libraryName={libraryName}
    />
  );
}

// ---------------------------------------------------------------------------
// Shared furniture
// ---------------------------------------------------------------------------

function plural(n: number, one: string, many: string) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

interface Change {
  value: string;
  label: string;
  /** Where the figure came from, including the window it was counted over. */
  note: string;
  href?: string;
}

/**
 * The line the audit found missing: what moved, over a stated window, with the
 * source of each count beside it. Deliberately quiet typography. It orients the
 * reader; the table underneath is what they came to act on.
 */
function ChangeStrip({ items }: { items: Change[] }) {
  return (
    <section aria-label="What changed" className="rounded-3xl border border-line bg-white px-5 py-4">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="relative min-w-0">
            <dt className="text-sm text-muted">{item.label}</dt>
            <dd className="mt-0.5 text-xl font-medium tabular-nums text-ink">
              {item.href ? (
                <Link
                  href={item.href}
                  className="before:absolute before:inset-0 before:content-[''] hover:text-orange-500"
                >
                  {item.value}
                  <span className="sr-only">, {item.label}</span>
                </Link>
              ) : (
                item.value
              )}
            </dd>
            <dd className="mt-0.5 text-xs text-muted">{item.note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SeeAll({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm text-orange-500">
      {label} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

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

function WorkspaceOverview({
  orgName,
  stats,
  recent,
  headline,
  outcomes: loggedOutcomes,
  libraryName,
}: {
  orgName: string;
  stats: WorkspaceStats;
  recent: OverviewScreen[];
  headline: HeadlineHits;
  outcomes: OverviewOutcome[];
  libraryName: Map<string, string>;
}) {
  const screenName = new Map(recent.map((screen) => [screen.id, screen.name]));

  const triage: TriageHit[] = headline.hits.map((hit) => ({
    id: hit.id,
    gene: hit.gene,
    verdict: asVerdict(hit.verdict),
    chance: hit.chance_real,
    lfc: hit.lfc,
    fdr: hit.fdr,
    // Guide agreement, artifact flags and Atlas context are per-hit detail the
    // overview read does not fetch. They are left null so the panel says so.
    guides: null,
    guidesAgree: null,
    flags: [],
    why: null,
    atlasHits: null,
    atlasScreens: null,
    screenId: hit.screen_id,
    screenName: screenName.get(hit.screen_id) ?? null,
  }));

  const screenRows: ScreenRow[] = recent.map((screen) => ({
    id: screen.id,
    name: screen.name,
    context: [screen.cell_line, MODALITY_SHORT[screen.modality]].filter(Boolean).join(" · "),
    library: screen.library_id
      ? (libraryName.get(screen.library_id) ?? "Custom library")
      : "Not called",
    status: screen.status,
    qc: screen.qc,
    stage: null,
    hits: screen.n_hits,
    realHits: screen.n_real_hits,
    createdAt: screen.created_at,
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

  const headlineAction =
    triage.length > 0 ? (
      <Link
        href={`/dashboard/screens/${triage[0].screenId}?tab=hits`}
        className="btn btn-orange btn-sm"
      >
        Review {plural(triage.length, "candidate", "candidates")}{" "}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    ) : (
      <Link href="/dashboard/upload" className="btn btn-orange btn-sm">
        New run <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Overview"
        title={orgName}
        body={
          stats.screens === 0
            ? "No screens came back for this workspace. That is either an empty workspace or a read that did not complete, so nothing on this page is being reported as a measurement."
            : `${plural(stats.screens, "screen", "screens")} here, ${plural(stats.hits, "hit", "hits")} called and ${plural(stats.outcomes, "bench outcome", "bench outcomes")} logged.`
        }
        actions={headlineAction}
      />

      <ChangeStrip
        items={[
          {
            value: formatNumber(stats.screens),
            label: "Screens",
            note: "In this workspace, all time.",
            href: "/dashboard/screens",
          },
          {
            value: formatNumber(stats.runs),
            label: "Pipeline runs",
            note: "Started, all time.",
          },
          {
            value: formatNumber(stats.hits),
            label: "Hits called",
            note: "Across every screen here.",
          },
          {
            value: formatNumber(stats.outcomes),
            label: "Bench outcomes logged",
            note: "Truth Loop, all time.",
            href: "/dashboard/validation",
          },
        ]}
      />

      <Card
        className="border-orange-100"
        title="Validate next"
        subtitle={
          headline.scored
            ? "Candidates ranked by calibrated chance real. Select a gene for its evidence."
            : "No hit here carries a calibrated chance yet, so these are ranked by FDR. Select a gene for its evidence."
        }
        action={<SeeAll href="/dashboard/screens" label="All screens" />}
      >
        {triage.length === 0 ? (
          <Empty
            title="No candidates to show"
            body="Either no run has called a hit yet, or the read did not complete. Nothing is being reported as zero."
            action={
              <Link href="/dashboard/upload" className="btn btn-teal btn-sm">
                Start a run
              </Link>
            }
          />
        ) : (
          <TriageTable hits={triage} ranked={headline.scored ? "chance" : "fdr"} />
        )}
      </Card>

      <Card
        title="Recent screens"
        subtitle="Select a row to open its workspace."
        action={<SeeAll href="/dashboard/screens" label="All screens" />}
      >
        {screenRows.length === 0 ? (
          <Empty
            title="No screens came back"
            body="That is either an empty workspace or a read that did not complete. Upload a count matrix or FASTQ files and SplicR will detect the library, call hits and flag artifacts."
            action={
              <Link href="/dashboard/upload" className="btn btn-teal btn-sm">
                Start a run
              </Link>
            }
          />
        ) : (
          <RecentScreensTable screens={screenRows} />
        )}
      </Card>

      <Card
        title="Recent bench outcomes"
        subtitle="What happened when these genes were re-tested."
        action={<SeeAll href="/dashboard/validation" label="Truth Loop" />}
      >
        {outcomeRows.length === 0 ? (
          <Empty
            title="No outcomes logged"
            body="When you test a hit at the bench, log what happened. That is what teaches the model which hits are real."
            action={
              <Link href="/dashboard/validation" className="btn btn-teal btn-sm">
                Open Truth Loop
              </Link>
            }
          />
        ) : (
          <OutcomesTable outcomes={outcomeRows} />
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demo and no-workspace fallback
// ---------------------------------------------------------------------------

/** The window every "what changed" count on the sample overview is taken over. */
const WINDOW_DAYS = 7;

/**
 * Pinned at module load, next to the fixtures themselves, which are also dated
 * relative to load time. Reading the clock during render would make the counts
 * drift away from the rows they are counting.
 */
const WINDOW_START = Date.now() - WINDOW_DAYS * 864e5;

/** How many candidates the table shows before it hands off to the screen. */
const CANDIDATE_ROWS = 8;

/**
 * The sample overview, shown only when there is no workspace to read.
 *
 * The banner is not decoration. Every number below it is invented, so the page
 * has to say that before anybody reads a figure off it and believes it. The
 * counts are computed from the fixtures at render rather than written into the
 * copy, so the prose cannot drift away from the table underneath it.
 */
function SampleOverview({ signedIn }: { signedIn: boolean }) {
  const startedThisWeek = screens.filter((s) => Date.parse(s.createdAt) >= WINDOW_START).length;
  const runningNow = screens.filter((s) => s.status === "running").length;
  const needAttention = screens.filter(
    (s) => s.status === "failed" || s.qc === "fail" || s.qc === "warn",
  ).length;
  const outcomesThisWeek = outcomes.filter((o) => Date.parse(o.loggedAt) >= WINDOW_START).length;

  // The sample hit set belongs to the one completed genome-wide screen, so the
  // candidates are attributed to it rather than spread over screens that never
  // called a hit.
  const source = screens[0];
  // `realHits` is now counted off the screen's own hit table at
  // LIKELY_REAL_THRESHOLD, which is the same constant and the same table the
  // screen page, the CSV, the JSON and the PDF all count with. The old comment
  // here claimed that not recounting made two different totals for one screen
  // impossible; it did not, because the number it trusted had been typed in by
  // hand and every other surface recounted. This page said 41 and the screen
  // page said 98 for the same screen.
  const candidates = source.realHits;
  // The same ranking the screen's validation plan uses, so the two lists nest
  // instead of naming disjoint sets of genes as what to validate next.
  const queue = benchQueue(source.id);
  const shown = queue
    .slice(0, CANDIDATE_ROWS)
    .map<TriageHit>((hit) => ({
      id: `${source.id}:${hit.gene}`,
      gene: hit.gene,
      verdict: hit.verdict,
      chance: hit.chance,
      lfc: hit.lfc,
      fdr: hit.fdr,
      guides: hit.guides,
      guidesAgree: hit.guidesAgree,
      flags: hit.flags,
      why: hit.why,
      atlasHits: hit.atlasHits,
      atlasScreens: hit.atlasScreens,
      screenId: source.id,
      screenName: source.name,
    }));

  const screenRows: ScreenRow[] = screens.map((screen) => ({
    id: screen.id,
    name: screen.name,
    context: `${screen.cellLine} · ${screen.modality}`,
    library: screen.library,
    status: screen.status,
    qc: screen.qc,
    stage: screen.stage,
    hits: screen.hits,
    realHits: screen.realHits,
    createdAt: screen.createdAt,
  }));

  const outcomeRows: OutcomeRow[] = outcomes.map((outcome) => ({
    id: outcome.id,
    gene: outcome.gene,
    screenId: outcome.screenId,
    assay: outcome.assay,
    predicted: outcome.predicted,
    result: outcome.result,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Overview"
        title="Sample workspace"
        body={`Sample data, not measurements. Over the last ${WINDOW_DAYS} days ${plural(startedThisWeek, "screen", "screens")} started and ${plural(outcomesThisWeek, "bench outcome", "bench outcomes")} were logged. ${source.name} is waiting on ${plural(queue.length, "candidate", "candidates")}.`}
        actions={
          <>
            <Link
              href={`/dashboard/screens/${source.id}?tab=hits`}
              className="btn btn-orange btn-sm"
            >
              Review {plural(queue.length, "candidate", "candidates")}{" "}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href={signedIn ? "/dashboard/settings" : "/signup"}
              className="btn btn-ghost btn-sm"
            >
              {signedIn ? "Workspace settings" : "Create an account"}
            </Link>
          </>
        }
      />

      <p className="flex items-start gap-2 rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm text-orange-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          {signedIn
            ? "You are not in a workspace yet, so there is nothing of your own to show. Every screen, hit and outcome on this page is sample data."
            : "You are browsing the SplicR demo. Every screen, hit and outcome on this page is sample data, not a real measurement."}
        </span>
      </p>

      <ChangeStrip
        items={[
          {
            value: formatNumber(startedThisWeek),
            label: "Screens started",
            note: `In the last ${WINDOW_DAYS} days, from each screen's created date.`,
            href: "/dashboard/screens",
          },
          {
            value: formatNumber(runningNow),
            label: "Runs in progress",
            note: "Screens the pipeline reports as running now.",
            href: "/dashboard/screens",
          },
          {
            value: formatNumber(needAttention),
            label: "Screens needing a look",
            note: "QC warned or failed, or the run itself failed.",
            href: "/dashboard/screens",
          },
          {
            value: formatNumber(outcomesThisWeek),
            label: "Bench outcomes logged",
            note: `In the last ${WINDOW_DAYS} days, from the Truth Loop.`,
            href: "/dashboard/validation",
          },
        ]}
      />

      <Card
        className="border-orange-100"
        title="Validate next"
        subtitle={`The ${shown.length} highest by calibrated chance real, of ${formatNumber(queue.length)} candidates at chance ${LIKELY_REAL_THRESHOLD.toFixed(2)} or above in ${source.name} that the bench has not yet answered${candidates === queue.length ? "" : `, out of ${formatNumber(candidates)}`}. Select a gene for its evidence.`}
        action={
          <SeeAll
            href={`/dashboard/screens/${source.id}?tab=hits`}
            label={`All ${formatNumber(source.hits)} hits`}
          />
        }
      >
        <TriageTable hits={shown} ranked="chance" />
      </Card>

      <Card
        title="Recent screens"
        subtitle="Select a row to open its workspace."
        action={<SeeAll href="/dashboard/screens" label="All screens" />}
      >
        <RecentScreensTable screens={screenRows} />
      </Card>

      <Card
        title="Recent bench outcomes"
        subtitle="What happened when these genes were re-tested."
        action={<SeeAll href="/dashboard/validation" label="Truth Loop" />}
      >
        <OutcomesTable outcomes={outcomeRows} />
      </Card>
    </div>
  );
}
