"use client";

/**
 * The effect plot, the sentence that reads it, and the guide-evidence drawer.
 *
 * WHAT THE REQUEST DOES
 *
 * Selecting a gene fetches its recorded guide-disagreement report from
 * `/api/v1/screens/{id}/genes/{gene}/disagreement`. One request per gene, and:
 *
 *   - a second selection aborts the first, so a reader clicking across the plot
 *     never has a stale answer arrive over a newer one
 *   - reports already fetched are kept for the life of the page, because a
 *     stored report for a stored run does not change
 *   - every failure becomes a sentence naming what is missing, and none of them
 *     reads as "the guides agreed"
 *
 * The display thresholds change which dots are emphasised. They do not change
 * any stored statistic and they do not change the report, which was computed
 * once at analysis time.
 */
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DisagreementReport } from "@/lib/data/disagreement";
import { MARK_HAS_REPORT, type EffectSeries } from "@/lib/report/effect-series";

import { EffectPlot } from "./effect-plot";
import { useGeneFocus } from "./gene-focus";
import { GeneDrawer, type DrawerState } from "./gene-drawer";

const FDR_CHOICES = [0.01, 0.05, 0.1, 0.25] as const;

interface Cached {
  report: DisagreementReport;
  recordedAt: string | null;
}

/** The two genes a reader looks for first, and how many cleared the threshold. */
function readPlot(series: EffectSeries, maxFdr: number) {
  let passing = 0;
  let bestUp = -1;
  let bestDown = -1;
  for (let index = 0; index < series.gene.length; index += 1) {
    const fdr = series.fdr[index];
    if (fdr === null || fdr > maxFdr) continue;
    passing += 1;
    const leader = series.lfc[index] >= 0 ? bestUp : bestDown;
    const better = leader === -1 || fdr < (series.fdr[leader] as number);
    if (!better) continue;
    if (series.lfc[index] >= 0) bestUp = index;
    else bestDown = index;
  }
  return {
    passing,
    enriched: bestUp === -1 ? null : { gene: series.gene[bestUp], lfc: series.lfc[bestUp] },
    depleted: bestDown === -1 ? null : { gene: series.gene[bestDown], lfc: series.lfc[bestDown] },
  };
}

export function EffectExplorer({
  screenId,
  screenName,
  comparisonName,
  series,
  defaultMaxFdr,
}: {
  screenId: string;
  screenName: string;
  comparisonName: string;
  series: EffectSeries;
  defaultMaxFdr: number;
}) {
  const [maxFdr, setMaxFdr] = useState(defaultMaxFdr);
  const [minAbsLfc, setMinAbsLfc] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [find, setFind] = useState("");
  const { gene: focused, focus } = useGeneFocus();
  const cache = useRef(new Map<string, Cached>());
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => () => inflight.current?.abort(), []);

  const withReports = useMemo(
    () => series.marks.reduce((total, mark) => total + (mark & MARK_HAS_REPORT ? 1 : 0), 0),
    [series.marks],
  );
  const reading = useMemo(() => readPlot(series, maxFdr), [series, maxFdr]);

  const symbols = useMemo(() => series.gene.map((gene) => gene.toUpperCase()), [series.gene]);
  const suggestions = useMemo(() => {
    const needle = find.trim().toUpperCase();
    if (needle.length < 1) return [];
    const exact: string[] = [];
    const partial: string[] = [];
    for (const symbol of symbols) {
      if (symbol === needle) exact.push(symbol);
      else if (partial.length < 8 && symbol.startsWith(needle)) partial.push(symbol);
      if (exact.length > 0 && partial.length >= 8) break;
    }
    return [...exact, ...partial].slice(0, 8);
  }, [find, symbols]);

  const open = useCallback(async (gene: string) => {
    setSelected(gene);
    focus(gene);
    const held = cache.current.get(gene);
    if (held) {
      setDrawer({ kind: "found", gene, report: held.report, recordedAt: held.recordedAt });
      return;
    }
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setDrawer({ kind: "loading", gene });
    try {
      const response = await fetch(
        `/api/v1/screens/${screenId}/genes/${encodeURIComponent(gene)}/disagreement`,
        { signal: controller.signal, headers: { accept: "application/json" } },
      );
      const body = (await response.json().catch(() => ({}))) as {
        report?: DisagreementReport;
        recorded_at?: string | null;
        error?: string;
        reason?: string;
      };
      if (controller.signal.aborted) return;
      if (response.ok && body.report) {
        cache.current.set(gene, { report: body.report, recordedAt: body.recorded_at ?? null });
        setDrawer({ kind: "found", gene, report: body.report, recordedAt: body.recorded_at ?? null });
        return;
      }
      setDrawer({
        kind: "message",
        gene,
        title: body.error ?? `The guide evidence for ${gene} could not be read.`,
        body: body.reason
          ?? (response.status === 503
            ? "The workspace records could not be read. Reload to try again."
            : "Nothing here says the guides agreed; it says the report is not available."),
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      setDrawer({
        kind: "message",
        gene,
        title: `The guide evidence for ${gene} could not be requested.`,
        body: "The request did not reach the server. Check your connection and try again.",
      });
    } finally {
      if (inflight.current === controller) inflight.current = null;
    }
  }, [screenId, focus]);

  const close = useCallback(() => {
    inflight.current?.abort();
    inflight.current = null;
    setDrawer(null);
  }, []);

  const control = "rounded border px-1.5 py-0.5 text-[11px] transition-colors duration-[var(--dur-1)]";

  return (
    <div className="flex min-h-[380px] flex-col">
      {/* What the panel says before a reader has to read it. */}
      <p className="border-b border-line px-3 py-2 text-[12.5px] leading-snug text-ink">
        <span className="num">{reading.passing.toLocaleString("en-US")}</span>{" "}
        {reading.passing === 1 ? "gene is" : "genes are"} at or below FDR {maxFdr} in the {comparisonName} comparison.
        {reading.enriched && (
          <> Strongest enrichment <span className="font-medium">{reading.enriched.gene}</span>{" "}
            <span className="num text-muted">({reading.enriched.lfc > 0 ? "+" : ""}{reading.enriched.lfc.toFixed(2)})</span>.</>
        )}
        {reading.depleted && (
          <> Strongest depletion <span className="font-medium">{reading.depleted.gene}</span>{" "}
            <span className="num text-muted">({reading.depleted.lfc.toFixed(2)})</span>.</>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-3 py-2 text-[11px]">
        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Emphasise genes at or below this recorded FDR</legend>
          <span className="text-muted">Emphasise FDR ≤</span>
          {FDR_CHOICES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={maxFdr === value}
              onClick={() => setMaxFdr(value)}
              className={`num ${control} ${
                maxFdr === value ? "border-ink bg-ink text-surface" : "border-line text-body hover:bg-canvas"
              }`}
            >
              {value}
            </button>
          ))}
        </fieldset>

        <label className="flex items-center gap-2">
          <span className="text-muted">and |log2FC| ≥</span>
          <input
            type="range"
            min={0}
            max={3}
            step={0.25}
            value={minAbsLfc}
            onChange={(event) => setMinAbsLfc(Number(event.target.value))}
            className="w-24 accent-cyan-700"
          />
          <output className="num w-8 text-ink">{minAbsLfc.toFixed(2)}</output>
        </label>

        <div className="relative ml-auto flex items-center">
          <label htmlFor="effect-find" className="sr-only">Find a gene on the plot</label>
          <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted" aria-hidden="true" />
          <input
            id="effect-find"
            type="search"
            value={find}
            onChange={(event) => {
              setFind(event.target.value);
              const needle = event.target.value.trim().toUpperCase();
              focus(symbols.includes(needle) ? needle : null);
            }}
            placeholder="Find a gene"
            autoComplete="off"
            spellCheck={false}
            list="effect-find-options"
            className="h-7 w-[150px] rounded-md border border-line bg-white pl-7 pr-2 text-[12px] text-ink outline-none focus:border-cyan-500"
          />
          <datalist id="effect-find-options">
            {suggestions.map((symbol) => <option key={symbol} value={symbol} />)}
          </datalist>
          {focused && (
            <button
              type="button"
              onClick={() => { setFind(""); focus(null); }}
              className="ml-1.5 inline-flex items-center gap-1 rounded-sm text-[11px] text-cyan-600"
            >
              <X className="h-3 w-3" aria-hidden="true" /> Clear
            </button>
          )}
        </div>
      </div>

      <EffectPlot
        series={series}
        maxFdr={maxFdr}
        minAbsLfc={minAbsLfc}
        selected={selected}
        highlight={focused}
        onSelect={withReports > 0 ? open : null}
      />

      {withReports === 0 && (
        <p className="border-t border-line px-3 py-1.5 text-[11px] leading-snug text-muted">
          This run recorded no per-guide evidence, so no dot opens. Re-running the comparison
          writes it. Its absence says nothing about whether any gene&rsquo;s guides agreed.
        </p>
      )}

      {drawer && (
        <GeneDrawer key={drawer.gene} state={drawer} screenName={screenName} onClose={close} />
      )}
    </div>
  );
}
