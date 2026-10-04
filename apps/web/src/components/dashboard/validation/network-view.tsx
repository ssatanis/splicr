/**
 * The Validation Network.
 *
 * The page is the round: set one up, freeze it, record what the bench found,
 * read what it says. Everything that is reference rather than work sits behind
 * one disclosure at the bottom, because a researcher opening this page is here
 * to do something, not to read a registry.
 *
 * Nothing here renders a probability without the cohort that licensed it, and
 * nothing describes an untested candidate as a failure.
 */
import Link from "next/link";

import { DenseTable, Empty, FootNote, Panel, StatusChip, Th } from "@/components/dashboard/ui";
import type {
  EndpointRow,
  HeadStatus,
  NetworkView,
  RoundResults,
  RoundRow,
  StratumRow,
} from "@/lib/data/validation-network";
import { formatNumber } from "@/lib/utils";
import {
  COVERAGE_THRESHOLDS,
  QUESTION_LABEL,
  QUESTION_SHORT,
  ROUND_STATE_LABEL,
  formatProbability,
} from "@/lib/validation/model";

import { FreezeButton, RevealButton } from "./round-controls";
import { RoundResultsPanels } from "./round-results";
import { RoundSetup, type SetupEndpoint, type SetupScreen } from "./round-setup";

const BASE = "/dashboard/validation/network";
/** An empty cell. A plain hyphen, because a long dash reads as punctuation. */
const DASH = <span className="text-muted">-</span>;

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

// ---------------------------------------------------------------------------

function Rounds({ rounds }: { rounds: RoundRow[] }) {
  return (
    <Panel
      span={12}
      title="Rounds"
      count={
        rounds.length === 0
          ? "none yet"
          : `${rounds.filter((r) => r.state !== "draft").length} of ${rounds.length} frozen`
      }
      body={rounds.length === 0 ? undefined : "flush"}
    >
      {rounds.length === 0 ? (
        <Empty
          title="No round yet"
          body="Draw a set above. It appears here, ready to freeze."
        />
      ) : (
        <DenseTable minWidth={900}>
          <caption className="sr-only">Validation rounds and what to do next with each.</caption>
          <thead>
            <tr>
              <Th>Round</Th>
              <Th>Screen</Th>
              <Th>State</Th>
              <Th align="right">Drawn</Th>
              <Th align="right">Recorded</Th>
              <Th align="right">Confirmed</Th>
              <Th>Stamp</Th>
              <Th>Next</Th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((round) => (
              <tr key={round.id}>
                <td className="font-medium text-ink">
                  {round.state === "draft" ? (
                    <span className="block max-w-[200px] truncate">{round.name}</span>
                  ) : (
                    <Link
                      href={`${BASE}?round=${encodeURIComponent(round.id)}`}
                      className="block max-w-[200px] truncate text-ink underline decoration-line-strong underline-offset-2 hover:decoration-orange-500"
                    >
                      {round.name}
                    </Link>
                  )}
                  <span className="text-[10.5px] text-muted">{shortDate(round.createdAt)}</span>
                </td>
                <td>
                  <Link
                    href={`/dashboard/screens/${round.screenId}`}
                    className="block max-w-[170px] truncate text-body underline decoration-line-strong underline-offset-2 hover:decoration-orange-500"
                  >
                    {round.screenName ?? round.screenId}
                  </Link>
                </td>
                <td>
                  <StatusChip
                    tone={
                      round.state === "draft" ? "idle" : round.state === "frozen" ? "run" : "ok"
                    }
                  >
                    {ROUND_STATE_LABEL[round.state]}
                  </StatusChip>
                </td>
                <td className="num-col">{formatNumber(round.nSlots)}</td>
                <td className="num-col">{formatNumber(round.nRecorded)}</td>
                <td className="num-col">{formatNumber(round.nDecided)}</td>
                <td
                  className="font-mono text-[10.5px] text-muted"
                  title={round.receiptSha256 ?? undefined}
                >
                  {round.receiptSha256 ? round.receiptSha256.slice(0, 10) : DASH}
                </td>
                <td>
                  {round.state === "draft" ? (
                    <FreezeButton roundId={round.id} nSlots={round.nSlots} />
                  ) : round.state === "frozen" ? (
                    <span className="inline-flex items-center gap-2">
                      <Link
                        href={`${BASE}?round=${encodeURIComponent(round.id)}`}
                        className="text-[11.5px] text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600"
                      >
                        Record results
                      </Link>
                      <RevealButton roundId={round.id} />
                    </span>
                  ) : (
                    <Link
                      href={`${BASE}?round=${encodeURIComponent(round.id)}`}
                      className="text-[11.5px] text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600"
                    >
                      See results
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DenseTable>
      )}
    </Panel>
  );
}

/**
 * Calibration, once there is any.
 *
 * Returns nothing until a question is actually calibrated. An earlier version
 * showed a permanent line saying no probability was available and naming the
 * thresholds, which is a true sentence that does nothing: a researcher cannot
 * act on it, and it was on the page every single visit.
 *
 * The honesty it carried has not been dropped, it has moved to where it bites.
 * The gate still refuses to state a probability, the engine still records why
 * on every pipeline run, and no surface anywhere prints a number without the
 * cohort behind it. Those are enforced in code and by tests, not by a banner.
 */
function Calibration({
  heads,
  strata,
  endpoints,
}: {
  heads: HeadStatus[];
  strata: StratumRow[];
  endpoints: EndpointRow[];
}) {
  const fitted = heads.filter((h) => h.available).length;
  if (fitted === 0) return null;
  return (
    <div className="col-span-12">
      <details className="group rounded-xl border border-line bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-[var(--panel-gutter)] py-2.5 text-[12.5px] text-ink">
          <span>
            {fitted} of 4 questions calibrated
            <span className="ml-2 text-[11.5px] text-muted">
              reliability, coverage and endpoints
            </span>
          </span>
          <span className="shrink-0 text-[11.5px] text-cyan-600 group-open:hidden">Show</span>
          <span className="hidden shrink-0 text-[11.5px] text-cyan-600 group-open:inline">Hide</span>
        </summary>

        <div className="border-t border-line">
          <DenseTable minWidth={760}>
            <caption className="sr-only">
              Whether a calibrated probability is available for each question.
            </caption>
            <thead>
              <tr>
                <Th>Question</Th>
                <Th>Status</Th>
                <Th align="right">Outcomes</Th>
                <Th align="right">Labs</Th>
                <Th align="right">Brier</Th>
                <Th align="right">Slope</Th>
                <Th>Evidenced</Th>
              </tr>
            </thead>
            <tbody>
              {heads.map((head) => (
                <tr key={head.question}>
                  <td className="text-ink">{QUESTION_LABEL[head.question]}</td>
                  <td>
                    <StatusChip tone={head.available ? "ok" : "idle"}>
                      {head.available ? "Calibrated" : "Not available"}
                    </StatusChip>
                  </td>
                  <td className="num-col">
                    {head.nDecided === null ? DASH : formatNumber(head.nDecided)}
                  </td>
                  <td className="num-col">
                    {head.nLabs === null ? DASH : formatNumber(head.nLabs)}
                  </td>
                  <td className="num-col">
                    {head.brier === null ? DASH : head.brier.toFixed(3)}
                  </td>
                  <td className="num-col">
                    {head.calibrationSlope === null ? DASH : head.calibrationSlope.toFixed(2)}
                  </td>
                  <td className="text-[11.5px] text-muted">
                    {head.evidencedLow === null
                      ? DASH
                      : `${formatProbability(head.evidencedLow)} to ${formatProbability(head.evidencedHigh)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </DenseTable>

          {strata.length > 0 && (
            <DenseTable minWidth={620} maxRows={6}>
              <caption className="sr-only">Validation contexts and whether each is open.</caption>
              <thead>
                <tr>
                  <Th>Context</Th>
                  <Th align="right">Outcomes</Th>
                  <Th align="right">Labs</Th>
                  <Th align="right">Screens</Th>
                  <Th>Open</Th>
                </tr>
              </thead>
              <tbody>
                {strata.map((stratum) => (
                  <tr key={`${stratum.question}:${stratum.key}`}>
                    <td title={`${QUESTION_LABEL[stratum.question]}, ${stratum.describe}`}>
                      <span className="block max-w-[260px] truncate text-ink">
                        {stratum.describe}
                      </span>
                      <span className="text-[10.5px] text-muted">
                        {QUESTION_SHORT[stratum.question]}
                      </span>
                    </td>
                    <td className="num-col">{formatNumber(stratum.nDecided)}</td>
                    <td className="num-col">{formatNumber(stratum.nLabs)}</td>
                    <td className="num-col">{formatNumber(stratum.nScreens)}</td>
                    <td title={stratum.shortfall.join("; ") || undefined}>
                      <StatusChip tone={stratum.isOpen ? "ok" : "idle"}>
                        {stratum.isOpen ? "Open" : "Short"}
                      </StatusChip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DenseTable>
          )}

          <DenseTable minWidth={620} maxRows={9}>
            <caption className="sr-only">What counts as validated, per assay class.</caption>
            <thead>
              <tr>
                <Th>Endpoint</Th>
                <Th>Question</Th>
                <Th>Direction</Th>
                <Th align="right" width={64}>
                  Min
                </Th>
                <Th width={72}>Bar</Th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((endpoint) => (
                <tr key={endpoint.key}>
                  <td className="text-ink" title={endpoint.negativeMeans}>
                    {endpoint.label}
                  </td>
                  <td className="text-[11.5px] text-muted">
                    {QUESTION_SHORT[endpoint.question]}
                  </td>
                  <td className="text-[11.5px] text-muted">{endpoint.direction}</td>
                  <td
                    className="num-col"
                    title="independent perturbations / biological replicates"
                  >
                    {endpoint.minPerturbations}/{endpoint.minReplicates}
                  </td>
                  <td className="text-[11.5px] text-muted">
                    {endpoint.thresholdOwner === "laboratory" ? "You" : endpoint.thresholdOwner}
                  </td>
                </tr>
              ))}
            </tbody>
          </DenseTable>

          <div className="border-t border-line px-[var(--panel-gutter)] py-2">
            <FootNote>
              A question opens once its context holds {COVERAGE_THRESHOLDS.minStratumOutcomes}{" "}
              decided outcomes from {COVERAGE_THRESHOLDS.minStratumLabs} laboratories across{" "}
              {COVERAGE_THRESHOLDS.minStratumScreens} screens.
            </FootNote>
          </div>
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function NetworkPanels({
  view,
  strata,
  endpoints,
  rounds,
  screens,
  results,
}: {
  view: NetworkView;
  strata: StratumRow[];
  endpoints: EndpointRow[];
  rounds: RoundRow[];
  screens: SetupScreen[];
  /** The round the address selected, scored. Null when none is selected. */
  results: RoundResults | null;
}) {
  const setupEndpoints: SetupEndpoint[] = endpoints.map((e) => ({
    key: e.key,
    label: e.label,
    thresholdOwner: e.thresholdOwner,
    effectMetric: e.effectMetric,
    negativeMeans: e.negativeMeans,
  }));

  return (
    <div className="flex flex-col gap-3">
      <PageHeaderRow results={results} />

      <div className="grid grid-cols-12 content-start gap-4">
        {results ? (
          <RoundResultsPanels results={results} screenId={results.round.screenId} />
        ) : (
          <>
            <RoundSetup screens={screens} endpoints={setupEndpoints} />
            <Rounds rounds={rounds} />
            <Calibration heads={view.heads} strata={strata} endpoints={endpoints} />
          </>
        )}
      </div>
    </div>
  );
}

function PageHeaderRow({ results }: { results: RoundResults | null }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[17px] font-medium leading-tight tracking-[-0.01em] text-ink">
          Validation Network
        </h1>
        <p className="text-[12.5px] text-muted">
          Test your top hits at the bench and find out which way of picking them works.
        </p>
      </div>
      {results && (
        <Link
          href={BASE}
          className="text-[12px] text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600"
        >
          All rounds
        </Link>
      )}
    </div>
  );
}
