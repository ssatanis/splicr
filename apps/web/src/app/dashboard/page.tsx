import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { CalibrationChart } from "@/components/dashboard/charts";
import { Card, Chance, Kpi, PageHeader, StageRail, StatusBadge, VerdictBadge } from "@/components/dashboard/ui";
import { calibrationBins, demoHits, outcomes, overviewKpis, screens, stageRuns } from "@/lib/mock/data";
import { formatDate, formatNumber, formatPercent } from "@/lib/utils";

export default function OverviewPage() {
  const topHits = demoHits.filter((h) => h.verdict === "Real and new").slice(0, 6);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Overview"
        title="Good evening."
        body="Three screens finished this week. One is running, one is queued, and 41 hits are waiting for a validation plan."
        actions={
          <Link href="/dashboard/upload" className="btn btn-orange btn-sm">
            New run <ArrowRight className="w-4 h-4" />
          </Link>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi label="Screens" value={overviewKpis.screens} hint="2 running or queued" />
        <Kpi label="Hits scored" value={formatNumber(overviewKpis.hitsScored)} hint="Across all screens" />
        <Kpi label="Outcomes logged" value={overviewKpis.outcomesLogged} hint="Truth Loop" tone="cyan" />
        <Kpi label="Validated rate" value={formatPercent(overviewKpis.validatedRate)} hint="Of hits you tested" tone="orange" />
        <Kpi label="Atlas screens" value={formatNumber(overviewKpis.atlasScreens)} hint="Public, re-analyzed" />
      </div>

      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-4">
        <Card
          title="Recent screens"
          action={
            <Link href="/dashboard/screens" className="text-sm text-orange-500 inline-flex items-center gap-1">
              All screens <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          }
        >
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
                {screens.slice(0, 5).map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/dashboard/screens/${s.id}`} className="font-medium hover:text-orange-500">
                        {s.name}
                      </Link>
                      <div className="text-xs text-muted">
                        {s.cellLine} · {s.modality}
                      </div>
                    </td>
                    <td>{s.library}</td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                    <td>
                      <StatusBadge status={s.qc} />
                    </td>
                    <td>{s.status === "complete" ? `${s.realHits} / ${s.hits}` : "-"}</td>
                    <td className="text-muted text-sm">{formatDate(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Calibration" subtitle="Predicted vs observed on logged outcomes">
          <CalibrationChart bins={calibrationBins} />
          <p className="mt-3 text-xs text-muted">
            Expected calibration error {formatPercent(overviewKpis.calibrationError)}. When SplicR says 80%, about
            8 in 10 validate.
          </p>
        </Card>
      </div>

      <div className="grid lg:grid-cols-[1fr_1fr_1fr] gap-4">
        <Card title="Validate these first" subtitle="Real and new · A375 ferroptosis">
          <ul className="divide-y divide-line">
            {topHits.map((h) => (
              <li key={h.gene} className="py-2.5 flex items-center justify-between gap-3">
                <div>
                  <div className="text-ink font-medium">{h.gene}</div>
                  <div className="text-xs text-muted truncate max-w-[220px]">{h.why}</div>
                </div>
                <Chance value={h.chance} size="sm" />
              </li>
            ))}
          </ul>
          <Link href="/dashboard/screens/scr_demo?tab=validation" className="mt-4 inline-flex items-center gap-1 text-sm text-orange-500">
            Build validation plan <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </Card>

        <Card title="Pipeline activity" subtitle="Latest run · A375 ferroptosis">
          <StageRail stages={stageRuns} compact />
          <ul className="mt-4 space-y-3">
            {stageRuns.slice(-4).reverse().map((s) => (
              <li key={s.key} className="text-sm">
                <div className="flex justify-between text-ink">
                  <span className="font-medium">{s.title}</span>
                  <span className="text-muted text-xs">{s.durationSec}s</span>
                </div>
                <div className="text-muted text-xs">{s.detail}</div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Recent outcomes" subtitle="Truth Loop">
          <ul className="divide-y divide-line">
            {outcomes.slice(0, 5).map((o) => (
              <li key={o.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                <div>
                  <div className="text-ink font-medium">{o.gene}</div>
                  <div className="text-xs text-muted">{o.assay}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted">predicted {Math.round(o.predicted * 100)}%</div>
                  <VerdictBadge verdict={o.result === "validated" ? "Real and new" : o.result === "failed" ? "Artifact" : "Uncertain"} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
