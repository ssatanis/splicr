/**
 * Journal presets for publication-ready figures and reports
 */

import type { JournalPreset, JournalPresetKey } from '@/types/report';

export const journalPresets: Record<JournalPresetKey, JournalPreset> = {
  nature: {
    journal_name: 'Nature',
    journal_category: 'high_impact',
    figure_specs: {
      dimensions: {
        single_column: { width: 88, unit: 'mm' },
        double_column: { width: 180, unit: 'mm' },
        max_height: { height: 230, unit: 'mm' },
      },
      resolution: { min: 300, recommended: 600, unit: 'dpi' },
      formats: ['tiff', 'eps', 'pdf'],
      color_mode: 'rgb',
      fonts: {
        family: 'Arial',
        min_size: 5,
        recommended_size: 7,
        panel_labels: { size: 8, weight: 'bold', case: 'lowercase' },
      },
      line_weights: { min: 0.5, recommended: 1.0, unit: 'pt' },
      panel_spacing: { recommended: 2, unit: 'mm' },
    },
    text_specs: {
      font_family: 'Times New Roman',
      font_size: 12,
      line_spacing: 2.0,
      margins: { top: 1, bottom: 1, left: 1, right: 1, unit: 'inch' },
      reference_style: 'nature',
    },
    guidelines_url: 'https://www.nature.com/documents/guide-to-preparing-final-artwork.pdf',
  },
  cell: {
    journal_name: 'Cell',
    journal_category: 'high_impact',
    figure_specs: {
      dimensions: {
        single_column: { width: 85, unit: 'mm' },
        double_column: { width: 180, unit: 'mm' },
        max_height: { height: 235, unit: 'mm' },
      },
      resolution: { min: 300, recommended: 600, unit: 'dpi' },
      formats: ['tiff', 'eps', 'pdf'],
      color_mode: 'rgb',
      fonts: {
        family: 'Arial',
        min_size: 6,
        recommended_size: 8,
        panel_labels: { size: 9, weight: 'bold', case: 'uppercase' },
      },
      line_weights: { min: 0.5, recommended: 1.5, unit: 'pt' },
    },
    text_specs: {
      font_family: 'Arial',
      font_size: 11,
      line_spacing: 1.5,
      margins: { top: 1, bottom: 1, left: 1, right: 1, unit: 'inch' },
      reference_style: 'cell',
    },
    guidelines_url: 'https://www.cell.com/figure-guidelines',
  },
  science: {
    journal_name: 'Science',
    journal_category: 'high_impact',
    figure_specs: {
      dimensions: {
        single_column: { width: 90, unit: 'mm' },
        double_column: { width: 190, unit: 'mm' },
        max_height: { height: 225, unit: 'mm' },
      },
      resolution: { min: 300, recommended: 600, unit: 'dpi' },
      formats: ['eps', 'pdf', 'ai'],
      color_mode: 'rgb',
      fonts: {
        family: 'Helvetica',
        min_size: 6,
        recommended_size: 8,
        panel_labels: { size: 8, weight: 'bold', case: 'uppercase' },
      },
      line_weights: { min: 0.25, recommended: 0.75, unit: 'pt' },
    },
    text_specs: {
      font_family: 'Times New Roman',
      font_size: 11,
      line_spacing: 2.0,
      margins: { top: 1, bottom: 1, left: 1, right: 1, unit: 'inch' },
      reference_style: 'science',
    },
    guidelines_url: 'https://www.science.org/content/page/instructions-preparing-final-files',
  },
  plos: {
    journal_name: 'PLOS ONE',
    journal_category: 'open_access',
    figure_specs: {
      dimensions: {
        single_column: { width: 83, unit: 'mm' },
        double_column: { width: 173, unit: 'mm' },
        max_height: { height: 235, unit: 'mm' },
      },
      resolution: { min: 300, recommended: 600, unit: 'dpi' },
      formats: ['tiff', 'eps', 'pdf'],
      color_mode: 'rgb',
      fonts: {
        family: 'Arial',
        min_size: 8,
        recommended_size: 10,
        panel_labels: { size: 10, weight: 'bold', case: 'uppercase' },
      },
    },
    text_specs: {
      font_family: 'Times New Roman',
      font_size: 12,
      line_spacing: 2.0,
      margins: { top: 1, bottom: 1, left: 1.25, right: 1.25, unit: 'inch' },
      reference_style: 'plos',
    },
    guidelines_url: 'https://journals.plos.org/plosone/s/figures',
  },
};

/** mm to pixels at given DPI (25.4 mm = 1 inch) */
export function mmToPx(mm: number, dpi: number): number {
  return (mm / 25.4) * dpi;
}

/** Pixel ratio for canvas export (72 = screen DPI baseline) */
export function dpiToPixelRatio(dpi: number): number {
  return dpi / 72;
}
