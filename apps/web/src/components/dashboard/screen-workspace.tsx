"use client";

import { ArrowUpRight, Download, FileText, Share2, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import {
  atlasSimilar,
  controlSeparation,
  demoHits,
  outcomes,
  replicateCorr,
  samples,
  stageRuns,
  type Hit,
  type Screen,
  type Verdict,
} from "@/lib/mock/data";
import { cn, formatDate, formatNumber, formatPercent } from "@/lib/utils";

import { DiscoveryMap, QcBars, RankChart, VolcanoChart } from "./charts";
import { Card, Chance, Flag, Kpi, StageRail, StatusBadge, Tabs, VerdictBadge, verdictColor } from "./ui";

const tabs = [
  { key: "overview", label: "Overview" },
  { key: "qc", label: "QC" },
  { key: "hits", label: "Hits" },
  { key: "map", label: "Discovery Map" },
  { key: "artifacts", label: "Artifacts" },
  { key: "atlas", label: "Atlas context" },
  { key: "validation", label: "Validation" },
  { key: "report", label: "Report" },
];

const verdicts: Verdict[] = ["Real and new", "Real and known", "Real but generic", "Artifact", "Uncertain"];

export function ScreenWorkspace({ screen, tab }: { screen: Screen; tab: string }) {
  const [selected, setSelected] = useState<Hit | null>(null);
  const hits = screen.id === "scr_demo" ? demoHits : demoHits.slice(0, Math.max(12, screen.hits % 120));
  const stages = useMemo(
    () =>
      stageRuns.map((s, i) => ({
        ...s,
        status:
          screen.status === "complete"
            ? ("done" as const)
            : i < screen.stage
              ? ("done" as const)
              : i === screen.stage && screen.status === "running"
                ? ("running" as const)
                : i === screen.stage && screen.status === "failed"
                  ? ("failed" as const)
                  : ("queued" as const),
      })),
    [screen],
  );
  const hrefFor = (k: string) => `/dashboard/screens/${screen.id}?tab=${k}`;
  const counts = Object.fromEntries(verdicts.map((v) => [v, hits.filter((h) => h.verdict === v).length])) as Record<Verdict, number>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Link href="/dashboard/screens" className="hover:text-ink">
              Screens
            </Link>
            <span>/</span>
            <span>{screen.id}</span>
          </div>
          <h1 className="mt-1 text-3xl md:text-4xl text-ink font-medium tracking-tight">{screen.name}</h1>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {[screen.cellLine, screen.organism, screen.modality, screen.library, screen.phenotype].map((c) => (
              <span key={c} className="chip bg-white border border-line">
                {c}
              </span>
            ))}
            <StatusBadge status={screen.status} />
            <StatusBadge status={screen.qc} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost btn-sm">
            <Share2 className="w-4 h-4" /> Share
          </button>
          <Link href={hrefFor("report")} className="btn btn-orange btn-sm">
            <FileText className="w-4 h-4" /> Hit Report
          </Link>
        </div>
      </div>

      <Card>
        <StageRail stages={stages} />
      </Card>

      <Tabs tabs={tabs.map((t) => ({ ...t, count: t.key === "hits" ? hits.length : undefined }))} active={tab} hrefFor={hrefFor} />

      {screen.status !== "complete" && tab !== "overview" && tab !== "qc" ? (
        <Card>
          <div className="text-ink font-medium">This stage has not run yet.</div>
          <p className="text-sm text-muted mt-1">
            {screen.status === "failed"
              ? "The run failed at QC. Fix the flagged sample or re-run with it excluded."
              : "Results appear here as soon as the pipeline reaches this stage."}
          </p>
        </Card>
      ) : null}

      {tab === "overview" && (
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi label="Candidate hits" value={hits.length} hint="FDR < 0.1" />
              <Kpi label="Likely real" value={hits.filter((h) => h.chance >= 0.6).length} hint="chance ≥ 60%" tone="orange" />
              <Kpi label="Real and new" value={counts["Real and new"]} hint="Validate first" tone="cyan" />
              <Kpi label="Artifacts" value={counts.Artifact} hint="Named with evidence" />
            </div>
            <Card title="Volcano" subtitle="Click a point to open the hit">
              <VolcanoChart hits={hits} onSelect={setSelected} />
              <Legend />
            </Card>
          </div>
          <div className="space-y-4">
            <Card title="Run log">
              <ul className="space-y-3">
                {stages.map((s) => (
                  <li key={s.key} className="text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-ink font-medium">{s.title}</span>
                      <span className="text-xs text-muted">{s.status === "done" ? `${s.durationSec}s` : s.status}</span>
                    </div>
                    {s.status === "done" && <div className="text-xs text-muted">{s.detail}</div>}
                    {s.tool && s.status === "done" && <div className="text-[11px] text-muted/80 font-mono">{s.tool}</div>}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}

      {tab === "qc" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Essential vs nonessential" value={controlSeparation.auroc.toFixed(2)} hint={`AUROC · Atlas median ${controlSeparation.atlasMedianAuroc}`} tone="cyan" />
            <Kpi label="NNMD" value={controlSeparation.nnmd} hint="≤ -1.25 passes" />
            <Kpi label="Bottlenecked samples" value={samples.filter((s) => s.verdict !== "pass").length} hint="RSL3 rep 2 lost 14% of guides" tone="orange" />
            <Kpi label="Mapped reads" value={formatPercent(samples.reduce((a, s) => a + s.mapped, 0) / samples.length)} hint="Mean across samples" />
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <QcBars samples={samples} metric="gini" label="Gini index of guide counts" threshold={0.3} />
            </Card>
            <Card>
              <QcBars samples={samples} metric="zeroGuides" label="Fraction of zero-count guides" threshold={0.05} format={(v) => `${(v * 100).toFixed(1)}%`} />
            </Card>
            <Card>
              <QcBars samples={samples} metric="skewRatio" label="90th / 10th percentile skew ratio" threshold={10} format={(v) => v.toFixed(1)} />
            </Card>
            <Card title="Replicate agreement" subtitle="Pearson r of log counts">
              <ul className="divide-y divide-line">
                {replicateCorr.map((c) => (
                  <li key={`${c.a}-${c.b}`} className="py-2.5 flex items-center justify-between text-sm">
                    <span className="text-ink">
                      {c.a} × {c.b}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="progress-track w-24">
                        <span className="progress-fill block" style={{ width: `${c.r * 100}%`, background: c.r < 0.85 ? "#f87315" : "#07b6d3" }} />
                      </span>
                      <span className="tabular-nums text-ink w-10 text-right">{c.r.toFixed(2)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Card title="Samples">
            <div className="overflow-x-auto thin-scroll">
              <table className="table-base min-w-[860px]">
                <thead>
                  <tr>
                    <th>Sample</th>
                    <th>Condition</th>
                    <th>Rep</th>
                    <th>Timepoint</th>
                    <th>Reads</th>
                    <th>Mapped</th>
                    <th>Zero guides</th>
                    <th>Gini</th>
                    <th>Skew</th>
                    <th>Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {samples.map((s) => (
                    <tr key={s.id}>
                      <td className="font-medium">{s.label}</td>
                      <td>{s.condition}</td>
                      <td>{s.replicate}</td>
                      <td>{s.timepoint}</td>
                      <td className="tabular-nums">{formatNumber(s.reads)}</td>
                      <td>{formatPercent(s.mapped)}</td>
                      <td>{formatPercent(s.zeroGuides, 1)}</td>
                      <td>{s.gini.toFixed(2)}</td>
                      <td>{s.skewRatio.toFixed(1)}</td>
                      <td>
                        <StatusBadge status={s.verdict} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === "hits" && screen.status === "complete" && <HitsTable hits={hits} onSelect={setSelected} />}

      {tab === "map" && screen.status === "complete" && (
        <div className="grid lg:grid-cols-[1.5fr_1fr] gap-4">
          <Card title="Discovery Map" subtitle="Real on one axis, new on the other">
            <DiscoveryMap hits={hits} onSelect={setSelected} />
            <Legend />
          </Card>
          <div className="space-y-3">
            {[
              ["Real and new", "Your paper. Validate these first.", "bg-orange-500 text-teal-950"],
              ["Fake and new", "The trap. Exciting, and where most wasted months go.", "bg-teal-800 text-white"],
              ["Real and known", "Good positive controls. Not a paper.", "bg-mist-soft text-ink"],
              ["Fake and known", "Ignore.", "bg-mist-soft text-ink"],
            ].map(([t, b, c]) => (
              <div key={t} className={cn("rounded-2xl p-5", c)}>
                <div className="font-medium">{t}</div>
                <div className={cn("text-sm mt-1", c.includes("text-white") ? "text-white/90" : "text-body")}>{b}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "artifacts" && screen.status === "complete" && <ArtifactsPanel hits={hits} onSelect={setSelected} />}

      {tab === "atlas" && screen.status === "complete" && (
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
          <Card title="Similar screens" subtitle="Learned similarity over metadata and hit profile">
            <ul className="divide-y divide-line">
              {atlasSimilar.map((a) => (
                <li key={a.id} className="py-3 flex items-start justify-between gap-4">
                  <div>
                    <div className="text-ink font-medium">{a.title}</div>
                    <div className="text-xs text-muted mt-0.5">
                      {a.id} · {a.source} · {a.cellLine} · {a.library} · {a.phenotype} · {a.year}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-ink font-medium tabular-nums">{Math.round(a.similarity * 100)}%</div>
                    <div className="text-xs text-muted">{a.sharedHits} shared hits</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="What the Atlas adds" subtitle="Per hit">
            <ul className="space-y-3 text-sm text-body">
              <li>History: how often this gene hit across {formatNumber(atlasSimilar.length ? 2217 : 0)} public screens, and in which contexts.</li>
              <li>Novelty: how far this hit is from every published screen in this context.</li>
              <li>Generic-ness: hits that appear in a large fraction of unrelated screens are flagged as frequent hitters.</li>
              <li>Outcome record: whether this gene validated, failed or replicated when other labs re-tested it.</li>
            </ul>
            <RankChart hits={hits} height={180} />
          </Card>
        </div>
      )}

      {tab === "validation" && screen.status === "complete" && <ValidationPanel hits={hits} screenId={screen.id} />}

      {tab === "report" && screen.status === "complete" && (
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
          <Card title="Hit Report v1" subtitle={`Built ${formatDate(stageRuns[8].startedAt ?? new Date().toISOString())}`}>
            <div className="rounded-2xl bg-mist-soft p-6">
              <div className="eyebrow">Hit Report</div>
              <h3 className="mt-2 text-2xl text-ink font-medium">{screen.name}</h3>
              <p className="mt-3 text-sm text-body max-w-xl">
                {hits.length} candidate hits at FDR 0.1. {hits.filter((h) => h.chance >= 0.6).length} are likely real, of which{" "}
                {counts["Real and new"]} are new in this context. {counts.Artifact} hits are artifacts, each named with evidence. Replicate 2 of the
                RSL3 arm was bottlenecked and down-weighted.
              </p>
              <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                {verdicts.slice(0, 4).map((v) => (
                  <div key={v} className="rounded-xl bg-white p-3">
                    <div className="text-xs text-muted">{v}</div>
                    <div className="text-xl text-ink font-medium">{counts[v]}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn btn-orange btn-sm">
                <Download className="w-4 h-4" /> PDF
              </button>
              <button className="btn btn-ghost btn-sm">
                <Download className="w-4 h-4" /> CSV
              </button>
              <button className="btn btn-ghost btn-sm">
                <Download className="w-4 h-4" /> JSON
              </button>
              <button className="btn btn-ghost btn-sm">
                <Share2 className="w-4 h-4" /> Share link
              </button>
            </div>
          </Card>
          <Card title="Methods, auto-written">
            <p className="text-sm text-body leading-relaxed">
              Reads were counted with MAGeCK 0.5.9.5 (exact match, 1-mismatch fallback) against Brunello (76,441 guides).
              Gene-level statistics were computed with MAGeCK RRA and MLE, BAGEL2 (CEGv2 and NEGv1 reference sets) and
              CRISPRcleanR copy-number correction. Artifacts were flagged by positional clustering, guide concordance and
              off-target counts. Confidence scores were produced by SplicR score v0.3, calibrated on logged validation
              outcomes, with Atlas context from BioGRID ORCS and DepMap 24Q4.
            </p>
            <p className="mt-3 text-xs text-muted">Versions and parameters are recorded on the run and exported with the report.</p>
          </Card>
        </div>
      )}

      {selected && <HitDrawer hit={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
      {verdicts.map((v) => (
        <span key={v} className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: verdictColor[v] }} /> {v}
        </span>
      ))}
    </div>
  );
}

function HitsTable({ hits, onSelect }: { hits: Hit[]; onSelect: (h: Hit) => void }) {
  const [verdict, setVerdict] = useState<"all" | Verdict>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"rank" | "chance" | "novelty">("chance");
  const rows = useMemo(() => {
    const filtered = hits.filter((h) => (verdict === "all" || h.verdict === verdict) && (q === "" || h.gene.toLowerCase().includes(q.toLowerCase())));
    return [...filtered].sort((a, b) => (sort === "rank" ? a.rank - b.rank : sort === "chance" ? b.chance - a.chance : b.novelty - a.novelty));
  }, [hits, verdict, q, sort]);

  return (
    <Card>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a gene"
          className="rounded-full border border-line px-4 py-2 text-sm w-full md:w-64 outline-none focus:border-cyan-500"
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button onClick={() => setVerdict("all")} className={cn("chip", verdict === "all" && "bg-teal-800 text-white")}>
            All
          </button>
          {verdicts.map((v) => (
            <button key={v} onClick={() => setVerdict(v)} className={cn("chip", verdict === v && "bg-teal-800 text-white")}>
              <span className="w-2 h-2 rounded-full" style={{ background: verdictColor[v] }} /> {v}
            </button>
          ))}
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="ml-2 rounded-full border border-line px-3 py-1.5 bg-white text-ink">
            <option value="chance">Sort: chance real</option>
            <option value="novelty">Sort: novelty</option>
            <option value="rank">Sort: statistical rank</option>
          </select>
        </div>
      </div>
      <div className="overflow-x-auto thin-scroll">
        <table className="table-base min-w-[1000px]">
          <thead>
            <tr>
              <th>#</th>
              <th>Gene</th>
              <th>Chance real</th>
              <th>Verdict</th>
              <th>LFC</th>
              <th>FDR</th>
              <th>BF</th>
              <th>Guides agree</th>
              <th>Novelty</th>
              <th>Flags</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 80).map((h) => (
              <tr key={h.gene} className="hover:bg-mist-soft/60 cursor-pointer" onClick={() => onSelect(h)}>
                <td className="text-muted text-xs">{h.rank}</td>
                <td className="font-medium">{h.gene}</td>
                <td>
                  <Chance value={h.chance} size="sm" />
                </td>
                <td>
                  <VerdictBadge verdict={h.verdict} />
                </td>
                <td className="tabular-nums">{h.lfc.toFixed(2)}</td>
                <td className="tabular-nums">{h.fdr < 0.001 ? h.fdr.toExponential(1) : h.fdr.toFixed(3)}</td>
                <td className="tabular-nums">{h.bayesFactor.toFixed(1)}</td>
                <td>
                  {h.guidesAgree}/{h.guides}
                </td>
                <td>{Math.round(h.novelty * 100)}%</td>
                <td>
                  <div className="flex gap-1 flex-wrap">
                    {h.flags.map((f) => (
                      <Flag key={f} label={f} />
                    ))}
                  </div>
                </td>
                <td className="text-xs text-body max-w-[260px]">{h.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 80 && <div className="mt-3 text-xs text-muted">Showing 80 of {rows.length}. Export CSV for the full table.</div>}
    </Card>
  );
}

function ArtifactsPanel({ hits, onSelect }: { hits: Hit[]; onSelect: (h: Hit) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, Hit[]>();
    hits.forEach((h) => h.flags.forEach((f) => m.set(f, [...(m.get(f) ?? []), h])));
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [hits]);
  const evidence: Record<string, string> = {
    "Copy-number cluster": "Neighboring genes in the same amplified segment drop out together. Detected by positional clustering of depletion along the chromosome and confirmed against DepMap copy number for this cell line.",
    "One guide drives signal": "A single guide accounts for most of the gene-level effect while the others are flat. Usually an off-target or a toxic guide.",
    "Promiscuous guide": "The guide has many perfect or near-perfect genomic matches. Its signal cannot be attributed to the annotated gene.",
    "Frequent hitter": "This gene hits in a large fraction of unrelated screens in the Atlas. Real, but not specific to your condition.",
    "Low guide coverage": "Guides for this gene had too few reads at the endpoint for the statistic to be reliable.",
    "Bottlenecked replicate": "Most of the signal comes from a replicate that lost a large share of guides; down-weighted in the score.",
  };
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {groups.map(([flag, list]) => (
        <Card key={flag} title={flag} subtitle={`${list.length} hits`}>
          <p className="text-sm text-body">{evidence[flag]}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {list.slice(0, 14).map((h) => (
              <button key={h.gene} onClick={() => onSelect(h)} className="chip bg-mist-soft hover:bg-teal-800 hover:text-white text-xs">
                {h.gene} · {Math.round(h.chance * 100)}%
              </button>
            ))}
            {list.length > 14 && <span className="chip text-xs">+{list.length - 14} more</span>}
          </div>
        </Card>
      ))}
    </div>
  );
}

function ValidationPanel({ hits, screenId }: { hits: Hit[]; screenId: string }) {
  const plan = hits.filter((h) => h.verdict === "Real and new").slice(0, 12);
  const logged = outcomes.filter((o) => o.screenId === screenId);
  const [local, setLocal] = useState<Record<string, "validated" | "failed" | "inconclusive">>({});
  const wells = Array.from({ length: 96 }, (_, i) => i);

  return (
    <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
      <Card
        title="Validation plan"
        subtitle="Top 12 real-and-new hits, two fresh guides each"
        action={
          <button className="btn btn-orange btn-sm">
            <Download className="w-4 h-4" /> Order file
          </button>
        }
      >
        <div className="overflow-x-auto thin-scroll">
          <table className="table-base min-w-[640px]">
            <thead>
              <tr>
                <th>Gene</th>
                <th>Chance</th>
                <th>Guides</th>
                <th>Assay</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {plan.map((h, i) => {
                const existing = logged.find((o) => o.gene === h.gene)?.result;
                const value = local[h.gene] ?? existing;
                return (
                  <tr key={h.gene}>
                    <td className="font-medium">{h.gene}</td>
                    <td>
                      <Chance value={h.chance} size="sm" />
                    </td>
                    <td className="font-mono text-xs text-muted">
                      v{i + 1}a · v{i + 1}b
                    </td>
                    <td className="text-sm">Arrayed KO, RSL3 viability</td>
                    <td>
                      <div className="flex gap-1">
                        {(["validated", "failed", "inconclusive"] as const).map((r) => (
                          <button
                            key={r}
                            onClick={() => setLocal((s) => ({ ...s, [h.gene]: r }))}
                            className={cn(
                              "rounded-full px-2.5 py-1 text-[11px] capitalize border",
                              value === r
                                ? r === "validated"
                                  ? "bg-cyan-500 text-teal-950 border-cyan-500"
                                  : r === "failed"
                                    ? "bg-teal-800 text-white border-teal-800"
                                    : "bg-orange-500 text-teal-950 border-orange-500"
                                : "border-line text-muted hover:border-line-strong",
                            )}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">Every logged outcome retrains the score. Pharma outcomes stay private to their organization.</p>
      </Card>
      <Card title="Plate map" subtitle="96-well · duplicates · controls in column 12">
        <div className="grid grid-cols-12 gap-1">
          {wells.map((w) => {
            const col = w % 12;
            const row = Math.floor(w / 12);
            const idx = row * 6 + Math.floor(col / 2);
            const isControl = col === 11 || col === 10;
            const filled = !isControl && idx < plan.length;
            return (
              <div
                key={w}
                title={filled ? plan[idx].gene : isControl ? "control" : "empty"}
                className={cn(
                  "aspect-square rounded-full text-[8px] flex items-center justify-center",
                  filled ? "bg-orange-500 text-teal-950" : isControl ? "bg-teal-800 text-white" : "bg-mist-soft text-muted",
                )}
              >
                {filled ? plan[idx].gene.slice(0, 3) : isControl ? "C" : ""}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500" /> hit
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-teal-800" /> control
          </span>
        </div>
      </Card>
    </div>
  );
}

function HitDrawer({ hit, onClose }: { hit: Hit; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-teal-950/40" onClick={onClose} />
      <aside className="relative w-full max-w-md bg-white h-full overflow-y-auto thin-scroll p-6 md:p-8 shadow-float">
        <div className="flex items-start justify-between">
          <div>
            <div className="eyebrow">Hit</div>
            <h2 className="mt-1 text-3xl text-ink font-medium">{hit.gene}</h2>
          </div>
          <button onClick={onClose} className="icon-btn" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-6 flex items-center justify-between">
          <Chance value={hit.chance} />
          <VerdictBadge verdict={hit.verdict} />
        </div>
        <p className="mt-4 text-body">{hit.why}</p>

        <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
          {[
            ["log2 fold change", hit.lfc.toFixed(2)],
            ["FDR", hit.fdr < 0.001 ? hit.fdr.toExponential(1) : hit.fdr.toFixed(3)],
            ["Bayes factor", hit.bayesFactor.toFixed(1)],
            ["Guides agreeing", `${hit.guidesAgree} of ${hit.guides}`],
            ["Novelty", `${Math.round(hit.novelty * 100)}%`],
            ["Statistical rank", `#${hit.rank}`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-mist-soft p-3">
              <div className="text-xs text-muted">{k}</div>
              <div className="text-ink font-medium">{v}</div>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <div className="text-sm text-ink font-medium">Atlas history</div>
          <p className="text-sm text-body mt-1">
            Hit in {hit.atlasHits} of {formatNumber(hit.atlasScreens)} comparable public screens
            {hit.verdict === "Real but generic" ? " (a frequent hitter)" : ""}.
          </p>
          <ul className="mt-3 space-y-2">
            {atlasSimilar.slice(0, 3).map((a) => (
              <li key={a.id} className="text-xs text-muted flex justify-between gap-3">
                <span className="truncate">
                  {a.id} · {a.cellLine} · {a.phenotype}
                </span>
                <span className="text-ink shrink-0">{hit.chance > 0.5 ? "hit" : "not a hit"}</span>
              </li>
            ))}
          </ul>
        </div>

        {hit.flags.length > 0 && (
          <div className="mt-6">
            <div className="text-sm text-ink font-medium">Flags</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {hit.flags.map((f) => (
                <Flag key={f} label={f} />
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-wrap gap-2">
          <button className="btn btn-orange btn-sm">Add to validation plan</button>
          <a href={`https://orcs.thebiogrid.org/Gene/${hit.gene}`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
            ORCS <ArrowUpRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </aside>
    </div>
  );
}
