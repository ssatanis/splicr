'use client';

import { useState, useCallback, useRef } from 'react';
import { Download, Loader2, ExternalLink, Filter } from 'lucide-react';
import { exportElementAsPNG } from '@/lib/chartExportUtils';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  fetchDrugGeneInteractions,
  drugBankLink,
  clinicalTrialsLink,
  pubChemLink,
  type DrugGeneInteraction,
} from '@/lib/drugGeneFinder';

interface DrugGeneInteractionTableProps {
  /** Gene symbols (e.g. significant hits) */
  genes: string[];
  /** Max interactions per gene */
  limitPerGene?: number;
}

export default function DrugGeneInteractionTable({
  genes,
  limitPerGene = 20,
}: DrugGeneInteractionTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [interactions, setInteractions] = useState<DrugGeneInteraction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterGene, setFilterGene] = useState<string>('');
  const [exportOpen, setExportOpen] = useState(false);

  const runSearch = useCallback(async () => {
    if (!genes.length) {
      setError('No genes provided');
      return;
    }
    setLoading(true);
    setError(null);
    setInteractions([]);
    try {
      const data = await fetchDrugGeneInteractions(genes, limitPerGene);
      setInteractions(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'DGIdb request failed');
    } finally {
      setLoading(false);
    }
  }, [genes, limitPerGene]);

  const filtered = filterGene
    ? interactions.filter((i) => i.gene.toUpperCase().includes(filterGene.toUpperCase()))
    : interactions;
  const uniqueGenes = [...new Set(interactions.map((i) => i.gene))].sort();

  const handleExportCSV = useCallback(() => {
    setExportOpen(false);
    const headers = ['Gene', 'Drug', 'Interaction types', 'Score', 'Sources', 'PMIDs'];
    const rows = interactions.map((i) => [
      i.gene,
      `"${i.drugName.replace(/"/g, '""')}"`,
      i.interactionTypes.join('; '),
      i.interactionScore ?? '',
      i.sources.join('; '),
      i.pmids.join(', '),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    saveAs(blob, `splicr-drug-gene-${Date.now()}.csv`);
  }, [interactions]);

  const handleExportPDF = useCallback(() => {
    setExportOpen(false);
    const pdf = new jsPDF('p', 'mm', 'a4');
    pdf.setFontSize(16);
    pdf.text('Drug–Gene Interactions (SplicR)', 14, 20);
    pdf.setFontSize(10);
    pdf.text(`Generated from ${genes.length} genes. Total interactions: ${interactions.length}.`, 14, 28);
    const tableData = interactions.slice(0, 100).map((i) => [
      i.gene,
      i.drugName,
      (i.interactionTypes ?? []).slice(0, 2).join(', ') || '—',
      i.interactionScore != null ? String(i.interactionScore) : '—',
    ]);
    autoTable(pdf, {
      startY: 36,
      head: [['Gene', 'Drug', 'Interaction type', 'Score']],
      body: tableData,
      theme: 'striped',
      styles: { fontSize: 9 },
    });
    pdf.save(`splicr-drug-gene-${Date.now()}.pdf`);
  }, [interactions, genes.length]);

  return (
    <div ref={containerRef} className="w-full bg-surface rounded-xl p-6 border border-border shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <h3 className="text-2xl font-serif text-text-primary">Drug–gene interactions</h3>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={runSearch}
            disabled={loading || genes.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-background hover:opacity-90 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Find drugs
          </button>
          {interactions.length > 0 && (
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
                    <button onClick={handleExportCSV} className="w-full px-4 py-2 text-left hover:bg-background text-sm">
                      CSV
                    </button>
                    <button onClick={handleExportPDF} className="w-full px-4 py-2 text-left hover:bg-background text-sm">
                      PDF report
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

      {!loading && interactions.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Filter className="w-4 h-4 text-text-tertiary" />
            <span className="text-sm text-text-secondary">Filter by gene:</span>
            <select
              value={filterGene}
              onChange={(e) => setFilterGene(e.target.value)}
              className="rounded border border-border bg-background text-text-primary text-sm px-3 py-1.5 min-w-[120px]"
            >
              <option value="">All genes</option>
              {uniqueGenes.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto max-h-[480px] overflow-y-auto border border-border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-background sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left font-serif text-text-secondary">Gene</th>
                  <th className="px-4 py-3 text-left font-serif text-text-secondary">Drug</th>
                  <th className="px-4 py-3 text-left font-serif text-text-secondary">Type</th>
                  <th className="px-4 py-3 text-left font-serif text-text-secondary">Score</th>
                  <th className="px-4 py-3 text-left font-serif text-text-secondary">Links</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, idx) => (
                  <tr key={idx} className="border-t border-border hover:bg-background/50">
                    <td className="px-4 py-2 font-medium text-text-primary">{row.gene}</td>
                    <td className="px-4 py-2 text-text-primary">{row.drugName}</td>
                    <td className="px-4 py-2 text-text-secondary">
                      {(row.interactionTypes ?? []).slice(0, 2).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-2 text-text-secondary">
                      {row.interactionScore != null ? row.interactionScore.toFixed(2) : '—'}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={drugBankLink(row.drugName)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline inline-flex items-center gap-0.5"
                        >
                          DrugBank <ExternalLink className="w-3 h-3" />
                        </a>
                        <a
                          href={clinicalTrialsLink(row.drugName)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline inline-flex items-center gap-0.5"
                        >
                          Trials <ExternalLink className="w-3 h-3" />
                        </a>
                        <a
                          href={pubChemLink(row.drugName)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline inline-flex items-center gap-0.5"
                        >
                          PubChem <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-sm text-text-tertiary mt-3">
            {filtered.length} interaction(s). Data: DGIdb. For approval status, check DrugBank or ClinicalTrials.gov.
          </p>
        </>
      )}

      {!loading && interactions.length === 0 && genes.length > 0 && (
        <div className="py-12 text-center text-text-tertiary">
          Click &quot;Find drugs&quot; to query DGIdb for drugs targeting your genes.
        </div>
      )}

      {genes.length === 0 && (
        <div className="py-12 text-center text-text-tertiary">
          Provide a list of significant genes to find drug–gene interactions.
        </div>
      )}
    </div>
  );
}
