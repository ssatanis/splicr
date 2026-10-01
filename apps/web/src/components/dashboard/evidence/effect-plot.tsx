"use client";

/**
 * Recorded effect against recorded significance, for every gene in a comparison.
 *
 * WHAT IT DRAWS AND WHAT IT REFUSES TO
 *
 * One dot per recorded gene, at its recorded log2 fold change and its recorded
 * FDR. Nothing is fitted, smoothed, jittered or thinned. A genome-wide
 * comparison is twenty thousand dots and all twenty thousand are drawn, which
 * is why this is a canvas: dropping rows for frame rate is still dropping rows,
 * and the rows a sampler drops are the ones in the tails.
 *
 * Genes with no recorded FDR are not silently omitted and are not drawn at the
 * top as if they were the most significant. They sit on a separate row below
 * the axis, labelled, because "no FDR recorded" is not "FDR 1" and is certainly
 * not "FDR 0".
 *
 * BOTH AXES FOLLOW THE DATA
 *
 * An earlier version fixed the vertical axis at -log10(FDR) = 12. A run whose
 * best FDR is 0.005 reaches 2.3, so four fifths of the panel was empty and
 * every dot sat in a band a few pixels tall. The axes now take their range from
 * the comparison, rounded out to a readable tick, and a value past the range is
 * drawn hollow at the edge so a reader can see that its real position is
 * further out rather than believing the edge is the value.
 *
 * The thresholds are display filters. Moving them changes which dots are
 * emphasised and recomputes nothing: the stored statistics and the stored
 * disagreement reports are untouched.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MARK_DISCORDANT, MARK_FRAGILE, MARK_HAS_REPORT, type EffectSeries } from "@/lib/report/effect-series";

const PADDING = { top: 16, right: 18, bottom: 44, left: 56 };
/** Below the axis, where genes with no recorded FDR are drawn. */
const NO_FDR_BAND = 20;
/** A dot beyond this many log2 units is drawn hollow at the edge. */
const X_HARD_LIMIT = 12;

export interface EffectPlotProps {
  series: EffectSeries;
  /** Display threshold on recorded FDR. */
  maxFdr: number;
  /** Display threshold on |log2 fold change|. */
  minAbsLfc: number;
  selected: string | null;
  /** Null when no gene in this comparison has a report to open. */
  onSelect: ((gene: string) => void) | null;
  /** Drawn with a ring and a label even when it is not emphasised. */
  highlight?: string | null;
}

/** The scales the panel is drawn on, taken from the data rather than assumed. */
interface Scale {
  xLimit: number;
  yCeiling: number;
  xTicks: number[];
  yTicks: number[];
}

/** A tick step that reads as 1, 2 or 5 times a power of ten. */
function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(raw || 1));
  const normalised = raw / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

function ticksTo(limit: number, step: number, signed: boolean): number[] {
  const out: number[] = [];
  for (let value = signed ? -Math.floor(limit / step) * step : 0; value <= limit + 1e-9; value += step) {
    out.push(Number(value.toFixed(6)));
  }
  return out;
}

/** -log10(FDR), with the resolution floor RRA reports as 0 treated as "off the top". */
function significance(fdr: number | null): number {
  if (fdr === null) return Number.NaN;
  if (fdr <= 0) return Number.POSITIVE_INFINITY;
  return -Math.log10(fdr);
}

function buildScale(series: EffectSeries): Scale {
  let maxAbsLfc = 0;
  let maxY = 0;
  for (let index = 0; index < series.lfc.length; index += 1) {
    const lfc = Math.abs(series.lfc[index]);
    if (Number.isFinite(lfc) && lfc < X_HARD_LIMIT && lfc > maxAbsLfc) maxAbsLfc = lfc;
    const y = significance(series.fdr[index]);
    if (Number.isFinite(y) && y > maxY) maxY = y;
  }
  const xStep = niceStep(Math.max(maxAbsLfc, 1) * 2, 8);
  const xLimit = Math.max(xStep, Math.ceil(maxAbsLfc / xStep) * xStep);
  const yStep = niceStep(Math.max(maxY, 1), 5);
  const yCeiling = Math.max(yStep, Math.ceil(maxY / yStep) * yStep);
  return {
    xLimit,
    yCeiling,
    xTicks: ticksTo(xLimit, xStep, true),
    yTicks: ticksTo(yCeiling, yStep, false),
  };
}

/** Screen position and emphasis for one gene, recomputed when the panel resizes. */
interface Frame {
  x: Float32Array;
  y: Float32Array;
  emphasised: Uint8Array;
  clipped: Uint8Array;
  noFdr: Uint8Array;
  emphasisedCount: number;
  noFdrCount: number;
  clippedCount: number;
}

function place(series: EffectSeries, scale: Scale, width: number, height: number,
               maxFdr: number, minAbsLfc: number): Frame {
  const n = series.gene.length;
  const plotWidth = Math.max(1, width - PADDING.left - PADDING.right);
  const plotHeight = Math.max(1, height - PADDING.top - PADDING.bottom - NO_FDR_BAND);
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const emphasised = new Uint8Array(n);
  const clipped = new Uint8Array(n);
  const noFdr = new Uint8Array(n);
  let emphasisedCount = 0;
  let noFdrCount = 0;
  let clippedCount = 0;

  for (let index = 0; index < n; index += 1) {
    const rawLfc = series.lfc[index];
    const bounded = Math.max(-scale.xLimit, Math.min(scale.xLimit, rawLfc));
    x[index] = PADDING.left + ((bounded + scale.xLimit) / (2 * scale.xLimit)) * plotWidth;

    const fdr = series.fdr[index];
    let off = Math.abs(rawLfc) > scale.xLimit;
    if (fdr === null) {
      noFdr[index] = 1;
      noFdrCount += 1;
      y[index] = PADDING.top + plotHeight + NO_FDR_BAND / 2;
    } else {
      const raw = significance(fdr);
      off = off || raw > scale.yCeiling;
      y[index] = PADDING.top + plotHeight - (Math.min(raw, scale.yCeiling) / scale.yCeiling) * plotHeight;
      if (fdr <= maxFdr && Math.abs(rawLfc) >= minAbsLfc) {
        emphasised[index] = 1;
        emphasisedCount += 1;
      }
    }
    if (off) {
      clipped[index] = 1;
      clippedCount += 1;
    }
  }
  return { x, y, emphasised, clipped, noFdr, emphasisedCount, noFdrCount, clippedCount };
}

export function EffectPlot({
  series, maxFdr, minAbsLfc, selected, onSelect, highlight = null,
}: EffectPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 720, height: 360 });
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scale = useMemo(() => buildScale(series), [series]);
  const frame = useMemo(
    () => place(series, scale, size.width, size.height, maxFdr, minAbsLfc),
    [series, scale, size.width, size.height, maxFdr, minAbsLfc],
  );

  const indexOfGene = useMemo(() => {
    const map = new Map<string, number>();
    series.gene.forEach((gene, index) => map.set(gene.toUpperCase(), index));
    return map;
  }, [series.gene]);

  const selectedIndex = selected ? indexOfGene.get(selected.toUpperCase()) ?? null : null;
  const highlightIndex = highlight ? indexOfGene.get(highlight.toUpperCase()) ?? null : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const style = getComputedStyle(canvas);
    const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    const line = read("--plot-line", "#d6d6d6");
    const dim = read("--plot-dim", "#6b6b6b");
    const down = read("--plot-depleted", "#14596b");
    const up = read("--plot-enriched", "#9a4a16");
    const ink = read("--plot-ink", "#111111");

    const plotWidth = size.width - PADDING.left - PADDING.right;
    const plotHeight = size.height - PADDING.top - PADDING.bottom - NO_FDR_BAND;
    const axisY = PADDING.top + plotHeight;
    const xAt = (lfc: number) =>
      PADDING.left + ((Math.max(-scale.xLimit, Math.min(scale.xLimit, lfc)) + scale.xLimit) / (2 * scale.xLimit)) * plotWidth;
    const yAt = (value: number) => axisY - (Math.min(value, scale.yCeiling) / scale.yCeiling) * plotHeight;

    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADDING.left, PADDING.top);
    ctx.lineTo(PADDING.left, axisY);
    ctx.lineTo(PADDING.left + plotWidth, axisY);
    ctx.stroke();

    if (frame.noFdrCount > 0) {
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(PADDING.left, axisY + NO_FDR_BAND);
      ctx.lineTo(PADDING.left + plotWidth, axisY + NO_FDR_BAND);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = dim;
    ctx.beginPath();
    ctx.moveTo(xAt(0), PADDING.top);
    ctx.lineTo(xAt(0), axisY);
    ctx.stroke();
    if (minAbsLfc > 0) {
      ctx.setLineDash([3, 4]);
      for (const at of [-minAbsLfc, minAbsLfc]) {
        ctx.beginPath();
        ctx.moveTo(xAt(at), PADDING.top);
        ctx.lineTo(xAt(at), axisY);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    if (maxFdr > 0 && maxFdr < 1) {
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(PADDING.left, yAt(-Math.log10(maxFdr)));
      ctx.lineTo(PADDING.left + plotWidth, yAt(-Math.log10(maxFdr)));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = dim;
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    const xLabel = (tick: number) => (Math.abs(tick) < 1 && tick !== 0 ? tick.toFixed(1) : String(tick));
    for (const tick of scale.xTicks) ctx.fillText(xLabel(tick), xAt(tick), axisY + 14);
    ctx.textAlign = "right";
    for (const tick of scale.yTicks) ctx.fillText(String(tick), PADDING.left - 6, yAt(tick) + 3);
    if (frame.noFdrCount > 0) ctx.fillText("none", PADDING.left - 6, axisY + NO_FDR_BAND / 2 + 3);

    // Axis titles, so the panel does not need a sentence underneath to say what
    // it plots.
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("log2 fold change", PADDING.left + plotWidth / 2, size.height - 6);
    ctx.save();
    ctx.translate(13, PADDING.top + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("\u2212log10 FDR", 0, 0);
    ctx.restore();

    const drawDot = (index: number, radius: number, ringed: boolean) => {
      const colour = series.lfc[index] < 0 ? down : up;
      const emphasised = frame.emphasised[index] === 1;
      ctx.beginPath();
      ctx.arc(frame.x[index], frame.y[index], radius, 0, Math.PI * 2);
      if (frame.clipped[index] === 1) {
        ctx.strokeStyle = emphasised ? colour : dim;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        ctx.fillStyle = emphasised ? colour : dim;
        ctx.globalAlpha = emphasised ? 0.9 : 0.28;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (ringed) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(frame.x[index], frame.y[index], radius + 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    // Background first so an emphasised gene is never buried under the cloud.
    for (let index = 0; index < series.gene.length; index += 1) {
      if (frame.emphasised[index] === 0) drawDot(index, 1.6, false);
    }
    for (let index = 0; index < series.gene.length; index += 1) {
      if (frame.emphasised[index] === 1 && index !== selectedIndex && index !== highlightIndex) {
        drawDot(index, 2.8, false);
      }
    }
    for (const index of [highlightIndex, selectedIndex]) {
      if (index === null || index === undefined) continue;
      drawDot(index, 4, true);
      ctx.fillStyle = ink;
      ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = frame.x[index] > size.width - 90 ? "right" : "left";
      const offset = frame.x[index] > size.width - 90 ? -9 : 9;
      ctx.fillText(series.gene[index], frame.x[index] + offset, frame.y[index] + 3);
    }
  }, [series, scale, frame, selectedIndex, highlightIndex, size, maxFdr, minAbsLfc]);

  /** Nearest gene to a pointer, within a small radius. */
  const nearest = useCallback((offsetX: number, offsetY: number): number | null => {
    let best: number | null = null;
    let bestDistance = 12 * 12;
    for (let index = 0; index < frame.x.length; index += 1) {
      const distance = (frame.x[index] - offsetX) ** 2 + (frame.y[index] - offsetY) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    return best;
  }, [frame]);

  const hoveredGene = hovered === null ? null : series.gene[hovered];
  const hoveredOpens = hovered !== null && onSelect !== null && (series.marks[hovered] & MARK_HAS_REPORT) !== 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={wrapRef}
        className="relative min-h-[300px] flex-1"
        style={{
          // Read by the canvas so the plot follows the page's own palette rather
          // than hard-coding colours a theme change would leave behind.
          "--plot-line": "var(--color-line-strong, #d6d6d6)",
          "--plot-dim": "var(--color-muted, #6b6b6b)",
          "--plot-depleted": "var(--color-depleted, #14596b)",
          "--plot-enriched": "var(--color-enriched, #9a4a16)",
          "--plot-ink": "var(--color-ink, #111111)",
        } as React.CSSProperties}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%" }}
          className={hoveredOpens ? "block cursor-pointer touch-manipulation" : "block touch-manipulation"}
          role="img"
          aria-label={
            `Recorded effect against recorded significance for ${series.gene.length.toLocaleString("en-US")} genes. `
            + `${frame.emphasisedCount.toLocaleString("en-US")} are at or below FDR ${maxFdr} with an effect of at least ${minAbsLfc} in size. `
            + "The gene table below the plot holds the same genes and needs no pointer."
          }
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setHovered(nearest(event.clientX - rect.left, event.clientY - rect.top));
          }}
          onMouseLeave={() => setHovered(null)}
          onClick={(event) => {
            if (!onSelect) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const hit = nearest(event.clientX - rect.left, event.clientY - rect.top);
            if (hit !== null && (series.marks[hit] & MARK_HAS_REPORT) !== 0) onSelect(series.gene[hit]);
          }}
        />
        {hovered !== null && hoveredGene && (
          <div
            className="pointer-events-none absolute z-10 max-w-[230px] rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11px] leading-snug shadow-sm"
            style={{
              left: Math.max(0, Math.min(frame.x[hovered] + 10, size.width - 236)),
              top: Math.max(0, frame.y[hovered] - 44),
            }}
          >
            <div className="font-medium text-ink">{hoveredGene}</div>
            <div className="num text-muted">
              log2FC {series.lfc[hovered].toFixed(2)}
              {", "}
              {series.fdr[hovered] === null
                ? "no FDR recorded"
                : `FDR ${(series.fdr[hovered] as number).toExponential(1)}`}
            </div>
            {(series.marks[hovered] & (MARK_FRAGILE | MARK_DISCORDANT)) !== 0 && (
              <div className="mt-0.5 text-enriched">
                {[
                  (series.marks[hovered] & MARK_FRAGILE) !== 0 && "the call turns on one guide",
                  (series.marks[hovered] & MARK_DISCORDANT) !== 0 && "guides disagree more than this screen's norm",
                ].filter(Boolean).join("; ")}
              </div>
            )}
            {hoveredOpens && <div className="mt-0.5 text-muted">Click for the guide evidence</div>}
          </div>
        )}
      </div>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-1.5 text-[11px] text-muted">
        <span className="num text-ink">
          {frame.emphasisedCount.toLocaleString("en-US")} of {series.gene.length.toLocaleString("en-US")} emphasised
        </span>
        {frame.noFdrCount > 0 && (
          <span className="num">{frame.noFdrCount.toLocaleString("en-US")} with no recorded FDR, on the row marked none</span>
        )}
        {frame.clippedCount > 0 && (
          <span className="num">{frame.clippedCount.toLocaleString("en-US")} drawn hollow past an axis limit</span>
        )}
        {series.withoutEffect > 0 && (
          <span className="num">
            {series.withoutEffect.toLocaleString("en-US")} recorded with no effect, so not placeable
          </span>
        )}
      </p>
    </div>
  );
}
