'use client';

import { useRef, useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Download, ChevronDown, Grid3X3, BarChart3, Info } from 'lucide-react';
import { exportElementAsPNG } from '@/lib/chartExportUtils';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

type HeatmapMode = 'correlation' | 'counts';
type ColorScale = 'RdBu' | 'Viridis' | 'Blues' | 'Reds';

interface InteractiveHeatmapProps {
  /** Sample correlation matrix (samples x samples) */
  correlations?: number[][];
  /** Sample names (same order as correlations) */
  sampleNames?: string[];
  /** sgRNA or gene count matrix: rowId -> { sampleName: count } */
  countMatrix?: Record<string, Record<string, number>>;
  /** Optional gene/sgRNA labels for count matrix rows (if not using object keys) */
  rowLabels?: string[];
  /** Height in pixels */
  height?: number;
}

function hierarchicalOrder(
  matrix: number[][],
  linkage: 'average' | 'complete' | 'single' = 'average'
): number[] {
  const n = matrix.length;
  if (n <= 1) return Array.from({ length: n }, (_, i) => i);
  try {
    const Cluster = require('hierarchical-clustering');
    const distance = (a: number, b: number) => {
      if (a === b) return 0;
      const rowA = matrix[a] ?? [];
      const rowB = matrix[b] ?? [];
      let sum = 0;
      let count = 0;
      for (let i = 0; i < rowA.length; i++) {
        const va = rowA[i] ?? 0;
        const vb = rowB[i] ?? 0;
        sum += (va - vb) * (va - vb);
        count++;
      }
      return count > 0 ? Math.sqrt(sum / count) : 0;
    };
    const inst = Cluster({
      input: Array.from({ length: n }, (_, i) => i),
      distance: (a: number, b: number) => distance(a, b),
      linkage,
      minClusters: 1,
    });
    const levels = inst?.levels ?? [];
    if (!levels.length) return Array.from({ length: n }, (_, i) => i);
    const last = levels[levels.length - 1];
    const cluster0 = last?.clusters?.[0];
    if (!Array.isArray(cluster0)) return Array.from({ length: n }, (_, i) => i);
    return cluster0.flat();
  } catch {
    return Array.from({ length: n }, (_, i) => i);
  }
}

export default function InteractiveHeatmap({
  correlations = [],
  sampleNames = [],
  countMatrix = {},
  rowLabels,
  height = 560,
}: InteractiveHeatmapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<HeatmapMode>(
    correlations?.length > 0 ? 'correlation' : countMatrix && Object.keys(countMatrix).length > 0 ? 'counts' : 'correlation'
  );
  const [colorScale, setColorScale] = useState<ColorScale>('RdBu');
  const [exportOpen, setExportOpen] = useState(false);
  const [maxRows, setMaxRows] = useState(80);

  const hasCorrelation = correlations.length > 0 && sampleNames.length >= 2;
  const hasCounts = Object.keys(countMatrix).length > 0;

  const sampleNamesFromMatrix = useMemo(() => {
    if (Object.keys(countMatrix).length === 0) return [];
    const first = Object.values(countMatrix)[0];
    return first ? Object.keys(first) : [];
  }, [countMatrix]);

  const { plotData, xLabels, yLabels, layout, orderRow, orderCol } = useMemo(() => {
    if (mode === 'correlation' && hasCorrelation) {
      const names = sampleNames.length === correlations.length ? sampleNames : correlations.map((_, i) => `Sample ${i + 1}`);
      const order = hierarchicalOrder(correlations, 'average');
      const ordered = order.map((i) => order.map((j) => correlations[i][j]));
      const z = ordered;
      const x = order.map((i) => names[i]);
      const y = order.map((i) => names[i]);
      return {
        plotData: [
          {
            z,
            x,
            y,
            type: 'heatmap' as const,
            colorscale: colorScale === 'RdBu' ? 'RdBu' : colorScale === 'Viridis' ? 'Viridis' : colorScale === 'Blues' ? 'Blues' : 'Reds',
            zmin: -1,
            zmax: 1,
            hovertemplate: '%{x} vs %{y}<br>r = %{z:.3f}<extra></extra>',
          },
        ],
        xLabels: x,
        yLabels: y,
        layout: {
          title: 'Sample correlation matrix',
          xaxis: { side: 'bottom', tickangle: -45 },
          yaxis: { autorange: 'reversed' },
          margin: { t: 50, r: 80, b: 120, l: 120 },
          height,
          showlegend: false,
        },
        orderRow: undefined,
        orderCol: undefined,
      };
    }

    if (mode === 'counts' && hasCounts) {
      const samples = sampleNamesFromMatrix.length ? sampleNamesFromMatrix : Object.keys((Object.values(countMatrix)[0] as Record<string, number>) || {});
      const rowIds = rowLabels ?? Object.keys(countMatrix);
      const limited = rowIds.slice(0, maxRows);
      const matrix = limited.map((id) =>
        samples.map((s) => {
          const row = countMatrix[id];
          if (!row) return 0;
          const v = row[s];
          return typeof v === 'number' ? v : 0;
        })
      );
      const logMatrix = matrix.map((row) =>
        row.map((v) => (v <= 0 ? 0 : Math.log2(v + 1)))
      );
      const rowOrder = hierarchicalOrder(logMatrix, 'average');
      const colOrder = hierarchicalOrder(
        logMatrix[0]?.map((_, j) => logMatrix.map((row) => row[j])) ?? [],
        'average'
      );
      const orderedZ = rowOrder.map((i) => colOrder.map((j) => logMatrix[i][j]));
      const x = colOrder.map((j) => samples[j]);
      const y = rowOrder.map((i) => limited[i]);
      return {
        plotData: [
          {
            z: orderedZ,
            x,
            y,
            type: 'heatmap' as const,
            colorscale: colorScale === 'RdBu' ? 'Blues' : colorScale === 'Viridis' ? 'Viridis' : colorScale === 'Blues' ? 'Blues' : 'Reds',
            hovertemplate: '%{y} | %{x}<br>log₂(count+1) = %{z:.2f}<extra></extra>',
          },
        ],
        xLabels: x,
        yLabels: y,
        layout: {
          title: 'sgRNA / gene counts (log₂)',
          xaxis: { side: 'bottom', tickangle: -45 },
          yaxis: { autorange: 'reversed' },
          margin: { t: 50, r: 80, b: 120, l: 140 },
          height,
          showlegend: false,
        },
        orderRow: undefined,
        orderCol: undefined,
      };
    }

    const emptyZ = [[0, 0], [0, 0]];
    return {
      plotData: [
        {
          z: emptyZ,
          x: ['No data'],
          y: ['No data'],
          type: 'heatmap' as const,
          colorscale: 'Greys',
          hovertemplate: '%{x} | %{y}<extra></extra>',
        },
      ],
      xLabels: ['No data'],
      yLabels: ['No data'],
      layout: {
        title: 'Heatmap',
        margin: { t: 50, r: 80, b: 80, l: 80 },
        height,
        showlegend: false,
      },
      orderRow: undefined,
      orderCol: undefined,
    };
  }, [mode, hasCorrelation, hasCounts, correlations, sampleNames, countMatrix, sampleNamesFromMatrix, rowLabels, maxRows, colorScale, height]);

  const handleExportPNG = async () => {
    setExportOpen(false);
    if (!containerRef.current) return;
    await exportElementAsPNG(containerRef.current, `splicr-heatmap-${Date.now()}.png`);
  };

  return (
    <div ref={containerRef} className="w-full bg-surface rounded-xl p-6 border border-border shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <h3 className="text-2xl font-serif text-text-primary flex items-center gap-2">
          Interactive Heatmap
          <div className="group relative inline-block">
            <Info className="w-5 h-5 text-text-tertiary cursor-help" />
            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 p-2 bg-slate-800 text-white text-xs rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none text-center">
              Visualizes sample correlations or expression values. Use this to identify sample clustering and outliers.
              <div className="absolute left-1/2 -translate-x-1/2 top-full border-4 border-transparent border-t-slate-800"></div>
            </div>
          </div>
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          {hasCorrelation && hasCounts && (
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setMode('correlation')}
                className={`flex items-center gap-2 px-4 py-2 text-sm ${mode === 'correlation' ? 'bg-accent/20 text-text-primary' : 'bg-background text-text-secondary hover:bg-background/80'}`}
              >
                <Grid3X3 className="w-4 h-4" /> Correlation
              </button>
              <button
                onClick={() => setMode('counts')}
                className={`flex items-center gap-2 px-4 py-2 text-sm ${mode === 'counts' ? 'bg-accent/20 text-text-primary' : 'bg-background text-text-secondary hover:bg-background/80'}`}
              >
                <BarChart3 className="w-4 h-4" /> Counts
              </button>
            </div>
          )}
          <div className="relative">
            <select
              value={colorScale}
              onChange={(e) => setColorScale(e.target.value as ColorScale)}
              className="appearance-none pl-4 pr-8 py-2 rounded-lg border border-border bg-background text-text-primary cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              <option value="RdBu">RdBu (correlation)</option>
              <option value="Viridis">Viridis</option>
              <option value="Blues">Blues</option>
              <option value="Reds">Reds</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" />
          </div>
          {mode === 'counts' && hasCounts && (
            <div className="flex items-center gap-2">
              <label className="text-sm text-text-secondary">Max rows</label>
              <input
                type="number"
                min={20}
                max={500}
                value={maxRows}
                onChange={(e) => setMaxRows(Math.max(20, Math.min(500, parseInt(e.target.value, 10) || 80)))}
                className="w-20 px-2 py-1 rounded border border-border bg-background text-text-primary text-sm"
              />
            </div>
          )}
          <div className="relative">
            <button
              onClick={() => setExportOpen((o) => !o)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-background text-text-primary hover:bg-accent/10 transition-colors"
            >
              <Download className="w-4 h-4" /> Export
            </button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 top-full mt-1 py-2 bg-surface border border-border rounded-lg shadow-elevated z-20 min-w-[120px]">
                  <button onClick={handleExportPNG} className="w-full px-4 py-2 text-left hover:bg-background text-sm">
                    PNG
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="min-h-[400px]">
        {typeof window !== 'undefined' && (
          <Plot
            data={plotData}
            layout={{
              ...layout,
              font: { family: 'system-ui, sans-serif', size: 11 },
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent',
              margin: layout.margin,
            }}
            config={{
              responsive: true,
              displayModeBar: true,
              displaylogo: false,
              modeBarButtonsToRemove: ['lasso2d', 'select2d'],
              toImageButtonOptions: { format: 'png', filename: 'splicr-heatmap', scale: 2 },
            }}
            style={{ width: '100%' }}
            useResizeHandler
          />
        )}
      </div>
      <p className="mt-3 text-sm text-text-tertiary">
        {mode === 'correlation'
          ? 'Sample–sample correlation. Rows/columns reordered by hierarchical clustering (average linkage).'
          : 'Normalized counts (log₂(count+1)). Use Export for publication-ready PNG.'}
      </p>
    </div>
  );
}
