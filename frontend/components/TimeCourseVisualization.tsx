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
import { Play, Pause, Download, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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
  /** Timepoint labels (e.g. ['Day 0', 'Day 7', 'Day 14', 'Day 21']) */
  timepoints?: string[];
  /** Series per gene (values length must match timepoints) */
  series?: TimePointSeries[];
  /** If no series, build synthetic from top genes (e.g. from allGenes) */
  genes?: GeneResult[];
  /** Number of genes to show when using genes prop */
  maxGenes?: number;
  height?: number;
}

const DEFAULT_TIMEPOINTS = ['Day 0', 'Day 7', 'Day 14', 'Day 21'];

const COLORS = [
  '#EF4444', '#10B981', '#3B82F6', '#8B5CF6', '#F59E0B',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16',
];

function buildSyntheticSeries(genes: GeneResult[], timepoints: string[]): TimePointSeries[] {
  const n = timepoints.length;
  return genes.slice(0, 20).map((g, i) => {
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
}: TimeCourseVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [exportingGif, setExportingGif] = useState(false);

  const series = useMemo(() => {
    if (propSeries && propSeries.length > 0) return propSeries;
    if (genes.length > 0) return buildSyntheticSeries(genes, timepoints);
    return [];
  }, [propSeries, genes, timepoints]);

  const chartData = useMemo(() => {
    return timepoints.map((tp, i) => {
      const point: Record<string, string | number> = { timepoint: tp, index: i };
      series.forEach((s, j) => {
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

  if (series.length === 0) {
    return (
      <div className="w-full bg-surface rounded-xl p-6 border border-border shadow-card">
        <h3 className="text-2xl font-serif text-text-primary mb-4">Time-course visualization</h3>
        <div className="flex items-center justify-center rounded-lg border border-border bg-background text-text-tertiary" style={{ height: 320 }}>
          Provide <code className="px-1 bg-background rounded">series</code> or <code className="px-1 bg-background rounded">genes</code> to view time-course.
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full bg-surface rounded-xl p-6 border border-border shadow-card">
      <div className="mb-6">
        <h3 className="text-2xl font-serif text-text-primary mb-2">Time-course analysis</h3>
        <p className="text-sm text-text-secondary font-serif max-w-3xl">
          Track how guide RNA abundance changes over time in your CRISPR screen. This visualization reveals
          gene essentiality kinetics—showing which genes cause immediate cell death (steep drops), gradual fitness
          defects (steady decline), or delayed effects. Essential genes for cell survival typically show consistent
          depletion across timepoints.
        </p>
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
            data={visibleData}
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
              domain={['auto', 'auto']}
            />
            <Tooltip
              formatter={(value: number | undefined) => [value != null ? value.toFixed(3) : '', '']}
              labelFormatter={(label) => label}
            />
            <ReferenceLine y={0} stroke="#9B9B9B" strokeDasharray="3 3" />
            <Legend wrapperStyle={{ paddingTop: 10 }} />
            <AnimatePresence>
              {series.slice(0, maxGenes).map((s, i) => (
                <Line
                  key={s.gene}
                  type="monotone"
                  dataKey={s.gene}
                  name={s.gene}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                  isAnimationActive={true}
                />
              ))}
            </AnimatePresence>
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-4 text-sm text-text-tertiary">
        Use the slider or Play button to animate through timepoints. Export to PNG for static images or GIF for animations.
        Lines show log₂ fold-change relative to initial timepoint—steep negative slopes indicate essential genes.
      </p>
    </div>
  );
}
