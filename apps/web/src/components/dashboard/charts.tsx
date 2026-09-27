"use client";

import { useSyncExternalStore, type ReactElement } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import type { Hit, Sample } from "@/lib/mock/data";

import { verdictColor } from "./ui";

const axisStyle = { fontSize: 11, fill: "#848d9a" };
const grid = "#e6ebef";

/**
 * Render a chart only once the browser has it, inside a box of the final height.
 *
 * Recharts lays a chart out from a measured DOM width, which a server render
 * does not have: `ResponsiveContainer` emits an empty box on the server and a
 * full chart with axes and ticks in the browser. Hydrating the second over the
 * first is a mismatch, and React throws "the server rendered text didn't match"
 * and re-renders the whole tree on the client. Every dashboard page that shows a
 * chart from a Server Component hit this on each load.
 *
 * Gating on hydration makes the server HTML and the first client render
 * identical, because both are the empty box. The chart arrives on the render
 * straight after. The height is reserved either way, so nothing below it jumps.
 *
 * `useSyncExternalStore` rather than an effect: it is the hook that is allowed
 * to answer differently on the server and the client, so React uses the server
 * snapshot to hydrate and swaps in the client one immediately afterwards. That
 * is the same result as setState in an effect without the cascading render the
 * compiler warns about.
 */
const NEVER_CHANGES = () => () => {};
const ON_CLIENT = () => true;
const ON_SERVER = () => false;

function ChartFrame({ height, children }: { height: number; children: ReactElement }) {
  const mounted = useSyncExternalStore(NEVER_CHANGES, ON_CLIENT, ON_SERVER);

  return (
    <div style={{ height }}>
      {mounted && (
        <ResponsiveContainer width="100%" height={height}>
          {children}
        </ResponsiveContainer>
      )}
    </div>
  );
}

function HitTip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;
  const h = payload[0].payload as Hit;
  return (
    <div className="rounded-xl bg-white border border-line shadow-card px-3 py-2 text-xs">
      <div className="text-ink font-medium">{h.gene}</div>
      <div className="text-muted">
        LFC {h.lfc} · FDR {h.fdr.toExponential(1)} · {Math.round(h.chance * 100)}% real
      </div>
      <div className="text-muted">{h.verdict}</div>
    </div>
  );
}

export function VolcanoChart({ hits, onSelect, height = 320 }: { hits: Hit[]; onSelect?: (h: Hit) => void; height?: number }) {
  const data = hits.map((h) => ({ ...h, nlp: -Math.log10(h.pValue) }));
  return (
    <ChartFrame height={height}>
      <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" />
        <XAxis type="number" dataKey="lfc" name="log2 fold change" tick={axisStyle} domain={[-4.2, 0.5]} label={{ value: "log2 fold change", position: "insideBottom", offset: -4, ...axisStyle }} />
        <YAxis type="number" dataKey="nlp" name="-log10 p" tick={axisStyle} label={{ value: "-log10 p", angle: -90, position: "insideLeft", ...axisStyle }} />
        <ReferenceLine x={-1} stroke="#d3dbe1" strokeDasharray="4 4" />
        <ReferenceLine y={2} stroke="#d3dbe1" strokeDasharray="4 4" />
        <Tooltip content={<HitTip />} cursor={{ strokeDasharray: "3 3" }} />
        <Scatter data={data} onClick={(d) => onSelect?.(d as unknown as Hit)} cursor="pointer">
          {data.map((d) => (
            <Cell key={d.gene} fill={verdictColor[d.verdict]} fillOpacity={d.verdict === "Uncertain" ? 0.5 : 0.85} />
          ))}
        </Scatter>
      </ScatterChart>
    </ChartFrame>
  );
}

export function DiscoveryMap({ hits, onSelect, height = 420 }: { hits: Hit[]; onSelect?: (h: Hit) => void; height?: number }) {
  return (
    <ChartFrame height={height}>
      <ScatterChart margin={{ top: 10, right: 16, bottom: 16, left: 0 }}>
        <ReferenceArea x1={0.5} x2={1} y1={0.5} y2={1} fill="#f87315" fillOpacity={0.06} />
        <ReferenceArea x1={0} x2={0.5} y1={0.5} y2={1} fill="#174f62" fillOpacity={0.05} />
        <CartesianGrid stroke={grid} strokeDasharray="3 3" />
        <XAxis type="number" dataKey="chance" domain={[0, 1]} tick={axisStyle} tickFormatter={(v) => `${Math.round(v * 100)}%`} label={{ value: "chance it's real →", position: "insideBottom", offset: -8, ...axisStyle }} />
        <YAxis type="number" dataKey="novelty" domain={[0, 1]} tick={axisStyle} tickFormatter={(v) => `${Math.round(v * 100)}%`} label={{ value: "how new it is →", angle: -90, position: "insideLeft", ...axisStyle }} />
        <ReferenceLine x={0.5} stroke="#d3dbe1" />
        <ReferenceLine y={0.5} stroke="#d3dbe1" />
        <Tooltip content={<HitTip />} cursor={{ strokeDasharray: "3 3" }} />
        <Scatter data={hits} onClick={(d) => onSelect?.(d as unknown as Hit)} cursor="pointer">
          {hits.map((d) => (
            <Cell key={d.gene} fill={verdictColor[d.verdict]} fillOpacity={0.85} />
          ))}
        </Scatter>
      </ScatterChart>
    </ChartFrame>
  );
}

export function QcBars({ samples, metric, label, threshold, height = 220, format = (v: number) => v.toFixed(2) }: {
  samples: Sample[];
  metric: keyof Sample;
  label: string;
  threshold?: number;
  height?: number;
  format?: (v: number) => string;
}) {
  const data = samples.map((s) => ({ name: s.label, value: Number(s[metric]), verdict: s.verdict }));
  return (
    <div>
      <div className="text-sm text-ink font-medium mb-2">{label}</div>
      <ChartFrame height={height}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke={grid} vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={axisStyle} interval={0} angle={-20} textAnchor="end" height={48} />
          <YAxis tick={axisStyle} tickFormatter={(v) => format(Number(v))} />
          {threshold !== undefined && <ReferenceLine y={threshold} stroke="#f87315" strokeDasharray="4 4" label={{ value: "threshold", position: "right", ...axisStyle }} />}
          <Tooltip formatter={(v) => format(Number(v))} contentStyle={{ borderRadius: 12, border: "1px solid #e6ebef", fontSize: 12 }} />
          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.verdict === "warn" ? "#f87315" : d.verdict === "fail" ? "#c8560d" : "#07b6d3"} />
            ))}
          </Bar>
        </BarChart>
      </ChartFrame>
    </div>
  );
}

export function CalibrationChart({ bins, height = 240 }: { bins: { bin: string; predicted: number; observed: number; n: number }[]; height?: number }) {
  return (
    <ChartFrame height={height}>
      <LineChart data={bins} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" />
        <XAxis dataKey="predicted" tick={axisStyle} tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`} type="number" domain={[0, 1]} />
        <YAxis tick={axisStyle} tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`} domain={[0, 1]} />
        <Tooltip
          formatter={(v, name) => [`${Math.round(Number(v) * 100)}%`, name === "observed" ? "Observed validated" : "Predicted"]}
          labelFormatter={(l) => `Predicted ${Math.round(Number(l) * 100)}%`}
          contentStyle={{ borderRadius: 12, border: "1px solid #e6ebef", fontSize: 12 }}
        />
        <Line type="linear" dataKey="predicted" stroke="#d3dbe1" strokeDasharray="4 4" dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="observed" stroke="#f87315" strokeWidth={2.5} dot={{ r: 4, fill: "#f87315", strokeWidth: 0 }} />
      </LineChart>
    </ChartFrame>
  );
}

export function RankChart({ hits, height = 220 }: { hits: Hit[]; height?: number }) {
  const data = [...hits].sort((a, b) => a.lfc - b.lfc).map((h, i) => ({ ...h, i }));
  return (
    <ChartFrame height={height}>
      <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: -10 }}>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" />
        <XAxis type="number" dataKey="i" tick={axisStyle} name="rank" />
        <YAxis type="number" dataKey="lfc" tick={axisStyle} name="LFC" />
        <Tooltip content={<HitTip />} />
        <Scatter data={data}>
          {data.map((d) => (
            <Cell key={d.gene} fill={verdictColor[d.verdict]} />
          ))}
        </Scatter>
      </ScatterChart>
    </ChartFrame>
  );
}
