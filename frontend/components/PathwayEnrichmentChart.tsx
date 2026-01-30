'use client';

import { useState, useCallback, useRef } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Download, Loader2, ChevronDown, ExternalLink } from 'lucide-react';
import { exportElementAsPNG } from '@/lib/chartExportUtils';
import { saveAs } from 'file-saver';
import {
  runPathwayEnrichment,
  ENRICHR_LIBRARIES,
  type EnrichmentResult,
  type EnrichmentTerm,
  type EnrichrLibraryId,
} from '@/lib/pathwayEnrichment';

interface PathwayEnrichmentChartProps {
  /** Gene symbols (e.g. significant hits) */
  genes: string[];
  /** Max terms to show in chart */
  topN?: number;
  /** P-value cutoff for display */
  pValueCutoff?: number;
  height?: number;
}

export default function PathwayEnrichmentChart({
  genes,
  topN = 10,
  pValueCutoff = 0.05,
  height = 480,
}: PathwayEnrichmentChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<EnrichmentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<EnrichrLibraryId>('GO_Biological_Process_2021');
  const [selectedTerm, setSelectedTerm] = useState<EnrichmentTerm | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const runAnalysis = useCallback(async () => {
    if (!genes.length) {
      setError('No genes provided');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setSelectedTerm(null);
    try {
      const res = await runPathwayEnrichment(genes, library);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enrichment failed');
    } finally {
      setLoading(false);
    }
  }, [genes, library]);

  const filteredTerms = result?.terms.filter((t) => t.adjustedPValue <= pValueCutoff) ?? [];
  const chartData = filteredTerms.slice(0, topN).map((t) => ({
    name: t.term.length > 55 ? t.term.slice(0, 52) + '...' : t.term,
    fullName: t.term,
    pValue: t.pValue,
    adjP: t.adjustedPValue,
    negLog10P: -Math.log10(Math.max(t.adjustedPValue, 1e-20)),
    overlap: t.overlap,
    term: t,
  }));

  const handleExportPNG = useCallback(async () => {
    setExportOpen(false);
    if (!containerRef.current) return;
    await exportElementAsPNG(containerRef.current, `splicr-pathways-${Date.now()}.png`);
  }, []);

  const handleExportCSV = useCallback(() => {
    setExportOpen(false);
    if (!result) return;
    const headers = ['Rank', 'Term', 'Overlap', 'P-value', 'Adjusted P-value', 'Genes'];
    const rows = result.terms.map((t, i) => [
      i + 1,
      `"${t.term.replace(/"/g, '""')}"`,
      t.overlap,
      t.pValue.toExponential(3),
      t.adjustedPValue.toExponential(3),
      `"${t.genes.join(', ')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    saveAs(blob, `splicr-pathways-${result.library}-${Date.now()}.csv`);
  }, [result]);

  return (
    <div ref={containerRef} className="w-full bg-surface rounded-xl p-6 border border-border shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <h3 className="text-2xl font-serif text-text-primary">Pathway enrichment</h3>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <select
              value={library}
              onChange={(e) => setLibrary(e.target.value as EnrichrLibraryId)}
              className="appearance-none pl-4 pr-8 py-2 rounded-lg border border-border bg-background text-text-primary min-w-[200px] focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              {ENRICHR_LIBRARIES.map((lib) => (
                <option key={lib.id} value={lib.id}>
                  {lib.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" />
          </div>
          <button
            onClick={runAnalysis}
            disabled={loading || genes.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-background hover:opacity-90 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Analyze pathways
          </button>
          {result && (
            <div className="relative">
              <button
                onClick={() => setExportOpen((o) => !o)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-background text-text-primary hover:bg-accent/10"
              >
                <Download className="w-4 h-4" /> Export
              </button>
              {exportOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 py-2 bg-surface border border-border rounded-lg shadow-elevated z-20 min-w-[140px]">
                    <button onClick={handleExportPNG} className="w-full px-4 py-2 text-left hover:bg-background text-sm">
                      PNG
                    </button>
                    <button onClick={handleExportCSV} className="w-full px-4 py-2 text-left hover:bg-background text-sm">
                      CSV
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 rounded-lg bg-error/10 text-error text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-10 h-10 animate-spin text-accent" />
        </div>
      )}

      {!loading && result && (
        <>
          <div style={{ height }} className="mb-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E6E3" />
                <XAxis type="number" dataKey="negLog10P" name="-Log₁₀(adj.P)" unit="" />
                <YAxis type="category" dataKey="name" width={280} tick={{ fontSize: 11 }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-surface p-4 rounded-lg shadow-lg border border-border max-w-md">
                        <p className="font-bold text-text-primary mb-1">{d.fullName}</p>
                        <p className="text-sm text-text-secondary">Overlap: {d.overlap}</p>
                        <p className="text-sm text-text-secondary">Adj. P-value: {d.adjP.toExponential(2)}</p>
                        <button
                          onClick={() => setSelectedTerm(d.term)}
                          className="mt-2 text-sm text-accent hover:underline"
                        >
                          Show genes
                        </button>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="negLog10P" fill="#6ABF36" radius={[0, 4, 4, 0]} onClick={(payload: unknown) => setSelectedTerm((payload as { term?: EnrichmentTerm })?.term ?? null)}>
                  {chartData.map((entry, index) => (
                    <Cell key={index} fill="#6ABF36" cursor="pointer" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {selectedTerm && (
            <div className="mt-4 p-4 rounded-lg bg-background border border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="font-serif text-text-primary">{selectedTerm.term}</span>
                <button onClick={() => setSelectedTerm(null)} className="text-text-tertiary hover:text-text-primary text-sm">
                  Close
                </button>
              </div>
              <p className="text-sm text-text-secondary mb-2">
                Genes in pathway: {selectedTerm.genes.join(', ')}
              </p>
              <a
                href={`https://maayanlab.cloud/Enrichr/enrich?dataset=${encodeURIComponent(selectedTerm.term)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
              >
                <ExternalLink className="w-4 h-4" /> View in Enrichr
              </a>
            </div>
          )}

          <p className="text-sm text-text-tertiary mt-2">
            Top {topN} pathways (adj. P ≤ {pValueCutoff}). Click a bar to see genes. Data: Enrichr (Maayan Lab).
          </p>
        </>
      )}

      {!loading && !result && genes.length > 0 && (
        <div className="py-12 text-center text-text-tertiary">
          Select a database and click &quot;Analyze pathways&quot; to run enrichment.
        </div>
      )}

      {genes.length === 0 && (
        <div className="py-12 text-center text-text-tertiary">
          Provide a list of significant genes to run pathway enrichment.
        </div>
      )}
    </div>
  );
}
