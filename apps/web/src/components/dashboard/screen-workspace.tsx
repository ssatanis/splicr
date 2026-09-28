"use client";

import { ArrowUpRight, Download, FileText, Link2, Share2 } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useId, useMemo, useState } from "react";

import {
  atlasSimilarFor,
  benchQueue,
  benchSettled,
  BOTTLENECK_WEIGHT,
  controlSeparation,
  FDR_THRESHOLD,
  LIKELY_REAL_THRESHOLD,
  QC_SCREEN_ID,
  replicateCorr,
  samples,
  stagesForScreen,
  testsForScreen,
  type Direction,
  type Hit,
  type Screen,
  type Verdict,
} from "@/lib/mock/data";
import { buildReport, excelAmbiguousSymbols, hitsForScreen, VERDICT_ORDER } from "@/lib/report/document";
import { cn, formatDate, formatNumber, formatPercent } from "@/lib/utils";

import { DiscoveryMap, QcBars, RankChart, VolcanoChart } from "./charts";
import { ModalDrawer } from "./drawer";
import { OUTCOME_RESULT } from "./outcome-badge";
import { ROW, ROW_TARGET } from "./overview-tables";
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

/** How many wells a 96-well plate has, and how many the plan is allowed to fill. */
const PLATE_WELLS = 96;
/** Zero-indexed columns 10 and 11, which a bench scientist calls 11 and 12. */
const CONTROL_COLUMNS = [10, 11];
const PLAN_SIZE = 12;

export function ScreenWorkspace({ screen, tab }: { screen: Screen; tab: string }) {
  const [selected, setSelected] = useState<Hit | null>(null);
  // Shared with the report builder so a downloaded table cannot disagree with
  // what this page shows. Null, not empty, when hit calling has not run: a tab
  // badge of 12 on a screen that has called nothing is how this console used to
  // contradict its own screens table two clicks away.
  const hits = hitsForScreen(screen);
  const stages = useMemo(() => stagesForScreen(screen), [screen]);
  const hrefFor = (k: string) => `/dashboard/screens/${screen.id}?tab=${k}`;
  const counts = useMemo(
    () =>
      Object.fromEntries(verdicts.map((v) => [v, (hits ?? []).filter((h) => h.verdict === v).length])) as Record<
        Verdict,
        number
      >,
    [hits],
  );
  const hasQc = screen.id === QC_SCREEN_ID;

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
          <ShareButton />
          <Link href={hrefFor("report")} className="btn btn-orange btn-sm">
            <FileText className="w-4 h-4" aria-hidden="true" /> Hit Report
          </Link>
        </div>
      </div>

      <Card>
        <StageRail stages={stages} />
      </Card>

      <Tabs
        tabs={tabs.map((t) => ({ ...t, count: t.key === "hits" && hits !== null ? hits.length : undefined }))}
        active={tab}
        hrefFor={hrefFor}
      />

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
            {hits === null ? (
              <Card>
                <div className="text-ink font-medium">No hits have been called on this screen.</div>
                <p className="text-sm text-muted mt-1">
                  Hit calling is stage 5 of 9 and this run has finished {screen.stage}. There is no candidate table,
                  which is not the same as a table with nothing in it, so no count is shown here.
                </p>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Kpi
                    label="Candidate hits"
                    value={hits.length}
                    hint={`BH FDR < ${FDR_THRESHOLD.toFixed(2)} over ${formatNumber(testsForScreen(screen))} tests`}
                  />
                  <Kpi
                    label="Likely real"
                    value={screen.realHits}
                    hint={`demo score ≥ ${LIKELY_REAL_THRESHOLD.toFixed(2)}`}
                    tone="orange"
                  />
                  <Kpi label="Real and new" value={counts["Real and new"]} hint="Validate first" tone="cyan" />
                  <Kpi label="Artifacts" value={counts.Artifact} hint="Named with evidence" />
                </div>
                <Card title="Volcano" subtitle="Select a point to open the hit. Depleted left, enriched right.">
                  <VolcanoChart hits={hits} onSelect={setSelected} />
                  <Legend />
                </Card>
              </>
            )}
          </div>
          <div className="space-y-4">
            <Card title="Run log" subtitle="This screen's own stage record">
              <ul className="space-y-3">
                {stages.map((s) => (
                  <li key={s.key} className="text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-ink font-medium">{s.title}</span>
                      <span className="text-xs text-muted">{s.status === "done" ? `${s.durationSec}s` : s.status}</span>
                    </div>
                    {s.status === "done" && s.detail && <div className="text-xs text-muted">{s.detail}</div>}
                    {s.tool && s.status === "done" && <div className="text-[11px] text-muted/80 font-mono">{s.tool}</div>}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}

      {tab === "qc" &&
        (hasQc ? (
          <QcPanel hits={hits ?? []} />
        ) : (
          <Card>
            <div className="text-ink font-medium">No per-sample QC is recorded for this screen.</div>
            <p className="text-sm text-muted mt-1">
              The sample dataset carries distribution metrics, replicate correlations and control separation for the
              A375 ferroptosis run only. This screen carries an overall verdict of &quot;{screen.qc}&quot; and nothing
              below it, so nothing below it is shown. Treat its hit table as unverified until sample-level metrics are
              attached.
            </p>
          </Card>
        ))}

      {tab === "hits" && screen.status === "complete" && hits !== null && (
        <HitsTable hits={hits} onSelect={setSelected} />
      )}

      {tab === "map" && screen.status === "complete" && hits !== null && (
        <div className="grid lg:grid-cols-[1.5fr_1fr] gap-4">
          <Card title="Discovery Map" subtitle="Real on one axis, new on the other">
            <DiscoveryMap hits={hits} onSelect={setSelected} />
            <Legend />
          </Card>
          <div className="space-y-3">
            {[
              ["Real and new", "Your paper. Validate these first.", "bg-orange-500 text-white"],
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

      {tab === "artifacts" && screen.status === "complete" && hits !== null && (
        <ArtifactsPanel hits={hits} onSelect={setSelected} />
      )}

      {tab === "atlas" && screen.status === "complete" && hits !== null && (
        <AtlasPanel screen={screen} hits={hits} />
      )}

      {tab === "validation" && screen.status === "complete" && hits !== null && <ValidationPanel screen={screen} />}

      {tab === "report" && screen.status === "complete" && <ReportPanel screen={screen} />}

      {selected && <HitDrawer hit={selected} screen={screen} onClose={() => setSelected(null)} />}
    </div>
  );
}

/**
 * Share used to be a button with no handler on the primary header of the primary
 * page. It copies the address now, which is the thing it was miming.
 */
function ShareButton() {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(window.location.href);
            setState("copied");
          } catch {
            setState("failed");
          }
        }}
      >
        <Share2 className="w-4 h-4" aria-hidden="true" /> Share
      </button>
      <span aria-live="polite" className="text-[11px] text-muted">
        {state === "copied" ? "Link copied." : state === "failed" ? "The clipboard was blocked." : ""}
      </span>
    </span>
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

// ---------------------------------------------------------------------------
// QC
// ---------------------------------------------------------------------------

function QcPanel({ hits }: { hits: Hit[] }) {
  const flaggedSamples = samples.filter((s) => s.verdict !== "pass");
  const worst = flaggedSamples[0];
  const movedHits = hits.filter((h) => h.flags.includes("Bottlenecked replicate"));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Essential vs nonessential"
          value={controlSeparation.auroc.toFixed(2)}
          hint={`AUROC · Atlas median ${controlSeparation.atlasMedianAuroc}`}
          tone="cyan"
        />
        <Kpi label="NNMD" value={controlSeparation.nnmd} hint="≤ -1.25 passes" />
        <Kpi
          label="Samples over a ceiling"
          value={flaggedSamples.length}
          hint={worst ? `${worst.label} breached three of three` : "None"}
          tone="orange"
        />
        <Kpi
          label="Mapped reads"
          value={formatPercent(samples.reduce((a, s) => a + s.mapped, 0) / samples.length)}
          hint="Mean across samples"
        />
      </div>

      {worst && (
        <Card title="What the bottleneck did to the numbers" subtitle="Stated, because a policy without a weight is not a policy">
          <p className="text-sm text-body leading-relaxed">
            {worst.label} breached all three distribution ceilings printed in this report&apos;s parameters: Gini{" "}
            {worst.gini.toFixed(2)} against 0.30, {formatPercent(worst.zeroGuides, 1)} of guides at zero against 5%, and
            a skew ratio of {worst.skewRatio.toFixed(1)} against 10. Its pairwise replicate correlation is{" "}
            {replicateCorr.find((c) => c.a.startsWith("RSL3"))?.r.toFixed(2) ?? "not recorded"}. That is a failed
            sample, which is why this run carries a QC warning rather than a pass.
          </p>
          <p className="mt-3 text-sm text-body leading-relaxed">
            It was down-weighted to {BOTTLENECK_WEIGHT.toFixed(2)} at the scoring stage rather than dropped, so it still
            contributes about a third of a clean replicate.{" "}
            {movedHits.length === 0
              ? "No candidate has its signal concentrated in it, so no hit moved."
              : `${movedHits.length} candidates have their signal concentrated in it. Each one carries the Bottlenecked replicate flag, and each one lost score for it:`}
          </p>
          {movedHits.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {movedHits.map((h) => (
                <li key={h.gene} className="chip bg-mist-soft text-xs">
                  {h.gene} · {h.chance.toFixed(3)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <QcBars samples={samples} metric="gini" label="Gini index of guide counts" threshold={0.3} />
        </Card>
        <Card>
          <QcBars
            samples={samples}
            metric="zeroGuides"
            label="Fraction of zero-count guides"
            threshold={0.05}
            format={(v) => `${(v * 100).toFixed(1)}%`}
          />
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
                <th scope="col">Sample</th>
                <th scope="col">Condition</th>
                <th scope="col">Rep</th>
                <th scope="col">Timepoint</th>
                <th scope="col">Reads</th>
                <th scope="col">Mapped</th>
                <th scope="col">Zero guides</th>
                <th scope="col">Gini</th>
                <th scope="col">Skew</th>
                <th scope="col">Verdict</th>
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
  );
}

// ---------------------------------------------------------------------------
// Hits
// ---------------------------------------------------------------------------

const DIRECTIONS: ("all" | Direction)[] = ["all", "depleted", "enriched"];

/**
 * The hit table.
 *
 * Every row is reachable from the keyboard. It used to be a `<tr onClick>` with
 * a pointer cursor, no tabIndex, no role and no key handler, so the console's
 * primary action was mouse-only for all eighty rendered rows. The gene cell is
 * the control now and its hit area is stretched over the row, which is the
 * pattern the overview tables already used.
 */
function HitsTable({ hits, onSelect }: { hits: Hit[]; onSelect: (h: Hit) => void }) {
  const [verdict, setVerdict] = useState<"all" | Verdict>("all");
  const [direction, setDirection] = useState<"all" | Direction>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"rank" | "chance" | "novelty">("chance");
  const searchId = useId();
  const sortId = useId();
  const directionId = useId();

  const rows = useMemo(() => {
    const filtered = hits.filter(
      (h) =>
        (verdict === "all" || h.verdict === verdict) &&
        (direction === "all" || h.direction === direction) &&
        (q === "" || h.gene.toLowerCase().includes(q.toLowerCase())),
    );
    return [...filtered].sort((a, b) => (sort === "rank" ? a.rank - b.rank : sort === "chance" ? b.chance - a.chance : b.novelty - a.novelty));
  }, [hits, verdict, direction, q, sort]);

  const enriched = hits.filter((h) => h.direction === "enriched").length;

  return (
    <Card>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-4">
        <div>
          <label htmlFor={searchId} className="block text-xs uppercase tracking-[0.06em] text-muted">
            Find a gene
          </label>
          <input
            id={searchId}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Gene symbol"
            className="mt-1.5 rounded-full border border-line px-4 py-2 text-sm w-full md:w-64 outline-none focus:border-cyan-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* aria-pressed, because these are toggles and a screen reader has no
              other way to hear which one is currently on. */}
          <button
            type="button"
            onClick={() => setVerdict("all")}
            aria-pressed={verdict === "all"}
            className={cn("chip", verdict === "all" && "bg-teal-800 text-white")}
          >
            All
          </button>
          {verdicts.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVerdict(v)}
              aria-pressed={verdict === v}
              className={cn("chip", verdict === v && "bg-teal-800 text-white")}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: verdictColor[v] }} aria-hidden="true" /> {v}
            </button>
          ))}
          <label htmlFor={directionId} className="sr-only">
            Filter by selection arm
          </label>
          <select
            id={directionId}
            value={direction}
            onChange={(e) => setDirection(e.target.value as typeof direction)}
            className="ml-2 rounded-full border border-line px-3 py-1.5 bg-white text-ink"
          >
            {DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {d === "all" ? "Both arms" : d === "depleted" ? "Depleted only" : "Enriched only"}
              </option>
            ))}
          </select>
          <label htmlFor={sortId} className="sr-only">
            Sort the hit table
          </label>
          <select
            id={sortId}
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="rounded-full border border-line px-3 py-1.5 bg-white text-ink"
          >
            <option value="chance">Sort: demo score</option>
            <option value="novelty">Sort: novelty</option>
            <option value="rank">Sort: statistical rank</option>
          </select>
        </div>
      </div>
      <div className="overflow-x-auto thin-scroll">
        <table className="table-base min-w-[1060px]">
          <caption className="sr-only">
            Candidate hits. Select a gene to open its evidence.
          </caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Gene</th>
              <th scope="col">Demo score</th>
              <th scope="col">Verdict</th>
              <th scope="col">Arm</th>
              <th scope="col">LFC</th>
              <th scope="col">FDR</th>
              <th scope="col">BF</th>
              <th scope="col">Guides agree</th>
              <th scope="col">Novelty</th>
              <th scope="col">Flags</th>
              <th scope="col">Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 80).map((h) => (
              <tr key={h.gene} className={ROW}>
                <td className="text-muted text-xs">{h.rank}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => onSelect(h)}
                    aria-haspopup="dialog"
                    className={cn("font-medium text-ink hover:text-orange-500", ROW_TARGET)}
                  >
                    {h.gene}
                    <span className="sr-only">, open the evidence for this hit</span>
                  </button>
                </td>
                <td>
                  <Chance value={h.chance} size="sm" />
                </td>
                <td>
                  <VerdictBadge verdict={h.verdict} />
                </td>
                <td className="text-xs">{h.direction}</td>
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
                <td className="text-xs text-body max-w-[280px]">{h.why}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={12} className="py-10 text-center text-muted">
                  No candidate matches this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p aria-live="polite" className="mt-3 text-xs text-muted">
        Showing {Math.min(80, rows.length)} of {formatNumber(rows.length)} matching rows, out of{" "}
        {formatNumber(hits.length)} candidates. {enriched === 0 ? "None came out of the enriched arm." : `${enriched} came out of the enriched arm.`}{" "}
        Export CSV for the full table.
      </p>
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
    "Frequent hitter": "This gene is called in more than a quarter of the Atlas screens that assayed it. Real, but not specific to your condition.",
    "Low guide coverage": "Guides for this gene had too few reads at the endpoint for the statistic to be reliable.",
    "Bottlenecked replicate": "Most of the signal comes from a replicate that lost a large share of guides; down-weighted in the score.",
  };
  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-body">
          In this illustrative dataset, flags reduce a heuristic score. These scores are not calibrated probabilities. A flagged candidate scores below an otherwise identical
          clean candidate carrying the same statistics. The flag is still printed next to the statistic that raised it
          rather than folded into it, so you can disagree with the call.
        </p>
      </Card>
      <div className="grid md:grid-cols-2 gap-4">
        {groups.map(([flag, list]) => (
          <Card key={flag} title={flag} subtitle={`${list.length} hits`}>
            <p className="text-sm text-body">{evidence[flag]}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {list.slice(0, 14).map((h) => (
                <button
                  key={h.gene}
                  type="button"
                  onClick={() => onSelect(h)}
                  aria-haspopup="dialog"
                  className="chip bg-mist-soft hover:bg-teal-800 hover:text-white text-xs"
                >
                  {h.gene} · {h.chance.toFixed(3)}
                </button>
              ))}
              {list.length > 14 && <span className="chip text-xs">+{list.length - 14} more</span>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Atlas context
// ---------------------------------------------------------------------------

function AtlasPanel({ screen, hits }: { screen: Screen; hits: Hit[] }) {
  const similar = atlasSimilarFor(screen);
  const denominators = hits.map((h) => h.atlasScreens);
  const low = Math.min(...denominators);
  const high = Math.max(...denominators);

  return (
    <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
      <Card
        title="Similar screens"
        subtitle={`Public screens in the Atlas matching ${screen.organism} and ${screen.modality}, illustrative similarity ordering`}
      >
        {similar.length === 0 ? (
          <p className="text-sm text-muted">
            No public screen in the Atlas matches this organism and modality, so no comparison is offered.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {similar.map((a) => (
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
        )}
      </Card>
      <Card title="What the Atlas adds" subtitle="Per hit">
        <ul className="space-y-3 text-sm text-body">
          <li>
            History: how often this gene was called in the Atlas screens that assayed it. That denominator is per gene,
            because no library contains every gene: on this screen it runs from {formatNumber(low)} to{" "}
            {formatNumber(high)}. It is not the size of the corpus.
          </li>
          <li>Novelty: how far this hit is from every published screen in this context.</li>
          <li>Generic-ness: a gene called in more than a quarter of the screens that assayed it is flagged as a frequent hitter.</li>
          <li>Outcome record: whether this gene validated or failed when another lab re-tested it, where such a record exists.</li>
        </ul>
        <RankChart hits={hits} height={180} />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function planCsv(screen: Screen, plan: Hit[]): string {
  const header = [
    "# SplicR validation plan. SAMPLE DATA, not a measurement of any real screen.",
    `# screen: ${screen.id} · ${screen.name}`,
    `# assay: ${screen.benchAssay}`,
    `# ranked by illustrative model score, artifacts and genes already answered at the bench removed`,
    "# guide sequences are not in this file: the sample dataset carries no guide table, so none is invented here",
    "screen_id,gene_symbol,chance_real,verdict,log2_fold_change,direction,guides_agreeing,guides_in_library,assay",
  ];
  const rows = plan.map((h) =>
    [
      screen.id,
      h.gene,
      h.chance.toFixed(2),
      `"${h.verdict}"`,
      h.lfc.toFixed(2),
      h.direction,
      h.guidesAgree,
      h.guides,
      `"${screen.benchAssay}"`,
    ].join(","),
  );
  return `${[...header, ...rows].join("\r\n")}\r\n`;
}

function ValidationPanel({ screen }: { screen: Screen }) {
  // One ranking, shared with the overview's "Validate next", so the two lists
  // nest instead of recommending disjoint sets of genes.
  const queue = useMemo(() => benchQueue(screen.id), [screen.id]);
  const settled = useMemo(() => benchSettled(screen.id), [screen.id]);
  const plan = queue.slice(0, PLAN_SIZE);
  const [local, setLocal] = useState<Record<string, "validated" | "failed" | "inconclusive">>({});
  const wells = Array.from({ length: PLATE_WELLS }, (_, i) => i);

  const download = useCallback(() => {
    const blob = new Blob([planCsv(screen, plan)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `splicr-validation-plan_${screen.id}_SAMPLE.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [screen, plan]);

  return (
    <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
      <div className="space-y-4">
        <Card
          title="Validation plan"
          subtitle={`The top ${plan.length} by illustrative model score, of ${queue.length} candidates not yet answered at the bench`}
          action={
            <button type="button" onClick={download} className="btn btn-orange btn-sm">
              <Download className="w-4 h-4" aria-hidden="true" /> Order file
            </button>
          }
        >
          <div className="overflow-x-auto thin-scroll">
            <table className="table-base min-w-[820px]">
              <caption className="sr-only">
                Genes to re-test on this screen, ranked by illustrative model score. The guide counts are in the order
                file.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Gene</th>
                  <th scope="col">Demo score</th>
                  <th scope="col">Call</th>
                  <th scope="col">Arm</th>
                  <th scope="col">Flags</th>
                  <th scope="col">Assay</th>
                  <th scope="col">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((h) => {
                  const value = local[h.gene];
                  return (
                    <tr key={h.gene}>
                      <td className="font-medium">{h.gene}</td>
                      <td>
                        <Chance value={h.chance} size="sm" />
                      </td>
                      {/* The call and the flags travel with the row. The plan
                          ranks on the score, and the score is already net of the
                          flags, but a frequent hitter or a promiscuous guide near
                          the top is something a reader has to be able to see
                          before they order the plate. */}
                      <td>
                        <VerdictBadge verdict={h.verdict} />
                      </td>
                      <td className="text-xs">{h.direction}</td>
                      <td>
                        {h.flags.length === 0 ? (
                          <span className="text-xs text-muted">None</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {h.flags.map((f) => (
                              <Flag key={f} label={f} />
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="text-sm">{screen.benchAssay}</td>
                      <td>
                        <div className="flex gap-1" role="group" aria-label={`Bench outcome for ${h.gene}`}>
                          {(["validated", "failed", "inconclusive"] as const).map((r) => (
                            <button
                              key={r}
                              type="button"
                              aria-pressed={value === r}
                              onClick={() => setLocal((s) => ({ ...s, [h.gene]: r }))}
                              className={cn(
                                "rounded-full px-2.5 py-1 text-[11px] capitalize border",
                                value === r
                                  ? r === "validated"
                                    ? "bg-cyan-500 text-white border-cyan-500"
                                    : r === "failed"
                                      ? "bg-teal-800 text-white border-teal-800"
                                      : "bg-orange-500 text-white border-orange-500"
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
          {/* Said plainly. The old copy under these buttons was "Every logged
              outcome retrains the score", directly beneath controls that wrote
              to component state and lost it on the next navigation. */}
          <p className="mt-3 rounded-2xl border-l-4 border-orange-500 bg-orange-50 px-4 py-3 text-xs text-ink">
            <span className="font-medium">Nothing here is saved.</span> These demo controls only update this tab and reset when you leave it. They do not save validation outcomes or retrain any model.
          </p>
          <p className="mt-2 text-xs text-muted">
            The order file carries the genes, the arm and the assay. It carries no guide sequences, because the sample
            dataset has no guide table and inventing one would put oligos in a file somebody could order.
          </p>
        </Card>

        <Card
          title="Already answered at the bench"
          subtitle="Removed from the plan above, which is what makes the Truth Loop a loop"
        >
          {settled.length === 0 ? (
            <p className="text-sm text-muted">No gene on this screen has been re-tested yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {settled.map(({ hit, outcome }) => (
                <li key={outcome.id} className="py-3 flex items-center justify-between gap-4 text-sm">
                  <span>
                    <span className="font-medium text-ink">{hit.gene}</span>
                    <span className="block text-xs text-muted">
                      {outcome.assay} · logged {formatDate(outcome.loggedAt)} by {outcome.by}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="text-ink">{OUTCOME_RESULT[outcome.result].label}</span>
                    <span className="block text-xs text-muted">called at {hit.chance.toFixed(3)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Plate map"
        subtitle={`96-well · duplicate wells per gene · controls in columns ${CONTROL_COLUMNS.map((c) => c + 1).join(" and ")}`}
      >
        <div className="grid grid-cols-12 gap-1">
          {wells.map((w) => {
            const col = w % 12;
            const row = Math.floor(w / 12);
            const idx = row * 6 + Math.floor(col / 2);
            const isControl = CONTROL_COLUMNS.includes(col);
            const filled = !isControl && idx < plan.length;
            return (
              <div
                key={w}
                title={filled ? plan[idx].gene : isControl ? "Non-targeting control" : "empty"}
                className={cn(
                  "aspect-square rounded-full text-[8px] flex items-center justify-center",
                  filled ? "bg-orange-500 text-white" : isControl ? "bg-teal-800 text-white" : "bg-mist-soft text-muted",
                )}
              >
                {filled ? plan[idx].gene.slice(0, 3) : isControl ? "C" : ""}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500" aria-hidden="true" /> plan gene
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-teal-800" aria-hidden="true" /> control
          </span>
        </div>
        <p className="mt-3 text-xs text-muted">
          The control wells hold non-targeting guides, which is the negative the assay is read against. Columns 11 and
          12 are 16 wells, two per row, matching the duplicate layout of the plan genes.
        </p>
      </Card>
    </div>
  );
}

/**
 * The Hit Report tab.
 *
 * Everything here comes out of `buildReport`, which is the same builder the three
 * export routes call. The previous version of this panel wrote its own summary and
 * carried a Methods paragraph with one library hardcoded into it, so a TKOv3 screen
 * reported Brunello and a bottleneck it never had. Nothing on this page is written
 * by hand any more, and the version stamp is gone because a report is identified
 * by its run and its pipeline version, not by a number in a card title.
 */
function ReportPanel({ screen }: { screen: Screen }) {
  const doc = useMemo(() => buildReport(screen), [screen]);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const risky = excelAmbiguousSymbols(doc.hits);
  const href = (format: string) => `/api/report/${screen.id}?format=${format}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopy("copied");
    } catch {
      // Clipboard access is denied in plenty of contexts. Say so rather than
      // showing a success message for something that did not happen.
      setCopy("failed");
    }
  };

  return (
    <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
      <div className="space-y-4">
        <Card
          title="Hit Report"
          subtitle={`${doc.reportId} · run completed ${doc.run.completedAt ? formatDate(doc.run.completedAt) : "not recorded"}`}
        >
          {doc.notice && (
            <p className="rounded-2xl border-l-4 border-orange-500 bg-orange-50 px-4 py-3 text-sm text-ink">
              <span className="font-medium">Sample data.</span> {doc.notice.replace(/^Sample data\.\s*/, "")} The label
              travels inside every export, not just on this page.
            </p>
          )}

          <div className="mt-4 rounded-2xl bg-mist-soft p-5 md:p-6">
            <div className="eyebrow">{doc.screen.id}</div>
            <h4 className="mt-2 text-2xl text-ink font-medium tracking-tight">{doc.screen.name}</h4>
            <p className="mt-3 text-sm text-body leading-relaxed">{doc.summary}</p>
            <dl className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
              {VERDICT_ORDER.slice(0, 4).map((v) => (
                <div key={v} className="rounded-xl bg-white p-3">
                  <dt className="text-xs text-muted">{v}</dt>
                  <dd className="text-xl text-ink font-medium tabular-nums">{formatNumber(doc.counts.byVerdict[v])}</dd>
                </div>
              ))}
            </dl>
          </div>

          <h4 className="eyebrow mt-6">Exports</h4>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={href("pdf")} className="btn btn-orange btn-sm">
              <Download className="w-4 h-4" aria-hidden="true" /> PDF report
            </a>
            <a href={href("csv")} className="btn btn-ghost btn-sm">
              <Download className="w-4 h-4" aria-hidden="true" /> CSV table
            </a>
            <a href={href("json")} className="btn btn-ghost btn-sm">
              <Download className="w-4 h-4" aria-hidden="true" /> JSON bundle
            </a>
            <button type="button" onClick={copyLink} className="btn btn-ghost btn-sm">
              <Link2 className="w-4 h-4" aria-hidden="true" /> Copy link
            </button>
          </div>
          <p aria-live="polite" className="mt-2 text-xs text-muted min-h-4">
            {copy === "copied"
              ? "Report link copied to the clipboard."
              : copy === "failed"
                ? "The clipboard was blocked by this browser. Copy the address bar instead."
                : ""}
          </p>

          <ul className="mt-2 space-y-1.5 text-xs text-muted">
            <li>
              <span className="text-ink">PDF</span> · A4, print ready: summary, verdict breakdown, methods, the full
              provenance record and{" "}
              {doc.hits.length > 60 ? `the top 60 of ${formatNumber(doc.hits.length)}` : `all ${formatNumber(doc.hits.length)}`} ranked
              hits.
            </li>
            <li>
              <span className="text-ink">CSV</span> · {formatNumber(doc.hits.length)} rows, one per gene, 21 columns,
              with provenance in a # preamble. Read it in R with readr::read_csv(path, comment = &quot;#&quot;).
            </li>
            <li>
              <span className="text-ink">JSON</span> · the same rows plus every tool version, parameter and reference
              release, schema {doc.run.analysisSchema}, for a pipeline to consume.
            </li>
          </ul>
          <p className="mt-3 text-xs text-muted">
            Excel rewrites gene symbols such as MARCH1 and SEPT9 as dates when a CSV is opened by double-click, and no
            single CSV can stop that without putting a formula where R expects a symbol. Import with Data, then From
            Text/CSV, and set gene_symbol to Text.{" "}
            {risky.length > 0
              ? `${risky.length} symbol${risky.length === 1 ? "" : "s"} in this export are affected: ${risky.join(", ")}.`
              : "No symbol in this export is date-ambiguous, and the file names any that appear later."}
          </p>
        </Card>

        <Card title="Methods" subtitle="Written from the run record, so it describes this screen and no other">
          <div className="space-y-4">
            {doc.methods.map((section) => (
              <section key={section.heading}>
                <h4 className="text-sm text-ink font-medium">{section.heading}</h4>
                <p className="mt-1 text-sm text-body leading-relaxed">{section.body}</p>
              </section>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Provenance" subtitle="What produced these numbers, and which releases it read">
        <ProvenanceGroup
          label="Run"
          rows={[
            { key: "Pipeline", value: `${doc.run.pipeline} ${doc.run.pipelineVersion}` },
            { key: "Analysis schema", value: doc.run.analysisSchema, note: "Bumped whenever a stage changes a number" },
            { key: "Run id", value: doc.run.id },
            { key: "Screen created", value: formatDate(doc.screen.createdAt) },
            { key: "Started", value: doc.run.startedAt ? formatDate(doc.run.startedAt) : "not recorded" },
            { key: "Completed", value: doc.run.completedAt ? formatDate(doc.run.completedAt) : "not recorded" },
            {
              key: "Compute time",
              value: `${formatNumber(doc.run.wallClockSec)} s`,
              note: `Sum of the ${doc.run.stages.length} stage durations, not elapsed time`,
            },
            { key: "Data source", value: doc.source === "sample" ? "SplicR sample dataset" : "SplicR workspace" },
          ]}
        />
        <ProvenanceGroup
          label="Tool versions"
          rows={doc.tools.map((t) => ({ key: t.name, value: t.version ?? "not pinned", note: t.role }))}
        />
        <ProvenanceGroup
          label="Reference data"
          rows={doc.references.map((r) => ({ key: r.name, value: r.release, note: r.detail }))}
        />
        <ProvenanceGroup
          label="Parameters"
          rows={doc.parameters.map((p) => ({ key: p.label, value: p.value, note: p.note }))}
        />
      </Card>
    </div>
  );
}

function ProvenanceGroup({
  label,
  rows,
}: {
  label: string;
  rows: { key: string; value: string; note?: string }[];
}) {
  return (
    <section className="mt-6 first:mt-0">
      <h4 className="eyebrow">{label}</h4>
      <dl className="mt-2 grid grid-cols-1 sm:grid-cols-[minmax(0,7.5rem)_1fr] gap-x-3 gap-y-2.5 text-sm">
        {rows.map((row) => (
          <Fragment key={`${label}-${row.key}`}>
            <dt className="text-xs text-muted sm:pt-0.5">{row.key}</dt>
            <dd className="text-ink">
              {row.value}
              {row.note && <span className="mt-0.5 block text-xs text-muted">{row.note}</span>}
            </dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}

function HitDrawer({ hit, screen, onClose }: { hit: Hit; screen: Screen; onClose: () => void }) {
  const logged = benchSettled(screen.id).find((row) => row.hit.gene === hit.gene)?.outcome ?? null;

  return (
    <ModalDrawer eyebrow="Hit" title={hit.gene} onClose={onClose} closeLabel="Close the hit evidence">
      <div className="mt-6 flex items-center justify-between">
        <Chance value={hit.chance} />
        <VerdictBadge verdict={hit.verdict} />
      </div>
      <p className="mt-4 text-body">{hit.why}</p>

      <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
        {[
          ["log2 fold change", hit.lfc.toFixed(2)],
          ["Selection arm", hit.direction],
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
          Called in {hit.atlasHits} of the {formatNumber(hit.atlasScreens)} Atlas screens that assayed it
          {hit.flags.includes("Frequent hitter") ? ", which is why it is flagged as a frequent hitter" : ""}. That
          denominator is this gene&apos;s own, not the size of the corpus.
        </p>
        {/* The three named ORCS ids used to sit here with "hit" or "not a hit"
            beside each, computed as `hit.chance > 0.5`: the model's own score,
            repeated three times and presented as external corroboration. The
            sample dataset records no per-screen call for a gene, so none is shown. */}
        <p className="mt-2 text-xs text-muted">
          Per-screen calls for this gene are not in the sample dataset, so the individual screens are not listed. The
          count above is the only Atlas evidence recorded for it.
        </p>
      </div>

      <div className="mt-6">
        <div className="text-sm text-ink font-medium">Bench record</div>
        <p className="text-sm text-body mt-1">
          {logged
            ? `${OUTCOME_RESULT[logged.result].label} on ${logged.assay.toLowerCase()}, logged ${formatDate(logged.loggedAt)} by ${logged.by}.`
            : "This gene has not been re-tested on this screen."}
        </p>
      </div>

      {hit.flags.length > 0 && (
        <div className="mt-6">
          <div className="text-sm text-ink font-medium">Flags</div>
          <p className="text-xs text-muted mt-1">
            Each flag cost this gene log-odds on the score above, so the number it carries is already net of them.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {hit.flags.map((f) => (
              <Flag key={f} label={f} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-wrap gap-2">
        <Link href={`/dashboard/screens/${screen.id}?tab=validation`} className="btn btn-orange btn-sm">
          Open the validation plan
        </Link>
        <a
          href={`https://orcs.thebiogrid.org/Gene/${hit.gene}`}
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost btn-sm"
        >
          ORCS <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
        </a>
      </div>
    </ModalDrawer>
  );
}
