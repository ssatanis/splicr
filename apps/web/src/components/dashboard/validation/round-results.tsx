/**
 * What a round found, once the bench starts answering.
 *
 * Four figures, a table of strategies and a table of candidates. The
 * comparison sentence says what the round measured and whether the interval
 * clears zero, and never that one strategy is better: at a budget of twenty it
 * usually will not clear zero, and a results page that implies otherwise is the
 * failure this product exists to prevent.
 */
import Link from "next/link";

import {
  DenseTable,
  FootNote,
  KpiStrip,
  KpiTile,
  Panel,
  StatusChip,
  Th,
} from "@/components/dashboard/ui";
import { OutcomeBadge } from "@/components/dashboard/outcome-badge";
import type { RoundResults } from "@/lib/data/validation-network";
import { formatNumber } from "@/lib/utils";
import { ARM_LABEL, ROUND_STATE_LABEL } from "@/lib/validation/model";

/** An empty cell. A plain hyphen, because a long dash reads as punctuation. */
const DASH = <span className="text-muted">-</span>;

const pct = (value: number | null) =>
  value === null ? DASH : <span className="num">{Math.round(value * 100)}%</span>;

const interval = (lower: number | null, upper: number | null) =>
  lower === null || upper === null
    ? ""
    : `${Math.round(lower * 100)} to ${Math.round(upper * 100)}%`;

export function RoundResultsPanels({
  results,
  screenId,
}: {
  results: RoundResults;
  screenId: string;
}) {
  const { round, progress, arms, comparisons, discordances, candidates } = results;
  // Counted over distinct candidates, not summed across arms. A candidate two
  // strategies both picked costs one validation and is one confirmation; adding
  // the arms up would charge the lab twice for the same plate.
  const confirmed = candidates.filter((c) => c.result === "validated").length;
  const spent = progress.nDecided;
  const cost = confirmed > 0 ? spent / confirmed : null;

  /** The Truth Loop, with this gene and screen already filled in. */
  const recordHref = (gene: string) =>
    `/dashboard/validation?log=${encodeURIComponent(gene)}&logScreen=${encodeURIComponent(screenId)}`;

  return (
    <>
      <KpiStrip
        span={12}
        title={round.name}
        count={ROUND_STATE_LABEL[round.state]}
        control={
          <Link
            href={`/dashboard/validation?screen=${encodeURIComponent(screenId)}`}
            className="text-[12px] text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600"
          >
            Record an outcome
          </Link>
        }
      >
        <KpiTile
          label="Recorded"
          value={formatNumber(progress.nRecorded)}
          denominator={`of ${formatNumber(progress.nDrawn)}`}
          definition={
            progress.nOutstanding > 0
              ? `${formatNumber(progress.nOutstanding)} still to come back from the bench`
              : "Every candidate has an outcome"
          }
          tone={progress.complete ? "cyan" : "ink"}
        />
        <KpiTile
          label="Decided"
          value={formatNumber(progress.nDecided)}
          definition="Validated or did not validate. Pending and inconclusive are neither."
        />
        <KpiTile
          label="Confirmed"
          value={formatNumber(confirmed)}
          denominator={spent > 0 ? `of ${formatNumber(spent)} decided` : undefined}
          definition="Candidates that met the prespecified endpoint"
          tone={confirmed > 0 ? "cyan" : "ink"}
        />
        <KpiTile
          label="Validations per confirmation"
          value={cost === null ? "-" : cost.toFixed(1)}
          definition={
            cost === null
              ? "No confirmation yet, so no cost is stated"
              : "Bench work spent for each confirmed hit"
          }
        />
      </KpiStrip>

      <Panel
        span={12}
        title="By strategy"
        count={`${arms.length} compared`}
        body="flush"
        footer={
          comparisons.length === 0 ? (
            <FootNote>
              A comparison appears once two strategies each have a decided outcome.
            </FootNote>
          ) : (
            <div className="flex flex-col gap-0.5">
              {comparisons.map((comparison) => (
                <FootNote key={comparison.difference.comparator}>{comparison.sentence}</FootNote>
              ))}
              <FootNote>
                A candidate two strategies both picked counts for both, so the
                rates above add up to more than the round.
              </FootNote>
            </div>
          )
        }
      >
        <DenseTable minWidth={780}>
          <caption className="sr-only">
            Each strategy&apos;s confirmation rate in this round.
          </caption>
          <thead>
            <tr>
              <Th>Strategy</Th>
              <Th align="right">Drawn</Th>
              <Th align="right">Recorded</Th>
              <Th align="right">Decided</Th>
              <Th align="right">Confirmed</Th>
              <Th align="right">Rate</Th>
              <Th>95% interval</Th>
              <Th align="right">Cost</Th>
            </tr>
          </thead>
          <tbody>
            {arms.map((arm) => (
              <tr key={arm.arm}>
                <td className="font-medium text-ink">{arm.label}</td>
                <td className="num-col">{formatNumber(arm.nDrawn)}</td>
                <td className="num-col">{formatNumber(arm.nRecorded)}</td>
                <td className="num-col">{formatNumber(arm.nDecided)}</td>
                <td className="num-col">{formatNumber(arm.nValidated)}</td>
                <td className="num-col">{pct(arm.rate)}</td>
                <td className="num text-[11.5px] text-muted">
                  {arm.rate === null ? DASH : interval(arm.lower, arm.upper)}
                </td>
                <td
                  className="num-col"
                  title="Validations spent per confirmed hit"
                >
                  {arm.costPerConfirmation === null
                    ? DASH
                    : arm.costPerConfirmation.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </DenseTable>
      </Panel>

      {discordances.length > 0 && (
        <Panel
          span={12}
          title="Where they disagreed"
          count={`${discordances[0].nShared} picked by both`}
          footer={
            <FootNote>
              Candidates both strategies picked cannot tell them apart however
              they turn out, so only the rest are counted here.
            </FootNote>
          }
        >
          <div className="flex flex-col gap-2">
            {discordances.map((test) => (
              <div key={test.comparator} className="text-[12.5px] leading-snug text-body">
                {test.because}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel
        span={12}
        title="Candidates"
        count={`${formatNumber(candidates.length)} drawn`}
        body="flush"
        footer={
          <FootNote>
            Which strategy proposed each candidate was fixed when the round was
            frozen and cannot be changed now.
          </FootNote>
        }
      >
        <DenseTable minWidth={760} maxRows={14}>
          <caption className="sr-only">
            Every candidate in this round, the strategy that proposed it, and what the
            bench found.
          </caption>
          <thead>
            <tr>
              <Th>Gene</Th>
              <Th>Strategy</Th>
              <Th align="right">Rank</Th>
              <Th>Result</Th>
              <Th align="right">Effect</Th>
              <Th>Lab</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => (
              <tr key={`${candidate.arm}:${candidate.gene}`}>
                <td className="font-medium text-ink">{candidate.gene}</td>
                <td className="text-[11.5px] text-muted">
                  {candidate.wantedBy.length > 1
                    ? `Both (${candidate.wantedBy.length})`
                    : ARM_LABEL[candidate.arm]}
                </td>
                <td className="num-col">
                  {candidate.rankOverall === null ? DASH : formatNumber(candidate.rankOverall)}
                </td>
                <td>
                  {candidate.result === null ? (
                    <StatusChip tone="idle">Not recorded</StatusChip>
                  ) : (
                    <OutcomeBadge result={candidate.result} />
                  )}
                </td>
                <td className="num-col">
                  {candidate.effectSize === null ? DASH : candidate.effectSize.toFixed(2)}
                </td>
                <td className="text-[11.5px] text-muted">{candidate.labId ?? DASH}</td>
                <td>
                  {candidate.result === null || candidate.result === "pending" ? (
                    <Link
                      href={recordHref(candidate.gene)}
                      className="text-[11.5px] text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600"
                    >
                      Record
                    </Link>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </DenseTable>
      </Panel>
    </>
  );
}
