import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

export interface ExportOptions {
  analysisName: string;
  library: string;
  method: string;
  results: Array<{ gene?: string; log2fc?: number; logFoldChange?: number; fdr?: number; pvalue?: number; pValue?: number }>;
  volcanoPlotElement?: HTMLElement | null;
  qcPlotsElements?: (HTMLElement | null)[];
}

export async function generatePDF(options: ExportOptions): Promise<Blob> {
  const pdf = new jsPDF('portrait', 'mm', 'a4');
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 20;

  // Page 1: Title and metadata
  pdf.setFillColor(106, 191, 54);
  pdf.rect(0, 0, pageWidth, 60, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(32);
  pdf.text('SplicR Analysis', pageWidth / 2, 30, { align: 'center' });
  pdf.setFontSize(16);
  pdf.text(options.analysisName || 'Analysis Report', pageWidth / 2, 45, { align: 'center' });

  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(12);
  let y = 80;
  pdf.text(`Library: ${options.library || '—'}`, margin, y);
  y += 8;
  pdf.text(`Method: ${options.method || '—'}`, margin, y);
  y += 8;
  pdf.text(`Generated: ${new Date().toLocaleString()}`, margin, y);

  // Page 2: Volcano plot (if provided)
  if (options.volcanoPlotElement) {
    try {
      const canvas = await html2canvas(options.volcanoPlotElement, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');
      pdf.addPage();
      const imgW = pageWidth - 2 * margin;
      const imgH = Math.min(140, (canvas.height / canvas.width) * imgW);
      pdf.addImage(imgData, 'PNG', margin, 30, imgW, imgH);
    } catch (e) {
      pdf.addPage();
      pdf.setFontSize(14);
      pdf.text('Volcano plot could not be captured.', margin, 50);
    }
  }

  // Additional pages: QC plots
  const qcElements = (options.qcPlotsElements ?? []).filter(Boolean) as HTMLElement[];
  for (const el of qcElements) {
    try {
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');
      pdf.addPage();
      const imgW = pageWidth - 2 * margin;
      const imgH = Math.min(180, (canvas.height / canvas.width) * imgW);
      pdf.addImage(imgData, 'PNG', margin, margin, imgW, imgH);
    } catch {
      pdf.addPage();
      pdf.setFontSize(12);
      pdf.text('QC plot could not be captured.', margin, 40);
    }
  }

  // Last page: Top 20 significant hits table
  const results = options.results ?? [];
  const lfcKey = (r: any) => r.log2fc ?? r.logFoldChange ?? 0;
  const fdrKey = (r: any) => r.fdr ?? r.pvalue ?? r.pValue ?? 1;
  const sorted = [...results]
    .filter((r) => r.gene != null)
    .sort((a, b) => fdrKey(a) - fdrKey(b));
  const top20 = sorted.slice(0, 20);

  pdf.addPage();
  pdf.setFontSize(16);
  pdf.text('Top 20 significant hits', margin, 25);
  pdf.setFontSize(10);
  let tableY = 35;
  const colW = [50, 45, 45];
  const headers = ['Gene', 'Log₂ FC', 'FDR'];
  pdf.setFont('helvetica', 'bold');
  pdf.text(headers[0], margin, tableY);
  pdf.text(headers[1], margin + colW[0], tableY);
  pdf.text(headers[2], margin + colW[0] + colW[1], tableY);
  tableY += 8;
  pdf.setFont('helvetica', 'normal');

  for (const row of top20) {
    const gene = String(row.gene ?? '');
    const lfc = typeof lfcKey(row) === 'number' ? lfcKey(row).toFixed(2) : '—';
    const fdr = typeof fdrKey(row) === 'number' ? fdrKey(row).toExponential(2) : '—';
    pdf.text(gene, margin, tableY);
    pdf.text(lfc, margin + colW[0], tableY);
    pdf.text(fdr, margin + colW[0] + colW[1], tableY);
    tableY += 6;
  }

  if (top20.length === 0) {
    pdf.text('No results to display.', margin, tableY);
  }

  return pdf.output('blob');
}
