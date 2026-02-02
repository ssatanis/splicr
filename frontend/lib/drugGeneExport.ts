/**
 * Drug–gene finder export utilities for research-friendly formats.
 * CSV, TSV, PDF, JSON, and PMID list for reference managers.
 */

import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface DrugItem {
  name: string;
  conceptId: string | null;
  approved: boolean;
  antiNeoplastic?: boolean;
  interactionTypes: { type: string; directionality: string }[];
  sources: string[];
  pmids: string[];
}

export interface GeneDrugResult {
  gene: string;
  geneName: string;
  totalInteractions: number;
  drugs: DrugItem[];
}

export interface CombinationItem {
  drugA: string;
  drugB: string;
  targetedGenesA: string[];
  targetedGenesB: string[];
  mechanismA: string;
  mechanismB: string;
  synergyScore: number;
  rationale: string;
  evidenceStrength: string;
}

export interface DrugGeneExportData {
  results: GeneDrugResult[];
  summary: { totalGenes: number; totalDrugs: number; approvedDrugs: number };
  combinations: CombinationItem[];
  exportedAt: string;
}

/** Flat row for CSV/TSV: one row per gene–drug pair */
function buildFlatRows(results: GeneDrugResult[]): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  for (const row of results) {
    if ((row.drugs ?? []).length === 0) {
      rows.push({
        Gene: row.gene,
        'Gene name': row.geneName || row.gene,
        Drug: '—',
        'FDA approved': '—',
        'Interaction types': '—',
        Sources: '—',
        PMIDs: '—',
      });
      continue;
    }
    for (const drug of row.drugs) {
      rows.push({
        Gene: row.gene,
        'Gene name': row.geneName || row.gene,
        Drug: drug.name,
        'FDA approved': drug.approved ? 'Yes' : 'No',
        'Interaction types': (drug.interactionTypes ?? []).map((t) => t.type).filter(Boolean).join('; ') || '—',
        Sources: (drug.sources ?? []).join('; ') || '—',
        PMIDs: (drug.pmids ?? []).join(', ') || '—',
      });
    }
  }
  return rows;
}

function escapeCsvValue(val: string): string {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const ACCENT = [106, 191, 54] as [number, number, number]; // #6ABF36

/** Export drug–gene results as CSV (UTF-8 with BOM for Excel). */
export function exportDrugGeneCSV(
  results: GeneDrugResult[],
  filename = `splicr-drug-gene-${Date.now()}.csv`
): void {
  const rows = buildFlatRows(results);
  const headers = ['Gene', 'Gene name', 'Drug', 'FDA approved', 'Interaction types', 'Sources', 'PMIDs'];
  const line = (r: Record<string, string>) => headers.map((h) => escapeCsvValue(r[h] ?? '')).join(',');
  const csv = '\uFEFF' + [headers.join(','), ...rows.map(line)].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, filename);
}

/** Export as TSV (tab-separated, common in bioinformatics). */
export function exportDrugGeneTSV(
  results: GeneDrugResult[],
  filename = `splicr-drug-gene-${Date.now()}.tsv`
): void {
  const rows = buildFlatRows(results);
  const headers = ['Gene', 'Gene name', 'Drug', 'FDA approved', 'Interaction types', 'Sources', 'PMIDs'];
  const line = (r: Record<string, string>) => headers.map((h) => (r[h] ?? '').replace(/\t/g, ' ')).join('\t');
  const tsv = [headers.join('\t'), ...rows.map(line)].join('\r\n');
  const blob = new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' });
  saveAs(blob, filename);
}

/**
 * Export as JSON: individual drug–gene results (results) and predicted combinations (combinations).
 * Structure: { results, summary, combinations, exportedAt } for scripts and reproducibility.
 */
export function exportDrugGeneJSON(
  data: DrugGeneExportData,
  filename = `splicr-drug-gene-${Date.now()}.json`
): void {
  const payload: DrugGeneExportData = {
    results: data.results,
    summary: data.summary,
    combinations: data.combinations ?? [],
    exportedAt: data.exportedAt || new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  saveAs(blob, filename);
}

/** Export PMID list (one per line) for reference managers (Zotero, Mendeley, etc.). */
export function exportDrugGenePMIDList(
  results: GeneDrugResult[],
  filename = `splicr-drug-gene-pmids-${Date.now()}.txt`
): void {
  const pmids = new Set<string>();
  for (const row of results) {
    for (const drug of row.drugs ?? []) {
      (drug.pmids ?? []).forEach((p) => pmids.add(String(p).trim()));
    }
  }
  const text = [...pmids].filter(Boolean).join('\n');
  const blob = new Blob([text || 'No PMIDs found.'], { type: 'text/plain;charset=utf-8' });
  saveAs(blob, filename);
}

/** Export as PDF report (summary + tables, publication-style). */
export function exportDrugGenePDF(
  data: { results: GeneDrugResult[]; summary: { totalGenes: number; totalDrugs: number; approvedDrugs: number }; combinations: CombinationItem[] },
  options: { analysisName?: string } = {},
  filename = `splicr-drug-gene-report-${Date.now()}.pdf`
): void {
  const pdf = new jsPDF('portrait', 'mm', 'a4');
  const pageWidth = 210;
  const margin = 14;
  let y = margin;

  // Header band
  pdf.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2]);
  pdf.rect(0, 0, pageWidth, 36, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(20);
  pdf.text('Drug–Gene Finder Report', pageWidth / 2, 16, { align: 'center' });
  pdf.setFontSize(11);
  pdf.text('SplicR · CRISPR Screen Analysis', pageWidth / 2, 26, { align: 'center' });
  if (options.analysisName) {
    pdf.setFontSize(10);
    pdf.text(options.analysisName, pageWidth / 2, 32, { align: 'center' });
  }
  pdf.setTextColor(0, 0, 0);
  y = 44;

  // Summary
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Summary', margin, y);
  y += 8;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text(`Genes queried: ${data.summary.totalGenes}   ·   Total drugs: ${data.summary.totalDrugs}   ·   FDA approved: ${data.summary.approvedDrugs}   ·   Drug combinations: ${data.combinations.length}`, margin, y);
  y += 6;
  pdf.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
  y += 12;

  // Drug–gene table (first 80 rows to fit nicely)
  const flatRows = buildFlatRows(data.results);
  const tableRows = flatRows.slice(0, 80).map((r) => [
    r.Gene,
    r.Drug,
    r['FDA approved'],
    (r['Interaction types'] || '—').slice(0, 35),
    (r.PMIDs || '—').slice(0, 25),
  ]);
  autoTable(pdf, {
    startY: y,
    head: [['Gene', 'Drug', 'FDA', 'Interaction types', 'PMIDs']],
    body: tableRows,
    theme: 'striped',
    styles: { fontSize: 8 },
    headStyles: { fillColor: ACCENT, textColor: 255 },
    margin: { left: margin, right: margin },
  });
  const pdfWithTable = pdf as typeof pdf & { lastAutoTable?: { finalY: number } };
  y = (pdfWithTable.lastAutoTable?.finalY ?? y) + 10;

  // New page for combinations if any
  if (data.combinations.length > 0) {
    if (y > 250) {
      pdf.addPage();
      y = margin;
    }
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Predicted drug combinations', margin, y);
    y += 8;
    const comboRows = data.combinations.slice(0, 25).map((c) => [
      `${c.drugA} + ${c.drugB}`,
      c.synergyScore.toFixed(2),
      c.evidenceStrength,
      (c.targetedGenesA ?? []).join(', ') || '—',
      (c.targetedGenesB ?? []).join(', ') || '—',
    ]);
    autoTable(pdf, {
      startY: y,
      head: [['Combination', 'Synergy', 'Evidence', 'Targets A', 'Targets B']],
      body: comboRows,
      theme: 'striped',
      styles: { fontSize: 8 },
      headStyles: { fillColor: ACCENT, textColor: 255 },
      margin: { left: margin, right: margin },
    });
  }

  // Footer on first page
  pdf.setFontSize(8);
  pdf.setTextColor(120, 120, 120);
  pdf.text('Data source: DGIdb. FDA status: check DrugBank or ClinicalTrials.gov. SplicR — splicr.org', pageWidth / 2, 290, { align: 'center' });

  pdf.save(filename);
}
