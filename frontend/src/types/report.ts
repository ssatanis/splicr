/**
 * Types for publication-ready outputs: Report Builder & Figure Customization
 */

export type JournalPresetKey = 'nature' | 'cell' | 'science' | 'plos';

export interface JournalFigureSpecs {
  dimensions: {
    single_column: { width: number; unit: string };
    double_column?: { width: number; unit: string };
    max_height?: { height: number; unit: string };
  };
  resolution: { min: number; recommended: number; unit: string };
  formats: string[];
  color_mode: string;
  fonts: {
    family: string;
    min_size: number;
    recommended_size: number;
    panel_labels?: { size: number; weight: string; case: string };
  };
  line_weights?: { min: number; recommended: number; unit: string };
  panel_spacing?: { recommended: number; unit: string };
}

export interface JournalTextSpecs {
  font_family: string;
  font_size: number;
  line_spacing: number;
  margins?: { top: number; bottom: number; left: number; right: number; unit: string };
  reference_style?: string;
}

export interface JournalPreset {
  journal_name: string;
  journal_category: string;
  figure_specs: JournalFigureSpecs;
  text_specs: JournalTextSpecs;
  guidelines_url?: string;
}

export interface ReportTemplate {
  id?: string;
  name: string;
  description?: string;
  category: string;
  structure: TipTapDoc;
  placeholders?: Record<string, { type: string; default?: string | number }>;
  journal_preset?: string;
  is_public?: boolean;
}

export interface TipTapDoc {
  type: 'doc';
  content?: TipTapNode[];
}

export type TipTapNode =
  | { type: 'heading'; attrs?: { level: number }; content?: TipTapNode[] }
  | { type: 'paragraph'; content?: TipTapNode[] }
  | { type: 'text'; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] }
  | { type: 'hardBreak' }
  | { type: 'bulletList'; content?: TipTapNode[] }
  | { type: 'listItem'; content?: TipTapNode[] }
  | { type: 'image'; attrs: { src: string; alt?: string; title?: string } }
  | { type: string; attrs?: Record<string, unknown>; content?: TipTapNode[] };

export interface FigureCustomizationState {
  canvas: { width: number; height: number; dpi: number };
  layers?: Array<{ name: string; objects: unknown[] }>;
  theme?: string;
  colors?: Record<string, string>;
  fonts?: Record<string, string>;
}

export interface VolcanoPlotPoint {
  gene: string;
  log2FC: number;
  negLog10P: number;
  fdr: number;
  isSignificant: boolean;
}

export interface AnalysisContextForReport {
  analysisName: string;
  libraryName: string;
  method: string;
  totalGenes: number;
  significantHits: number;
  enriched: number;
  depleted: number;
  fdrThreshold: number;
  lfcThreshold: number;
  topDepleted?: Array<{ gene: string; logFoldChange: number; fdr: number }>;
  topEnriched?: Array<{ gene: string; logFoldChange: number; fdr: number }>;
  // Additional fields for comprehensive reporting
  createdDate?: string;
  completedDate?: string;
  sampleCount?: number;
  sampleNames?: string;
  controlSamples?: string;
  treatmentSamples?: string;
  totalReads?: string;
  mappingRate?: string;
  libraryCoverage?: string;
  zeroCounts?: string;
  giniCoefficient?: string;
  normalizationMethod?: string;
  minimumReads?: number;
  resultsSource?: string;
}
