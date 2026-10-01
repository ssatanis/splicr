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
 * irreconcilable counts for the same quantity on one screen. The curve uses an invented demonstration cohort, labelled separately from
 * the illustrative outcome table; it is not measured calibration evidence.
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
  PageHeader,
  Panel,
  SortTh,
} from "@/components/dashboard/ui";
import { calibration, calibrationN, outcomes, screens, type Outcome } from "@/lib/mock/data";
import { formatDate, formatNumber, formatPercent } from "@/lib/utils";

/** Day and month in a column; the full date stays on the cell as its title. */
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

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
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      <PageHeader
        dense
        title="Truth Loop"
        body="Illustrative validation records. Demo interactions do not save outcomes or retrain any model."
      />
      <SampleNote>
        Sample data. These {formatNumber(outcomes.length)} outcomes, the genes they name and the
        reliability curve beside them are invented to show the layout. None of it is your lab&apos;s
        work and none of it is a measurement.
      </SampleNote>

      {/* The table gets the whole width. In an 8-of-12 panel its seven columns
          wanted 760px of 657 and the date was cut off the right edge, and the
          four KPI tiles that used to sit above it restated a seven-row table,
          which is the vanity figure the brief warns about. The rate that is
          actually a claim is in this panel's footer, next to the rows it was
          counted from. */}
      <div className="grid min-h-0 grid-cols-12 gap-4 lg:flex-1 lg:grid-rows-[minmax(0,1fr)_auto]">
        <Panel
          span={12}
          className="min-h-[300px]"
          title="All outcomes"
          count={`${formatNumber(sorted.length)} logged, ${formatNumber(pending)} still at the bench`}
          body="flush"
          footer={
            <>
              <FootNote>
                {decided > 0
                  ? `${formatPercent(validated / decided)} validated, ${validated} of ${decided} decided. ${pending} pending and ${inconclusive} inconclusive are out of that denominator. Result is what the assay measured, not the model's verdict.`
                  : "No outcome has been decided yet, so no rate is stated. Result is what the assay measured, not the model's verdict."}
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
                  label="Demo score"
                  align="right"
                  title="Illustrative model score at the call; not a validation probability"
                  {...sortProps("predicted", "desc")}
                />
                <SortTh label="Result" title="What the bench measured" {...sortProps("result")} />
                <SortTh label="Assay" {...sortProps("assay")} />
                {/* Who logged it rides with when, because seven columns of nowrap
                    text wanted 865px of a 657px panel and the two together are
                    one fact: this person, on this date. Both are their own column
                    in the export. */}
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
                      title={screenNameOf(outcome)}
                      className="block max-w-[220px] truncate text-ink underline decoration-line-strong underline-offset-2 hover:decoration-orange-500"
                    >
                      {screenNameOf(outcome)}
                    </Link>
                  </td>
                  <td className="num-col">{outcome.predicted.toFixed(3)}</td>
                  <td>
                    <OutcomeBadge result={outcome.result} />
                  </td>
                  <td>
                    <span className="block max-w-[200px] truncate" title={outcome.assay}>
                      {outcome.assay}
                    </span>
                  </td>
                  <td
                    className="text-muted"
                    title={`${formatDate(outcome.loggedAt)}, logged by ${outcome.by}`}
                  >
                    {shortDate(outcome.loggedAt)}
                    <span className="ml-1.5 text-ink">{outcome.by}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </DenseTable>
        </Panel>

        <Panel
          span={12}
          className="[animation-delay:60ms]"
          title="Illustrative reliability curve"
          count={`${formatNumber(calibrationN)} invented outcomes in the ${calibration.cohort}`}
          footer={
            <FootNote>
              Invented demonstration cohort; this curve is not empirical calibration evidence.
              It is separate from the {formatNumber(outcomes.length)} illustrative rows above
            </FootNote>
          }
          bodyClassName="py-3"
        >
          <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
            {/* A reliability curve, which is the one plot this page owes the
                reader: the dashed diagonal is what the score promised and the
                line is what the bench delivered. The bins are printed beside it
                because reading a value off a 140px plot is not reading a value. */}
            <div className="w-full max-w-[360px] shrink-0">
              <CalibrationChart bins={calibration.bins} height={140} />
            </div>
            <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-6 sm:grid-cols-3">
              {calibration.bins.map((bin) => (
                <DefRow
                  key={bin.bin}
                  term={`Predicted ${bin.bin}`}
                  value={`${Math.round(bin.observed * 100)}%`}
                  note={`validated, n=${bin.n}`}
                />
              ))}
            </dl>
          </div>
        </Panel>
      </div>
    </div>
  );
}
