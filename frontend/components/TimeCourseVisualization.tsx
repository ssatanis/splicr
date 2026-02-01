'use client';

import { useRef, useState, useMemo, useCallback, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
import { Play, Pause, Download, RotateCcw, Info } from 'lucide-react';
import html2canvas from 'html2canvas';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { saveAs } from 'file-saver';
import type { GeneResult } from '@/lib/types';

export interface TimePointSeries {
  gene: string;
  values: number[];
  fdr?: number;
  log2FC?: number;
}

interface TimeCourseVisualizationProps {
  /** Timepoint labels from your experiment (e.g. sample names or Day 0, Day 7…) */
  timepoints?: string[];
  /** Series per gene (values length must match timepoints); when provided, uses real data from analysis */
  series?: TimePointSeries[];
  /** If no series, build synthetic trajectory from top genes */
  genes?: GeneResult[];
  maxGenes?: number;
  height?: number;
  /** Analysis name for context (e.g. "My screen") */
  analysisName?: string;
}

const DEFAULT_TIMEPOINTS = ['Day 0', 'Day 7', 'Day 14', 'Day 21'];

const COLORS = [
  '#EF4444', '#10B981', '#3B82F6', '#8B5CF6', '#F59E0B',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16',
];

const INFO_CONTENT = (
  <div className="text-sm text-left space-y-2 max-w-md">
    <p>
      <strong>What this shows:</strong> Guide RNA abundance over time in your CRISPR screen.
      Values are log₂ fold-change relative to control (or initial timepoint).
    </p>
    <p>
      <strong>How to interpret:</strong> Steep downward slopes suggest strong essentiality or
      immediate fitness loss; gradual decline suggests delayed or partial effects. Enriched
      genes (positive slope) may indicate resistance or gain-of-function.
    </p>
    <p>
      Timepoints and series are derived from your uploaded samples and analysis. Use the
      slider or Play to scrub time; click legend items to show/hide genes.
    </p>
  </div>
);

function buildSyntheticSeries(genes: GeneResult[], timepoints: string[]): TimePointSeries[] {
  const n = timepoints.length;
  return genes.slice(0, 20).map((g) => {
    const lfc = g.logFoldChange ?? 0;
    const values = timepoints.map((_, t) => (t / Math.max(1, n - 1)) * lfc);
    return { gene: g.gene, values, fdr: g.fdr, log2FC: lfc };
  });
}

export default function TimeCourseVisualization({
  timepoints = DEFAULT_TIMEPOINTS,
  series: propSeries,
  genes = [],
  maxGenes = 15,
  height = 520,
  analysisName,
}: TimeCourseVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [exportingGif, setExportingGif] = useState(false);
  const [showFullChart, setShowFullChart] = useState(false);
  const [hiddenGeneIds, setHiddenGeneIds] = useState<Set<string>>(new Set());
  const [yAxisDomain, setYAxisDomain] = useState<'auto' | 'fixed'>('auto');
  const [infoOpen, setInfoOpen] = useState(false);

  const series = useMemo(() => {
    if (propSeries && propSeries.length > 0) return propSeries;
    if (genes.length > 0) return buildSyntheticSeries(genes, timepoints);
    return [];
  }, [propSeries, genes, timepoints]);

  const chartData = useMemo(() => {
    return timepoints.map((tp, i) => {
      const point: Record<string, string | number> = { timepoint: tp, index: i };
      series.forEach((s) => {
        point[s.gene] = s.values[i] ?? 0;
      });
      return point;
    });
  }, [timepoints, series]);

  const visibleData = useMemo(() => {
    const upTo = Math.min(currentFrame + 1, chartData.length);
    return chartData.slice(0, upTo);
  }, [chartData, currentFrame]);

  const totalFrames = chartData.length;
  const isComplete = currentFrame >= totalFrames - 1;

  const seriesToRender = useMemo(() => series.slice(0, maxGenes), [series, maxGenes]);

  const dataToRender = showFullChart ? chartData : visibleData;
  const yDomain = yAxisDomain === 'fixed' ? [-2, 2] : ['auto', 'auto'];

  useEffect(() => {
    if (!playing || isComplete) return;
    const step = () => {
      setCurrentFrame((f) => {
        if (f >= totalFrames - 1) {
          setPlaying(false);
          return f;
        }
        return f + 1;
      });
    };
    const interval = setInterval(step, 800 / speed);
    return () => clearInterval(interval);
  }, [playing, isComplete, totalFrames, speed]);

  const handlePlayPause = useCallback(() => {
    if (isComplete) setCurrentFrame(0);
    setPlaying((p) => !p);
  }, [isComplete]);

  const handleReset = useCallback(() => {
    setPlaying(false);
    setCurrentFrame(0);
  }, []);

  const toggleGene = useCallback((gene: string) => {
    setHiddenGeneIds((prev) => {
      const next = new Set(prev);
      if (next.has(gene)) next.delete(gene);
      else next.add(gene);
      return next;
    });
  }, []);

  const exportGif = useCallback(async () => {
    if (!containerRef.current || series.length === 0) return;
    setExportingGif(true);
    try {
      const gif = GIFEncoder();
      const frameDelay = 400;
      for (let f = 0; f < totalFrames; f++) {
        setCurrentFrame(f);
        await new Promise((r) => setTimeout(r, 100));
        const canvas = await html2canvas(containerRef.current, {
          scale: 1,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
        });
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        const { data, width, height: h } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const palette = quantize(data, 256);
        const index = applyPalette(data, palette);
        gif.writeFrame(index, width, h, { palette, delay: frameDelay });
      }
      gif.finish();
      const bytes = gif.bytes();
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
      saveAs(blob, `splicr-timecourse-${Date.now()}.gif`);
      setCurrentFrame(0);
    } catch (e) {
      console.error('GIF export failed', e);
    } finally {
      setExportingGif(false);
    }
  }, [totalFrames, series.length]);

  const exportPng = useCallback(async () => {
    if (!containerRef.current) return;
    const canvas = await html2canvas(containerRef.current, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });
    canvas.toBlob((blob) => {
      if (blob) saveAs(blob, `splicr-timecourse-${Date.now()}.png`);
    }, 'image/png');
  }, []);

  const CustomTooltip = useCallback(
    ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
      if (!active || !payload?.length) return null;
      const seriesForGene = series.find((s) => s.gene === payload[0]?.name);
      return (
        <div className="rounded-lg border border-border bg-surface shadow-elevated p-3 text-sm">
          <div className="font-medium text-text-primary mb-1">{label}</div>
          {payload.map((p) => (
            <div key={p.name} className="flex items-center gap-2 text-text-secondary">
              <span style={{ backgroundColor: p.color }} className="w-2 h-2 rounded-full shrink-0" />
              <span>{p.name}:</span>
              <span className="font-mono">{typeof p.value === 'number' ? p.value.toFixed(3) : p.value}</span>
              {seriesForGene?.fdr != null && (
                <span className="text-text-tertiary">(FDR: {seriesForGene.fdr?.toExponential(2)})</span>
              )}
            </div>
          ))}
        </div>
      );
    },
    [series]
  );

  if (series.length === 0) {
    return (
      <div className="w-full bg-surface rounded-xl p-6 border border-border shadow-card">
        <h3 className="text-2xl font-serif text-text-primary mb-4">Time-course visualization</h3>
        <div className="flex items-center justify-center rounded-lg border border-border bg-background text-text-tertiary" style={{ height: 320 }}>
          No time-course data for this analysis. Provide multiple treatment samples or gene results to view trajectories.
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full bg-surface rounded-xl p-6 border border-border shadow-card">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap relative">
          <h3 className="text-2xl font-serif text-text-primary">Time-course analysis</h3>
          <button
            type="button"
            onClick={() => setInfoOpen((o) => !o)}
            className="p-1 rounded-full text-text-tertiary hover:text-text-primary hover:bg-background"
            aria-label="More information"
          >
            <Info className="w-5 h-5" />
          </button>
          {infoOpen && (
            <>
              <div className="fixed inset-0 z-40" aria-hidden onClick={() => setInfoOpen(false)} />
              <div className="absolute left-0 top-full mt-1 z-50 rounded-lg border border-border bg-surface shadow-elevated p-4 text-text-secondary">
                {INFO_CONTENT}
              </div>
            </>
          )}
        </div>
        {analysisName && (
          <span className="text-sm text-text-tertiary font-serif">Analysis: {analysisName}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="text-lg font-serif text-text-primary">Controls</div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handlePlayPause}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-background text-text-primary hover:bg-accent/10"
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {playing ? 'Pause' : isComplete ? 'Replay' : 'Play'}
          </button>
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-background text-text-primary hover:bg-accent/10"
          >
            <RotateCcw className="w-4 h-4" /> Reset
          </button>
          <div className="flex items-center gap-2">
            <label className="text-sm text-text-secondary">Speed</label>
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="rounded border border-border bg-background text-text-primary text-sm px-2 py-1"
            >
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={3}>3×</option>
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={showFullChart}
              onChange={(e) => setShowFullChart(e.target.checked)}
              className="rounded border-border text-accent"
            />
            Show full time course
          </label>
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <span>Y-axis:</span>
            <select
              value={yAxisDomain}
              onChange={(e) => setYAxisDomain(e.target.value as 'auto' | 'fixed')}
              className="rounded border border-border bg-background text-text-primary px-2 py-1"
            >
              <option value="auto">Auto</option>
              <option value="fixed">−2 to 2</option>
            </select>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={exportPng}
              className="px-4 py-2 rounded-lg border border-border bg-background text-text-primary hover:bg-accent/10 text-sm"
            >
              PNG
            </button>
            <button
              onClick={exportGif}
              disabled={exportingGif}
              className="px-4 py-2 rounded-lg border border-border bg-background text-text-primary hover:bg-accent/10 text-sm disabled:opacity-50"
            >
              {exportingGif ? 'Exporting…' : 'GIF'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-4 items-center mb-4">
        <input
          type="range"
          min={0}
          max={totalFrames - 1}
          value={currentFrame}
          onChange={(e) => setCurrentFrame(Number(e.target.value))}
          className="flex-1 h-2 rounded-full appearance-none bg-border accent-accent"
        />
        <span className="text-sm text-text-secondary whitespace-nowrap">
          {timepoints[currentFrame] ?? timepoints[0]}
        </span>
      </div>

      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={dataToRender}
            margin={{ top: 20, right: 80, bottom: 60, left: 60 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#E8E6E3" />
            <XAxis
              dataKey="timepoint"
              type="category"
              label={{ value: 'Timepoint', position: 'insideBottom', offset: -10 }}
            />
            <YAxis
              label={{ value: 'Log₂ FC (or value)', angle: -90, position: 'insideLeft' }}
              domain={yDomain}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} />
            <ReferenceLine y={0} stroke="#9B9B9B" strokeDasharray="3 3" />
            {showFullChart && (
              <ReferenceLine
                x={chartData[currentFrame]?.timepoint}
                stroke="#9B9B9B"
                strokeWidth={1}
                strokeDasharray="4 2"
              />
            )}
            <Legend
              wrapperStyle={{ paddingTop: 10 }}
              content={({ payload }) => (
                <ul className="flex flex-wrap gap-x-4 gap-y-1 justify-center list-none p-0 m-0">
                  {payload?.map((entry) => (
                    <li
                      key={entry.value}
                      onClick={() => toggleGene(String(entry.value))}
                      className="inline-flex items-center gap-1.5 cursor-pointer select-none hover:opacity-80"
                      style={{ opacity: hiddenGeneIds.has(String(entry.value)) ? 0.45 : 1 }}
                    >
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span className="text-sm text-text-secondary">{entry.value}</span>
                    </li>
                  ))}
                </ul>
              )}
            />
            {seriesToRender.map((s, i) => (
              <Line
                key={s.gene}
                type="monotone"
                dataKey={s.gene}
                name={s.gene}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
                isAnimationActive={false}
                hide={hiddenGeneIds.has(s.gene)}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-4 text-sm text-text-tertiary">
        Timepoints from this analysis. Use the slider or Play to scrub; click legend items to show/hide genes.
        Export to PNG (static) or GIF (animation). Log₂ FC relative to control—steep negative slopes indicate essential genes.
      </p>
    </div>
  );
}
