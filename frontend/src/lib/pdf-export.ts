/**
 * Export TipTap editor content to high-quality PDF
 */

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

const MM_PER_INCH = 25.4;
const DEFAULT_DPI = 150; // balance quality/speed; use 300–600 for final

export interface PdfExportOptions {
  /** Target DPI for rasterization */
  dpi?: number;
  /** Page width in mm (e.g. Nature single column 88) */
  widthMm?: number;
  /** Page height in mm (default A4 height) */
  heightMm?: number;
  /** Filename */
  fileName?: string;
}

/**
 * Render an HTML element to PDF using html2canvas then jsPDF
 */
export async function exportElementToPdf(
  element: HTMLElement,
  options: PdfExportOptions = {}
): Promise<void> {
  const { dpi = DEFAULT_DPI, widthMm = 210, heightMm = 297, fileName = 'report.pdf' } = options;

  const scale = dpi / 96; // 96 = typical screen DPI
  const canvas = await html2canvas(element, {
    scale,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
  });

  const imgData = canvas.toDataURL('image/png', 1.0);
  const pdf = new jsPDF({
    orientation: widthMm > heightMm ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [widthMm, heightMm],
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgW = canvas.width;
  const imgH = canvas.height;
  const ratio = Math.min(pageWidth / imgW, pageHeight / imgH) * (25.4 / dpi) * (96 / 25.4);
  const w = imgW * ratio;
  const h = imgH * ratio;
  const x = (pageWidth - w) / 2;
  const y = (pageHeight - h) / 2;

  pdf.addImage(imgData, 'PNG', x, y, w, h);
  pdf.save(fileName);
}

/**
 * Export multiple pages (e.g. from TipTap wrapper divs)
 */
export async function exportHtmlPagesToPdf(
  pageElements: HTMLElement[],
  options: PdfExportOptions = {}
): Promise<void> {
  const { dpi = DEFAULT_DPI, fileName = 'report.pdf' } = options;
  const scale = dpi / 96;

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < pageElements.length; i++) {
    if (i > 0) pdf.addPage();
    const canvas = await html2canvas(pageElements[i], {
      scale,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });
    const imgData = canvas.toDataURL('image/png', 1.0);
    const imgW = canvas.width;
    const imgH = canvas.height;
    const ratio = Math.min(pageWidth / imgW, pageHeight / imgH) * (25.4 / dpi) * (96 / 25.4);
    pdf.addImage(imgData, 'PNG', 0, 0, pageWidth, imgH * ratio);
  }

  pdf.save(fileName);
}
