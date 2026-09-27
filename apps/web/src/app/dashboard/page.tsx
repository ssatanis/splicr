/**
 * The workspace overview.
 *
 * Two states, and the page never pretends to be in the other one:
 *
 *  - A signed-in lab sees its own rows. Screens, runs, hits, outcomes and
 *    members are counted in Postgres, the stage rail is the newest run's real
 *    stages, and the reliability curve is computed from outcomes the lab logged.
 *    Where the engine has not produced a number yet, for instance a calibrated
 *    chance on a screen whose `score` stage was skipped, the card says so rather
 *    than showing a figure nobody computed.
 *  - A demo visitor, or a signed-in account with no workspace, sees the sample
 *    screens from `@/lib/mock/data` behind a banner that says plainly that none
 *    of it is real.
 */
import { ArrowRight, ArrowUpRight, Info } from "lucide-react";
import Link from "next/link";

import { CalibrationChart } from "@/components/dashboard/charts";
import { MODALITY_SHORT } from "@/components/dashboard/settings/meta";
import {
  Card,
  Chance,
  Empty,
  Kpi,
  PageHeader,
  StageRail,
  StatusBadge,
  VerdictBadge,
} from "@/components/dashboard/ui";
import { listLibraries } from "@/lib/data/libraries";
import { getCurrentContext, getWorkspaceStats } from "@/lib/data/org";
import {
  getCalibration,
  getLatestRun,
  listHeadlineHits,
  listRecentOutcomes,
  listRecentScreens,
  type Calibration,
  type HeadlineHits,
  type LatestRun,
  type OverviewOutcome,
  type OverviewScreen,
} from "@/lib/data/overview";
import type { WorkspaceStats } from "@/lib/data/types";
import { calibrationBins, demoHits, outcomes, overviewKpis, screens, stageRuns } from "@/lib/mock/data";
import { formatDate, formatNumber, formatPercent } from "@/lib/utils";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { org, isDemo } = await getCurrentContext();

  if (isDemo || org === null) {
    return <SampleOverview signedIn={!isDemo} />;
  }

  const [stats, recent, headline, loggedOutcomes, calibration, latestRun, catalog] =
    await Promise.all([
      getWorkspaceStats(org.id),
      listRecentScreens(org.id),
      listHeadlineHits(org.id),
      listRecentOutcomes(org.id),
      getCalibration(org.id),
      getLatestRun(org.id),
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
      calibration={calibration}
      latestRun={latestRun}
      libraryName={libraryName}
    />
  );
}

// ---------------------------------------------------------------------------
// The real thing
// ---------------------------------------------------------------------------

/**
 * A factual one-liner about the workspace, built from the counts rather than
 * written in advance. An empty workspace gets an invitation instead of a tally.
 */
function summarize(stats: WorkspaceStats): string {
  if (stats.screens === 0) {
    return "No screens here yet. Upload counts or FASTQ and the pipeline will take it from there.";
  }

  const parts = [
    `${formatNumber(stats.screens)} ${stats.screens === 1 ? "screen" : "screens"}`,
    `${formatNumber(stats.runs)} ${stats.runs === 1 ? "run" : "runs"}`,
    `${formatNumber(stats.hits)} ${stats.hits === 1 ? "hit" : "hits"}`,
  ];
  const tail =
    stats.outcomes === 0
      ? "No validation outcomes logged yet."
      : `${formatNumber(stats.outcomes)} validation ${stats.outcomes === 1 ? "outcome" : "outcomes"} logged.`;

  return `${parts.join(", ")}. ${tail}`;
}

function WorkspaceOverview({
  orgName,
  stats,
  recent,
  headline,
  outcomes: loggedOutcomes,
  calibration,
  latestRun,
  libraryName,
}: {
  orgName: string;
  stats: WorkspaceStats;
  recent: OverviewScreen[];
  headline: HeadlineHits;
  outcomes: OverviewOutcome[];
  calibration: Calibration | null;
  latestRun: LatestRun | null;
  libraryName: Map<string, string>;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Overview"
        title={orgName}
        body={summarize(stats)}
        actions={
          <Link href="/dashboard/upload" className="btn btn-orange btn-sm">
            New run <ArrowRight className="w-4 h-4" />
          </Link>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi label="Screens" value={formatNumber(stats.screens)} hint="In this workspace" />
        <Kpi label="Runs" value={formatNumber(stats.runs)} hint="Pipeline runs started" />
        <Kpi label="Hits called" value={formatNumber(stats.hits)} hint="Across all screens" />
        <Kpi
          label="Outcomes logged"
          value={formatNumber(stats.outcomes)}
          hint="Truth Loop"
          tone="cyan"
        />
        <Kpi label="Members" value={formatNumber(stats.members)} hint="With access" tone="orange" />
      </div>

      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-4">
        <Card
          title="Recent screens"
          action={
            <Link
              href="/dashboard/screens"
              className="text-sm text-orange-500 inline-flex items-center gap-1"
            >
              All screens <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          }
        >
          {recent.length === 0 ? (
            <Empty
              title="No screens yet"
              body="Upload a count matrix or FASTQ files and SplicR will detect the library, call hits and flag artifacts."
              action={
                <Link href="/dashboard/upload" className="btn btn-teal btn-sm">
                  Start a run
                </Link>
              }
            />
          ) : (
            <div className="overflow-x-auto thin-scroll">
              <table className="table-base min-w-[640px]">
                <thead>
                  <tr>
                    <th>Screen</th>
                    <th>Library</th>
                    <th>Status</th>
                    <th>QC</th>
                    <th>Real hits</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((screen) => (
                    <tr key={screen.id}>
                      <td>
                        <Link
                          href={`/dashboard/screens/${screen.id}`}
                          className="font-medium hover:text-orange-500"
                        >
                          {screen.name}
                        </Link>
                        <div className="text-xs text-muted">
                          {[screen.cell_line, MODALITY_SHORT[screen.modality]]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </td>
                      <td>
                        {screen.library_id
                          ? (libraryName.get(screen.library_id) ?? "Custom library")
                          : "Not called"}
                      </td>
                      <td>
                        <StatusBadge status={screen.status} />
                      </td>
                      <td>
                        <StatusBadge status={screen.qc} />
                      </td>
                      <td>
                        {screen.status === "complete"
                          ? `${formatNumber(screen.n_real_hits)} / ${formatNumber(screen.n_hits)}`
                          : "-"}
                      </td>
                      <td className="text-muted text-sm">{formatDate(screen.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Calibration" subtitle="Predicted vs observed on logged outcomes">
          {calibration ? (
            <>
              <CalibrationChart bins={calibration.bins} />
              <p className="mt-3 text-xs text-muted">
                Expected calibration error {formatPercent(calibration.error)} over{" "}
                {formatNumber(calibration.resolved)} resolved{" "}
                {calibration.resolved === 1 ? "outcome" : "outcomes"}. When SplicR says 80%, about 8
                in 10 should validate.
              </p>
            </>
          ) : (
            <Empty
              title="Not enough outcomes yet"
              body="A reliability curve needs at least ten validated or failed outcomes from this workspace. Log what happened at the bench and the curve builds itself."
              action={
                <Link href="/dashboard/validation" className="btn btn-teal btn-sm">
                  Log an outcome
                </Link>
              }
            />
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-[1fr_1fr_1fr] gap-4">
        <Card
          title={headline.scored ? "Validate these first" : "Strongest by FDR"}
          subtitle={
            headline.scored
              ? "Ranked by calibrated chance the hit is real"
              : "No calibrated scores yet, so ranked by statistical strength"
          }
        >
          {headline.hits.length === 0 ? (
            <Empty
              title="No hits yet"
              body="Finish a run and the called hits land here, strongest first."
            />
          ) : (
            <>
              <ul className="divide-y divide-line">
                {headline.hits.map((hit) => (
                  <li key={hit.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-ink font-medium">{hit.gene}</div>
                      <div className="text-xs text-muted truncate">
                        {hit.direction}
                        {hit.lfc !== null && ` · LFC ${hit.lfc.toFixed(2)}`}
                      </div>
                    </div>
                    {hit.chance_real !== null ? (
                      <Chance value={hit.chance_real} size="sm" />
                    ) : (
                      <span className="text-xs text-muted tabular-nums whitespace-nowrap">
                        FDR {hit.fdr !== null ? hit.fdr.toExponential(1) : "n/a"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {!headline.scored && (
                <p className="mt-4 flex items-start gap-2 border-t border-line pt-3 text-xs text-muted">
                  <Info className="mt-px h-3.5 w-3.5 shrink-0" />
                  The scoring stage needs a fitted calibration model, which this instance does not
                  have yet, so no hit carries a chance it is real.
                </p>
              )}
            </>
          )}
        </Card>

        <Card
          title="Pipeline activity"
          subtitle={latestRun ? `Latest run · ${latestRun.screenName}` : "No runs yet"}
        >
          {latestRun === null || latestRun.stages.length === 0 ? (
            <Empty
              title="Nothing has run yet"
              body="Start a run and each of the nine stages reports here as it finishes."
            />
          ) : (
            <>
              <StageRail stages={latestRun.stages} compact />
              <ul className="mt-4 space-y-3">
                {latestRun.stages
                  .slice(-4)
                  .reverse()
                  .map((stage) => (
                    <li key={stage.key} className="text-sm">
                      <div className="flex justify-between gap-3 text-ink">
                        <span className="font-medium">{stage.title}</span>
                        <span className="text-muted text-xs whitespace-nowrap">
                          {stage.durationSec === null ? stage.status : `${stage.durationSec}s`}
                        </span>
                      </div>
                      {stage.detail && <div className="text-muted text-xs">{stage.detail}</div>}
                    </li>
                  ))}
              </ul>
            </>
          )}
        </Card>

        <Card title="Recent outcomes" subtitle="Truth Loop">
          {loggedOutcomes.length === 0 ? (
            <Empty
              title="No outcomes logged"
              body="When you test a hit at the bench, log what happened. That is what teaches the model which hits are real."
              action={
                <Link href="/dashboard/validation" className="btn btn-teal btn-sm">
                  Open validation
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {loggedOutcomes.map((outcome) => (
                <li
                  key={outcome.id}
                  className="py-2.5 flex items-center justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="text-ink font-medium">{outcome.gene}</div>
                    {outcome.assay && <div className="text-xs text-muted truncate">{outcome.assay}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    {outcome.predicted !== null && (
                      <div className="text-xs text-muted">
                        predicted {Math.round(outcome.predicted * 100)}%
                      </div>
                    )}
                    <VerdictBadge
                      verdict={
                        outcome.result === "validated"
                          ? "Real and new"
                          : outcome.result === "failed"
                            ? "Artifact"
                            : "Uncertain"
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demo and no-workspace fallback
// ---------------------------------------------------------------------------

/**
 * The sample overview, shown only when there is no workspace to read.
 *
 * The banner is not decoration. Every number below it is invented, so the page
 * has to say that before anybody reads a figure off it and believes it.
 */
function SampleOverview({ signedIn }: { signedIn: boolean }) {
  const topHits = demoHits.filter((hit) => hit.verdict === "Real and new").slice(0, 6);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Overview"
        title="Sample workspace"
        body="This is what a lab sees once a screen has run. The figures below are sample data, not measurements."
        actions={
          <Link href={signedIn ? "/dashboard/settings" : "/signup"} className="btn btn-orange btn-sm">
            {signedIn ? "Workspace settings" : "Create an account"} <ArrowRight className="w-4 h-4" />
          </Link>
        }
      />

      <p className="flex items-start gap-2 rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm text-orange-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {signedIn
            ? "You are not in a workspace yet, so there is nothing of your own to show. Every screen, hit, outcome and chart on this page is sample data."
            : "You are browsing the SplicR demo. Every screen, hit, outcome and chart on this page is sample data, not a real measurement."}
        </span>
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi label="Screens" value={overviewKpis.screens} hint="Sample data" />
        <Kpi label="Hits scored" value={formatNumber(overviewKpis.hitsScored)} hint="Sample data" />
        <Kpi label="Outcomes logged" value={overviewKpis.outcomesLogged} hint="Sample data" tone="cyan" />
        <Kpi
          label="Validated rate"
          value={formatPercent(overviewKpis.validatedRate)}
          hint="Sample data"
          tone="orange"
        />
        <Kpi label="Atlas screens" value={formatNumber(overviewKpis.atlasScreens)} hint="Sample data" />
      </div>

      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-4">
        <Card title="Recent screens" subtitle="Sample data">
          <div className="overflow-x-auto thin-scroll">
            <table className="table-base min-w-[640px]">
              <thead>
                <tr>
                  <th>Screen</th>
                  <th>Library</th>
                  <th>Status</th>
                  <th>QC</th>
                  <th>Real hits</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {screens.slice(0, 5).map((screen) => (
                  <tr key={screen.id}>
                    <td>
                      <span className="font-medium">{screen.name}</span>
                      <div className="text-xs text-muted">
                        {screen.cellLine} · {screen.modality}
                      </div>
                    </td>
                    <td>{screen.library}</td>
                    <td>
                      <StatusBadge status={screen.status} />
                    </td>
                    <td>
                      <StatusBadge status={screen.qc} />
                    </td>
                    <td>{screen.status === "complete" ? `${screen.realHits} / ${screen.hits}` : "-"}</td>
                    <td className="text-muted text-sm">{formatDate(screen.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Calibration" subtitle="Sample data, not a measured curve">
          <CalibrationChart bins={calibrationBins} />
          <p className="mt-3 text-xs text-muted">
            On a real workspace this curve is built from the outcomes your lab logs, and the error
            beside it is measured rather than quoted.
          </p>
        </Card>
      </div>

      <div className="grid lg:grid-cols-[1fr_1fr_1fr] gap-4">
        <Card title="Validate these first" subtitle="Sample data">
          <ul className="divide-y divide-line">
            {topHits.map((hit) => (
              <li key={hit.gene} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-ink font-medium">{hit.gene}</div>
                  <div className="text-xs text-muted truncate">{hit.why}</div>
                </div>
                <Chance value={hit.chance} size="sm" />
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Pipeline activity" subtitle="Sample data">
          <StageRail stages={stageRuns} compact />
          <ul className="mt-4 space-y-3">
            {stageRuns
              .slice(-4)
              .reverse()
              .map((stage) => (
                <li key={stage.key} className="text-sm">
                  <div className="flex justify-between gap-3 text-ink">
                    <span className="font-medium">{stage.title}</span>
                    <span className="text-muted text-xs whitespace-nowrap">{stage.durationSec}s</span>
                  </div>
                  <div className="text-muted text-xs">{stage.detail}</div>
                </li>
              ))}
          </ul>
        </Card>

        <Card title="Recent outcomes" subtitle="Sample data">
          <ul className="divide-y divide-line">
            {outcomes.slice(0, 5).map((outcome) => (
              <li key={outcome.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="text-ink font-medium">{outcome.gene}</div>
                  <div className="text-xs text-muted truncate">{outcome.assay}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-muted">
                    predicted {Math.round(outcome.predicted * 100)}%
                  </div>
                  <VerdictBadge
                    verdict={
                      outcome.result === "validated"
                        ? "Real and new"
                        : outcome.result === "failed"
                          ? "Artifact"
                          : "Uncertain"
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
