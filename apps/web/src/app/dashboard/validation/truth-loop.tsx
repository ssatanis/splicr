"use client";

/**
 * The Truth Loop.
 *
 * Three things were wrong with this page and all three were about what a number
 * is allowed to claim.
 *
 * It presented invented outcomes as the reader's own lab work, under the words
 * "What your lab actually found", with no sample-data label anywhere on it, on a
 * console whose database is down. Every other dashboard page that reads the
 * fixture says so; this one did not.
 *
 * It printed "Outcomes logged 7" directly above a reliability curve whose six
 * bin counts summed to 300, headed "Across all logged outcomes". Two
 * irreconcilable counts for the same quantity on one screen. The curve is
 * calibrated on a reference cohort, which is now named with its own denominator
 * in the panel that draws it.
 *
 * And its RESULT column ran each bench outcome through VerdictBadge, so a
 * measurement the lab made came out labelled as the model's opinion of it:
 * `pending` rendered as "Uncertain", which asserts a finished result for an
 * experiment still running, and `failed` rendered as "Artifact", which is a
 * different and much stronger claim than "did not validate". `OutcomeBadge` says
 * what the bench said.
 *
 * WHAT CHANGED IN THE LAYOUT
 *
 * The page was a stack of loose sections in 24px cards that ran 900px past a
 * 1280x800 fold. It is the console's panel grid now: one dense table of every
 * outcome, the reliability curve beside it, and the four figures above both with
 * their denominators in the tile rather than in a hint underneath. The table
 * sorts from the query string, because the reader who wants this page is often
 * answering a question from their PI and has to be able to send the answer back.
 */

import Link from "next/link";

import { CalibrationChart } from "@/components/dashboard/charts";
import { DefRow, SampleNote } from "@/components/dashboard/console";
import {
  CsvFootLink,
  useUrlSort,
  type Cell,
} from "@/components/dashboard/console-controls";
import { OutcomeBadge } from "@/components/dashboard/outcome-badge";
import {
  DenseTable,
  FootNote,
  KpiStrip,
  KpiTile,
  PageHeader,
  Panel,
  SortTh,
} from "@/components/dashboard/ui";
import { calibration, calibrationN, outcomes, screens, type Outcome } from "@/lib/mock/data";
import { formatDate, formatNumber, formatPercent } from "@/lib/utils";

/** The screen an outcome belongs to, by name, so a column can sort on it. */
const screenNameOf = (outcome: Outcome) =>
  screens.find((s) => s.id === outcome.screenId)?.name ?? outcome.screenId;

/** One cell reader, so a column sorts on exactly the value it prints. */
const cellOf = (outcome: Outcome, key: string): Cell => {
  switch (key) {
    case "gene":
      return outcome.gene;
    case "screen":
      return screenNameOf(outcome);
    case "predicted":
      return outcome.predicted;
    case "result":
      return outcome.result;
    case "assay":
      return outcome.assay;
    case "by":
      return outcome.by;
    case "logged":
      return Date.parse(outcome.loggedAt);
    default:
      return null;
  }
};

const OUTCOME_COLUMNS = [
  "gene",
  "screen",
  "chance_real_when_called",
  "bench_result",
  "assay",
  "logged_by",
  "logged_at",
] as const;

export function TruthLoop() {
  const validated = outcomes.filter((o) => o.result === "validated").length;
  const failed = outcomes.filter((o) => o.result === "failed").length;
  const pending = outcomes.filter((o) => o.result === "pending").length;
  const inconclusive = outcomes.filter((o) => o.result === "inconclusive").length;
  // The denominator is the two results that answer the question. Pending and
  // inconclusive are excluded, and the tile says so rather than leaving a reader
  // to work out why 4 of 7 reads as 80%.
  const decided = validated + failed;

  const { sorted, sortProps } = useUrlSort(outcomes, { key: "logged", dir: "desc" }, cellOf);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHeader
        dense
        title="Truth Loop"
        body="What a lab found when it re-tested its hits. Every logged outcome retrains the score."
      />
      <SampleNote>
        Sample data. These {formatNumber(outcomes.length)} outcomes, the genes they name and the
        reliability curve beside them are invented to show the layout. None of it is your lab&apos;s
        work and none of it is a measurement.
      </SampleNote>

      <KpiStrip title="Logged outcomes" count={`${formatNumber(outcomes.length)} in the sample dataset`}>
        <KpiTile
          label="Outcomes logged"
          value={formatNumber(outcomes.length)}
          denominator="sample rows"
          definition="Every row in the table below, all time."
        />
        <KpiTile
          label="Validated"
          value={formatNumber(validated)}
          denominator={`of ${formatNumber(decided)} decided`}
          definition="Held up in the assay the row names."
          tone="cyan"
        />
        <KpiTile
          label="Validated rate"
          value={decided > 0 ? formatPercent(validated / decided) : "Not enough outcomes"}
          denominator={decided > 0 ? `${validated} of ${decided}` : undefined}
          definition={`${pending} pending and ${inconclusive} inconclusive are out of the denominator.`}
          tone="orange"
        />
        <KpiTile
          label="Still at the bench"
          value={formatNumber(pending)}
          denominator="no result yet"
          definition="No figure is shown for a re-test still running."
        />
      </KpiStrip>

      <div className="grid min-h-0 grid-cols-12 gap-4 lg:flex-1 lg:grid-rows-[minmax(0,1fr)]">
        <Panel
          span={8}
          className="min-h-[300px]"
          title="All outcomes"
          count={`${formatNumber(sorted.length)} outcomes`}
          body="flush"
          footer={
            <>
              <FootNote>
                Bench result is what the assay measured, not the model&apos;s verdict
              </FootNote>
              <CsvFootLink
                filename="splicr-sample-outcomes.csv"
                columns={OUTCOME_COLUMNS}
                rows={sorted.map((o) => [
                  o.gene,
                  screenNameOf(o),
                  o.predicted,
                  o.result,
                  o.assay,
                  o.by,
                  o.loggedAt,
                ])}
              >
                Export CSV
              </CsvFootLink>
            </>
          }
        >
          <DenseTable minWidth={760}>
            <caption className="sr-only">
              Every bench outcome in the sample dataset, with the screen it belongs to. Sortable by
              any column heading.
            </caption>
            <thead>
              <tr>
                <SortTh label="Gene" {...sortProps("gene")} />
                <SortTh label="Screen" {...sortProps("screen")} />
                <SortTh
                  label="Chance real"
                  align="right"
                  title="The calibrated chance real the score gave this gene when it was called, before the bench answered"
                  {...sortProps("predicted", "desc")}
                />
                <SortTh label="Bench result" {...sortProps("result")} />
                <SortTh label="Assay" {...sortProps("assay")} />
                <SortTh label="By" {...sortProps("by")} />
                <SortTh label="Logged" {...sortProps("logged", "desc")} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((outcome) => (
                <tr key={outcome.id}>
                  <td className="font-medium text-ink">{outcome.gene}</td>
                  <td>
                    <Link
                      href={`/dashboard/screens/${outcome.screenId}?tab=validation`}
                      className="text-ink underline decoration-line-strong underline-offset-2 hover:decoration-orange-500"
                    >
                      {screenNameOf(outcome)}
                    </Link>
                  </td>
                  <td className="num-col">{Math.round(outcome.predicted * 100)}%</td>
                  <td>
                    <OutcomeBadge result={outcome.result} />
                  </td>
                  <td>{outcome.assay}</td>
                  <td>{outcome.by}</td>
                  <td className="text-muted" title={formatDate(outcome.loggedAt)}>
                    {formatDate(outcome.loggedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </DenseTable>
        </Panel>

        <Panel
          span={4}
          className="min-h-[300px] [animation-delay:60ms]"
          title="Calibration"
          count={`${formatNumber(calibrationN)} outcomes`}
          footer={<FootNote>{calibration.cohort}, not the rows beside it</FootNote>}
        >
          {/* A reliability curve, which is the one plot this page owes the reader:
              the diagonal is what the score promised and the line is what the
              bench delivered. The bins are printed underneath because reading a
              value off a 150px plot is not reading a value. */}
          <CalibrationChart bins={calibration.bins} height={150} />
          <div className="mt-2">
            {calibration.bins.map((bin) => (
              <DefRow
                key={bin.bin}
                term={`Predicted ${bin.bin}`}
                value={`${Math.round(bin.observed * 100)}% validated`}
                note={`n=${bin.n}`}
              />
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted">
            {calibration.source}. {formatNumber(outcomes.length)} outcomes cannot fill six bins, so
            this curve is not computed from the table beside it and the two counts are not the same
            quantity. A workspace starts reading its own curve once it has logged enough outcomes to
            fill a bin.
          </p>
        </Panel>
      </div>
    </div>
  );
}
