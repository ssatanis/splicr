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
 * calibrated on a reference cohort, which is now named with its own denominator.
 *
 * And its RESULT column ran each bench outcome through VerdictBadge, so a
 * measurement the lab made came out labelled as the model's opinion of it:
 * `pending` rendered as "Uncertain", which asserts a finished result for an
 * experiment still running, and `failed` rendered as "Artifact", which is a
 * different and much stronger claim than "did not validate". The overview's
 * table already had the right words; they are shared now.
 */
import { Info } from "lucide-react";
import Link from "next/link";

import { CalibrationChart } from "@/components/dashboard/charts";
import { OutcomeBadge } from "@/components/dashboard/outcome-badge";
import { Card, Kpi, PageHeader } from "@/components/dashboard/ui";
import { calibration, calibrationN, outcomes, screens } from "@/lib/mock/data";
import { formatDate, formatNumber, formatPercent } from "@/lib/utils";

export const metadata = { title: "Truth Loop" };

export default function ValidationPage() {
  const validated = outcomes.filter((o) => o.result === "validated").length;
  const failed = outcomes.filter((o) => o.result === "failed").length;
  const pending = outcomes.filter((o) => o.result === "pending").length;
  const inconclusive = outcomes.filter((o) => o.result === "inconclusive").length;
  // The denominator is the two results that answer the question. Pending and
  // inconclusive are excluded, and the KPI hint says so rather than leaving a
  // reader to work out why 4 of 7 reads as 80%.
  const decided = validated + failed;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Truth Loop"
        title="Logged outcomes"
        body="What a lab found when it re-tested its hits. Every entry logged against a real workspace retrains the score."
      />

      <p className="flex items-start gap-2 rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm text-orange-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          Sample data. These {formatNumber(outcomes.length)} outcomes, the genes they name and the reliability curve
          beside them are invented to show the layout. None of it is your lab&apos;s work and none of it is a
          measurement.
        </span>
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Outcomes logged" value={outcomes.length} hint="In the sample dataset" />
        <Kpi label="Validated" value={validated} tone="cyan" hint="Held up at the bench" />
        <Kpi
          label="Validated rate"
          value={decided > 0 ? formatPercent(validated / decided) : "Not enough outcomes"}
          hint={`${validated} of ${decided} decided. ${pending} pending and ${inconclusive} inconclusive are excluded from the denominator.`}
          tone="orange"
        />
        <Kpi label="Still at the bench" value={pending} hint="No result yet, so none is shown" />
      </div>

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
        <Card title="All outcomes" subtitle="The result column is what the bench measured, not what the model thinks">
          <div className="overflow-x-auto thin-scroll">
            <table className="table-base min-w-[760px]">
              <caption className="sr-only">
                Every bench outcome in the sample dataset, with the screen it belongs to.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Gene</th>
                  <th scope="col">Screen</th>
                  <th scope="col">Chance real when called</th>
                  <th scope="col">Bench result</th>
                  <th scope="col">Assay</th>
                  <th scope="col">By</th>
                  <th scope="col">Logged</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map((o) => (
                  <tr key={o.id}>
                    <td className="font-medium">{o.gene}</td>
                    <td>
                      <Link
                        href={`/dashboard/screens/${o.screenId}?tab=validation`}
                        className="hover:text-orange-500 text-sm"
                      >
                        {screens.find((s) => s.id === o.screenId)?.name ?? o.screenId}
                      </Link>
                    </td>
                    <td className="tabular-nums">{Math.round(o.predicted * 100)}%</td>
                    <td>
                      <OutcomeBadge result={o.result} />
                    </td>
                    <td className="text-sm">{o.assay}</td>
                    <td className="text-sm">{o.by}</td>
                    <td className="text-sm text-muted whitespace-nowrap">{formatDate(o.loggedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="Calibration"
          subtitle={`${formatNumber(calibrationN)} outcomes in the ${calibration.cohort}, not the ${formatNumber(outcomes.length)} above`}
        >
          <CalibrationChart bins={calibration.bins} />
          <ul className="mt-4 text-xs text-muted space-y-1">
            {calibration.bins.map((b) => (
              <li key={b.bin} className="flex justify-between">
                <span>{b.bin}</span>
                <span>
                  {Math.round(b.observed * 100)}% validated · n={b.n}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            {calibration.source}. {formatNumber(outcomes.length)} outcomes cannot fill six bins, so this curve is not
            computed from the table beside it and the two counts are not the same quantity. A workspace starts reading
            its own curve once it has logged enough outcomes to fill a bin.
          </p>
        </Card>
      </div>
    </div>
  );
}
