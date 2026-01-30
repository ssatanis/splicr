'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import { Download, Loader2, ExternalLink } from 'lucide-react';
import { exportElementAsPNG } from '@/lib/chartExportUtils';
import {
  fetchDepMapScores,
  depMapGeneLink,
  getComparisonLabel,
  type DepMapGeneSummary,
} from '@/lib/depMapIntegration';
import type { GeneResult } from '@/lib/types';

interface DepMapComparisonProps {
  /** Genes with log2FC and FDR from screen */
  genes: GeneResult[];
  /** Max genes to compare */
  maxGenes?: number;
  height?: number;
}

interface Point {
  gene: string;
  log2FC: number;
  fdr: number;
  depMapScore: number | null;
  depMapScoreForPlot: number;
  label: string;
}

export default function DepMapComparison({
  genes,
  maxGenes = 100,
  height = 480,
}: DepMapComparisonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [depMapData, setDepMapData] = useState<DepMapGeneSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchScores, setFetchScores] = useState(false);

  const limited = genes.slice(0, maxGenes);
  const geneNamesStr = limited.map((g) => g.gene).join(',');

  useEffect(() => {
    if (!fetchScores || !geneNamesStr) return;
    let cancelled = false;
    setLoading(true);
    const names = geneNamesStr.split(',').filter(Boolean);
    fetchDepMapScores(names)
      .then((data) => {
        if (!cancelled) setDepMapData(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchScores, geneNamesStr]);

  const points: Point[] = limited.map((g) => {
    const dm = depMapData.find((d) => d.gene.toUpperCase() === g.gene.toUpperCase());
    const depMapScore = dm?.dependencyScore ?? dm?.meanDependency ?? null;
    return {
      gene: g.gene,
      log2FC: g.logFoldChange,
      fdr: g.fdr,
      depMapScore,
      label: getComparisonLabel(g.logFoldChange, depMapScore),
      // For scatter: use 0 when no DepMap score so point still plots on x-axis
      depMapScoreForPlot: depMapScore ?? 0,
    };
  });

  const hasDepMapScores = points.some((p) => p.depMapScore != null);

  const handleExportPNG = useCallback(async () => {
    if (!containerRef.current) return;
    await exportElementAsPNG(containerRef.current, `splicr-depmap-${Date.now()}.png`);
  }, []);

  return (
    <div ref={containerRef} className="w-full bg-surface rounded-xl p-6 border border-border shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <h3 className="text-2xl font-serif text-text-primary">DepMap comparison</h3>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setFetchScores(true)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-background text-text-primary hover:bg-accent/10 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Fetch DepMap scores
          </button>
          {points.length > 0 && (
            <button
              onClick={handleExportPNG}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-background text-text-primary hover:bg-accent/10"
            >
              <Download className="w-4 h-4" /> Export PNG
            </button>
          )}
        </div>
      </div>

      <p className="text-sm text-text-tertiary mb-4">
        Compare your screen hits to Cancer Dependency Map. Each point is a gene (your Log₂ FC vs DepMap dependency when available).
        &quot;Validated&quot;: depleted in your screen and essential in DepMap; &quot;Novel&quot;: depleted in your screen but not in DepMap.
      </p>

      {points.length > 0 && (
        <div style={{ height }} className="mb-6">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 20, bottom: 60, left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E6E3" />
              <XAxis
                type="number"
                dataKey="log2FC"
                name="Your Log₂ FC"
                label={{ value: 'Your Log₂ FC', position: 'insideBottom', offset: -10 }}
              />
              <YAxis
                type="number"
                dataKey="depMapScoreForPlot"
                name="DepMap dependency"
                label={{ value: 'DepMap dependency score', angle: -90, position: 'insideLeft' }}
                domain={hasDepMapScores ? ['auto', 'auto'] : [-0.1, 0.1]}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const p = payload[0].payload as Point;
                  return (
                    <div className="bg-surface p-4 rounded-lg shadow-lg border border-border">
                      <p className="font-bold text-text-primary">{p.gene}</p>
                      <p className="text-sm text-text-secondary">Your Log₂ FC: {p.log2FC.toFixed(3)}</p>
                      <p className="text-sm text-text-secondary">FDR: {p.fdr.toExponential(2)}</p>
                      {p.depMapScore != null && (
                        <p className="text-sm text-text-secondary">DepMap score: {p.depMapScore.toFixed(3)}</p>
                      )}
                      <p className="text-sm text-accent">{p.label}</p>
                      <a
                        href={depMapGeneLink(p.gene)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-accent hover:underline mt-1"
                      >
                        View in DepMap <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  );
                }}
              />
              {hasDepMapScores && <ReferenceLine y={-0.5} stroke="#9B9B9B" strokeDasharray="3 3" />}
              <ReferenceLine x={0} stroke="#9B9B9B" strokeDasharray="3 3" />
              <Scatter name="Genes" data={points} fill="#6ABF36">
                {points.map((entry, index) => (
                  <Cell
                    key={index}
                    fill={
                      entry.label === 'Validated' ? '#10B981' :
                      entry.label === 'Novel' ? '#EF4444' :
                      entry.label === 'Consistent' ? '#F59E0B' : '#9B9B9B'
                    }
                    stroke={entry.label !== '—' ? '#1A1A1A' : 'none'}
                    strokeWidth={entry.label !== '—' ? 1 : 0}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="overflow-x-auto border border-border rounded-lg max-h-64 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-background sticky top-0">
            <tr>
              <th className="px-4 py-2 text-left font-serif text-text-secondary">Gene</th>
              <th className="px-4 py-2 text-left font-serif text-text-secondary">Your Log₂ FC</th>
              <th className="px-4 py-2 text-left font-serif text-text-secondary">FDR</th>
              <th className="px-4 py-2 text-left font-serif text-text-secondary">DepMap</th>
            </tr>
          </thead>
          <tbody>
            {limited.map((g) => (
              <tr key={g.gene} className="border-t border-border hover:bg-background/50">
                <td className="px-4 py-2 font-medium text-text-primary">{g.gene}</td>
                <td className="px-4 py-2 text-text-primary">{g.logFoldChange.toFixed(3)}</td>
                <td className="px-4 py-2 text-text-secondary">{g.fdr.toExponential(2)}</td>
                <td className="px-4 py-2">
                  <a
                    href={depMapGeneLink(g.gene)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline inline-flex items-center gap-1"
                  >
                    View <ExternalLink className="w-3 h-3" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-6 mt-4 text-sm text-text-secondary">
        <span><span className="inline-block w-3 h-3 rounded-full bg-[#10B981] mr-1" /> Validated</span>
        <span><span className="inline-block w-3 h-3 rounded-full bg-[#EF4444] mr-1" /> Novel</span>
        <span><span className="inline-block w-3 h-3 rounded-full bg-[#F59E0B] mr-1" /> Consistent</span>
        <span><span className="inline-block w-3 h-3 rounded-full bg-[#9B9B9B] mr-1" /> Other</span>
      </div>
    </div>
  );
}
