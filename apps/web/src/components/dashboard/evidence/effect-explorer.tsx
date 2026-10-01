"use client";

/**
 * The effect plot and the guide-evidence drawer, and the one request between them.
 *
 * WHAT THE REQUEST DOES
 *
 * Selecting a gene fetches its recorded guide-disagreement report from
 * `/api/v1/screens/{id}/genes/{gene}/disagreement`. One request per gene, and:
 *
 *   - a second selection aborts the first, so a reader clicking across the plot
 *     never has a stale answer arrive over a newer one
 *   - reports already fetched are kept for the life of the page, because a stored
 *     report for a stored run does not change; clicking back to a gene is free
 *   - every failure becomes a sentence naming what is missing. 409 for a run that
 *     stored no reports reads differently from 409 for a gene that has none, and
 *     neither reads as "the guides agreed"
 *   - a request in flight when the drawer closes is abandoned rather than applied
 *
 * The display thresholds live in this component and in the address, so a view can
 * be sent as a link. They change which dots are emphasised. They do not change any
 * stored statistic and they do not change the report, which was computed once.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { DisagreementReport, EffectPoint } from "@/lib/data/disagreement";

import { EffectPlot } from "./effect-plot";
import { GeneDrawer, type DrawerState } from "./gene-drawer";

/** Display thresholds the reader can move. Both start at the page's own defaults. */
const FDR_CHOICES = [0.01, 0.05, 0.1, 0.25] as const;

interface Cached {
  report: DisagreementReport;
  recordedAt: string | null;
}

export function EffectExplorer({
  screenId,
  screenName,
  comparisonName,
  points,
  recorded,
  truncatedBy,
  defaultMaxFdr,
}: {
  screenId: string;
  screenName: string;
  comparisonName: string;
  points: EffectPoint[];
  recorded: number;
  truncatedBy: number;
  defaultMaxFdr: number;
}) {
  const [maxFdr, setMaxFdr] = useState(defaultMaxFdr);
  const [minAbsLfc, setMinAbsLfc] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const cache = useRef(new Map<string, Cached>());
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => () => inflight.current?.abort(), []);

  const open = useCallback(async (gene: string) => {
    setSelected(gene);
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
  }, [screenId]);

  const close = useCallback(() => {
    inflight.current?.abort();
    inflight.current = null;
    setDrawer(null);
  }, []);

  const withReports = points.filter((point) => point.hasReport).length;

  return (
    <div className="flex min-h-[420px] flex-col">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-3 py-2 text-[11px]">
        <span className="text-muted">
          {comparisonName}, <span className="num">{recorded.toLocaleString("en-US")}</span> recorded genes
          {withReports > 0 && <>, <span className="num">{withReports.toLocaleString("en-US")}</span> with guide evidence to open</>}
        </span>

        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Emphasise genes at or below this recorded FDR</legend>
          <span className="text-muted">Emphasise FDR ≤</span>
          {FDR_CHOICES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={maxFdr === value}
              onClick={() => setMaxFdr(value)}
              className={`num rounded border px-1.5 py-0.5 ${
                maxFdr === value
                  ? "border-ink bg-ink text-surface"
                  : "border-line text-body hover:bg-canvas"
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
            className="w-28 accent-cyan-700"
          />
          <output className="num w-8 text-ink">{minAbsLfc.toFixed(2)}</output>
        </label>

        <span className="text-muted">Display only; nothing is recomputed.</span>
      </div>

      <EffectPlot
        points={points}
        maxFdr={maxFdr}
        minAbsLfc={minAbsLfc}
        selected={selected}
        onSelect={open}
        truncatedBy={truncatedBy}
      />

      {withReports === 0 && (
        <p className="border-t border-line px-3 py-2 text-[11px] leading-snug text-muted">
          No gene in this comparison has a recorded guide-disagreement report, so no dot
          opens. Reports are written by runs analysed after per-guide effects were recorded;
          re-running the comparison produces them. Their absence says nothing about whether
          any gene&rsquo;s guides agreed.
        </p>
      )}

      {drawer && (
        <GeneDrawer key={drawer.gene} state={drawer} screenName={screenName} onClose={close} />
      )}
    </div>
  );
}
