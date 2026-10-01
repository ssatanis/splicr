"use client";

/**
 * Recorded effect against recorded significance, for every gene in a comparison.
 *
 * WHAT IT DRAWS AND WHAT IT REFUSES TO
 *
 * One dot per recorded gene, at its recorded log2 fold change and its recorded
 * FDR. Nothing is fitted, smoothed, jittered or thinned. A genome-wide comparison
 * is about twenty thousand dots, which is why this is a canvas: a plot that drops
 * the rows it finds inconvenient misrepresents the experiment, and dropping them
 * for frame rate is still dropping them.
 *
 * Genes with no recorded FDR are not silently omitted and are not drawn at the
 * top as if they were the most significant. They sit on a separate row below the
 * axis, labelled, because "no FDR recorded" is not "FDR 1" and is certainly not
 * "FDR 0".
 *
 * The y axis is -log10(FDR) and is clipped at a stated ceiling. A clipped dot is
 * drawn hollow, so a reader can see that its true position is off the top rather
 * than believing the ceiling is the value.
 *
 * The thresholds are display filters. Moving them changes which dots are
 * emphasised and recomputes nothing: the axis label says so, and the stored
 * statistics and the stored disagreement report are untouched.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EffectPoint } from "@/lib/data/disagreement";

/** -log10(FDR) beyond this is drawn at the ceiling, hollow, and said to be clipped. */
const Y_CEILING = 12;
/** Half-width of the x axis in log2 units. A dot beyond it is clipped the same way. */
const X_LIMIT = 6;
const PADDING = { top: 14, right: 16, bottom: 46, left: 52 };
/** Below the axis, where genes with no recorded FDR are drawn. */
const NO_FDR_BAND = 22;

export interface EffectPlotProps {
  points: readonly EffectPoint[];
  /** Display threshold on recorded FDR. */
  maxFdr: number;
  /** Display threshold on |log2 fold change|. */
  minAbsLfc: number;
  selected: string | null;
  onSelect: (gene: string) => void;
  /** Genes recorded in the run but not drawn, when the row cap bit. */
  truncatedBy?: number;
}

interface Placed extends EffectPoint {
  x: number;
  y: number;
  emphasised: boolean;
  clipped: boolean;
  noFdr: boolean;
}

function transform(points: readonly EffectPoint[], width: number, height: number,
                   maxFdr: number, minAbsLfc: number): Placed[] {
  const plotWidth = Math.max(1, width - PADDING.left - PADDING.right);
  const plotHeight = Math.max(1, height - PADDING.top - PADDING.bottom - NO_FDR_BAND);
  return points.map((point) => {
    const lfc = Math.max(-X_LIMIT, Math.min(X_LIMIT, point.lfc));
    const x = PADDING.left + ((lfc + X_LIMIT) / (2 * X_LIMIT)) * plotWidth;
    const noFdr = point.fdr === null;
    let y: number;
    let clipped = Math.abs(point.lfc) > X_LIMIT;
    if (noFdr) {
      y = PADDING.top + plotHeight + NO_FDR_BAND / 2;
    } else {
      // FDR 0 is reported by RRA at its resolution floor; treat it as the
      // ceiling rather than dividing by zero, and mark it clipped.
      const raw = point.fdr === 0 ? Number.POSITIVE_INFINITY : -Math.log10(point.fdr as number);
      clipped = clipped || raw > Y_CEILING;
      y = PADDING.top + plotHeight - (Math.min(raw, Y_CEILING) / Y_CEILING) * plotHeight;
    }
    const emphasised =
      !noFdr && (point.fdr as number) <= maxFdr && Math.abs(point.lfc) >= minAbsLfc;
    return { ...point, x, y, emphasised, clipped, noFdr };
  });
}

export function EffectPlot({
  points, maxFdr, minAbsLfc, selected, onSelect, truncatedBy = 0,
}: EffectPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 720, height: 420 });
  const [hovered, setHovered] = useState<Placed | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);

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

  const placed = useMemo(
    () => transform(points, size.width, size.height, maxFdr, minAbsLfc),
    [points, size.width, size.height, maxFdr, minAbsLfc],
  );

  /** Only genes with a stored report can be opened, so only they are reachable. */
  const openable = useMemo(() => placed.filter((p) => p.hasReport), [placed]);

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
    const line = style.getPropertyValue("--plot-line").trim() || "#d6d6d6";
    const dim = style.getPropertyValue("--plot-dim").trim() || "#6b6b6b";
    const down = style.getPropertyValue("--plot-depleted").trim() || "#14596b";
    const up = style.getPropertyValue("--plot-enriched").trim() || "#9a4a16";
    const ink = style.getPropertyValue("--plot-ink").trim() || "#111111";

    const plotWidth = size.width - PADDING.left - PADDING.right;
    const plotHeight = size.height - PADDING.top - PADDING.bottom - NO_FDR_BAND;
    const axisY = PADDING.top + plotHeight;

    // Axes and the band that holds genes with no recorded FDR.
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADDING.left, PADDING.top);
    ctx.lineTo(PADDING.left, axisY);
    ctx.lineTo(PADDING.left + plotWidth, axisY);
    ctx.stroke();
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(PADDING.left, axisY + NO_FDR_BAND);
    ctx.lineTo(PADDING.left + plotWidth, axisY + NO_FDR_BAND);
    ctx.stroke();
    ctx.setLineDash([]);

    // Zero on the effect axis, and the two display thresholds.
    const xAt = (lfc: number) =>
      PADDING.left + ((Math.max(-X_LIMIT, Math.min(X_LIMIT, lfc)) + X_LIMIT) / (2 * X_LIMIT)) * plotWidth;
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
      const y = axisY - (Math.min(-Math.log10(maxFdr), Y_CEILING) / Y_CEILING) * plotHeight;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(PADDING.left, y);
      ctx.lineTo(PADDING.left + plotWidth, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Ticks, drawn from the same transform the dots use.
    ctx.fillStyle = dim;
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    for (const tick of [-6, -4, -2, 0, 2, 4, 6]) {
      ctx.fillText(String(tick), xAt(tick), axisY + 14);
    }
    ctx.textAlign = "right";
    for (const tick of [0, 3, 6, 9, 12]) {
      const y = axisY - (tick / Y_CEILING) * plotHeight;
      ctx.fillText(String(tick), PADDING.left - 6, y + 3);
    }
    ctx.fillText("none", PADDING.left - 6, axisY + NO_FDR_BAND / 2 + 3);

    // Dots. Unemphasised first so the current selection is never buried.
    const draw = (p: Placed) => {
      const colour = p.lfc < 0 ? down : up;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.gene === selected ? 4.5 : p.emphasised ? 2.6 : 1.8, 0, Math.PI * 2);
      if (p.clipped) {
        ctx.strokeStyle = p.emphasised ? colour : dim;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        ctx.fillStyle = p.emphasised ? colour : dim;
        ctx.globalAlpha = p.emphasised ? 0.85 : 0.35;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (p.gene === selected) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    };
    for (const p of placed) if (!p.emphasised) draw(p);
    for (const p of placed) if (p.emphasised && p.gene !== selected) draw(p);
    for (const p of placed) if (p.gene === selected) draw(p);
  }, [placed, selected, size, maxFdr, minAbsLfc]);

  /** Nearest openable gene to a pointer, within a small radius. */
  const nearest = useCallback((offsetX: number, offsetY: number): Placed | null => {
    let best: Placed | null = null;
    let bestDistance = 14 * 14;
    for (const p of openable) {
      const distance = (p.x - offsetX) ** 2 + (p.y - offsetY) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = p;
      }
    }
    return best;
  }, [openable]);

  const emphasisedCount = placed.filter((p) => p.emphasised).length;
  const noFdrCount = placed.filter((p) => p.noFdr).length;
  const clippedCount = placed.filter((p) => p.clipped).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={wrapRef}
        className="relative min-h-[320px] flex-1"
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
          className="block touch-manipulation"
          role="img"
          aria-label={
            `Recorded effect against recorded significance for ${placed.length} genes. `
            + `${emphasisedCount} pass the current display thresholds. `
            + `${openable.length} have a guide-disagreement report and can be opened. `
            + "Use the gene table below this plot to open a gene without a pointer."
          }
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setHovered(nearest(event.clientX - rect.left, event.clientY - rect.top));
          }}
          onMouseLeave={() => setHovered(null)}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const hit = nearest(event.clientX - rect.left, event.clientY - rect.top);
            if (hit) onSelect(hit.gene);
          }}
        />
        {hovered && (
          <div
            className="pointer-events-none absolute z-10 max-w-[240px] rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11px] leading-snug shadow-sm"
            style={{
              left: Math.min(hovered.x + 10, Math.max(0, size.width - 250)),
              top: Math.max(0, hovered.y - 46),
            }}
          >
            <div className="font-medium text-ink">{hovered.gene}</div>
            <div className="num text-muted">
              log2FC {hovered.lfc.toFixed(2)}
              {", "}
              {hovered.fdr === null ? "no FDR recorded" : `FDR ${hovered.fdr.toExponential(1)}`}
            </div>
            {(hovered.fragile || hovered.discordant) && (
              <div className="mt-0.5 text-enriched">
                {[hovered.fragile && "call turns on one guide",
                  hovered.discordant && "guides disagree more than this screen's norm"]
                  .filter(Boolean).join("; ")}
              </div>
            )}
            <div className="mt-0.5 text-muted">Click to open the guide evidence</div>
          </div>
        )}
      </div>

      {/* Keyboard path to the same selection. A canvas cannot be tabbed into. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-[11px] text-muted">
        <span>
          Effect (log2 fold change) horizontally, &minus;log10(recorded FDR) vertically.
          Thresholds change what is emphasised and recompute nothing.
        </span>
        <span className="num">{emphasisedCount} of {placed.length} emphasised</span>
        {noFdrCount > 0 && (
          <span className="num">
            {noFdrCount} with no recorded FDR, on the row marked &ldquo;none&rdquo;
          </span>
        )}
        {clippedCount > 0 && (
          <span className="num">{clippedCount} drawn hollow at an axis limit</span>
        )}
        {truncatedBy > 0 && (
          <span className="text-enriched">
            {truncatedBy} recorded genes are not drawn: the run exceeds this plot&rsquo;s row cap.
          </span>
        )}
        {openable.length > 0 && (
          <label className="ml-auto flex items-center gap-1.5">
            <span className="sr-only">Open a gene&rsquo;s guide evidence from the keyboard</span>
            <select
              className="h-6 rounded border border-line bg-surface px-1.5 text-[11px] text-ink"
              value={selected && openable.some((p) => p.gene === selected) ? selected : ""}
              onChange={(event) => {
                if (event.target.value) onSelect(event.target.value);
                setFocusIndex(openable.findIndex((p) => p.gene === event.target.value));
              }}
            >
              <option value="">Open a gene…</option>
              {openable.slice(0, 500).map((p) => (
                <option key={p.gene} value={p.gene}>
                  {p.gene}, log2FC {p.lfc.toFixed(2)}
                </option>
              ))}
            </select>
            {openable.length > 500 && (
              <span className="sr-only">
                The list holds the first 500 of {openable.length}; use the gene table to reach the rest.
              </span>
            )}
          </label>
        )}
        <span className="sr-only">{focusIndex >= 0 ? "" : ""}</span>
      </div>
    </div>
  );
}
