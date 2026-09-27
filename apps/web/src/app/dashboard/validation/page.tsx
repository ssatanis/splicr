import Link from "next/link";

import { CalibrationChart } from "@/components/dashboard/charts";
import { Card, Kpi, PageHeader, VerdictBadge } from "@/components/dashboard/ui";
import { calibrationBins, outcomes, screens } from "@/lib/mock/data";
import { formatDate, formatPercent } from "@/lib/utils";

export const metadata = { title: "Truth Loop" };

export default function ValidationPage() {
  const validated = outcomes.filter((o) => o.result === "validated").length;
  const decided = outcomes.filter((o) => o.result === "validated" || o.result === "failed").length;
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Truth Loop" title="Logged outcomes" body="What your lab actually found when it re-tested hits. Every entry sharpens the score." />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Outcomes logged" value={outcomes.length} />
        <Kpi label="Validated" value={validated} tone="cyan" />
        <Kpi label="Validated rate" value={formatPercent(decided ? validated / decided : 0)} hint="Of decided outcomes" tone="orange" />
        <Kpi label="Pending" value={outcomes.filter((o) => o.result === "pending").length} />
      </div>
      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
        <Card title="All outcomes">
          <div className="overflow-x-auto thin-scroll">
            <table className="table-base min-w-[760px]">
              <thead>
                <tr>
                  <th>Gene</th>
                  <th>Screen</th>
                  <th>Predicted</th>
                  <th>Result</th>
                  <th>Assay</th>
                  <th>By</th>
                  <th>Logged</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map((o) => (
                  <tr key={o.id}>
                    <td className="font-medium">{o.gene}</td>
                    <td>
                      <Link href={`/dashboard/screens/${o.screenId}?tab=validation`} className="hover:text-orange-500 text-sm">
                        {screens.find((s) => s.id === o.screenId)?.name}
                      </Link>
                    </td>
                    <td>{Math.round(o.predicted * 100)}%</td>
                    <td>
                      <VerdictBadge verdict={o.result === "validated" ? "Real and new" : o.result === "failed" ? "Artifact" : "Uncertain"} />
                    </td>
                    <td className="text-sm">{o.assay}</td>
                    <td className="text-sm">{o.by}</td>
                    <td className="text-sm text-muted">{formatDate(o.loggedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Calibration" subtitle="Across all logged outcomes">
          <CalibrationChart bins={calibrationBins} />
          <ul className="mt-4 text-xs text-muted space-y-1">
            {calibrationBins.map((b) => (
              <li key={b.bin} className="flex justify-between">
                <span>{b.bin}</span>
                <span>
                  {Math.round(b.observed * 100)}% validated · n={b.n}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
