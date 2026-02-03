/**
 * Default report templates (used when Supabase report_templates not available)
 */

import type { ReportTemplate, TipTapDoc } from '@/types/report';

export const METHODS_SECTION_TEMPLATE: TipTapDoc = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Materials and Methods' }],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'CRISPR Screen Design' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The genome-wide CRISPR screen was performed using the ' },
        { type: 'text', text: '{{library_name}}' },
        { type: 'text', text: ' library, containing sgRNAs targeting ' },
        { type: 'text', text: '{{gene_count}}' },
        { type: 'text', text: ' genes with multiple sgRNAs per gene. A total of ' },
        { type: 'text', text: '{{sample_count}}' },
        { type: 'text', text: ' samples were sequenced, including control and treatment conditions.' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Sequencing and Quality Control' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Deep sequencing was performed, yielding ' },
        { type: 'text', text: '{{total_reads}}' },
        { type: 'text', text: ' total reads with a mapping rate of ' },
        { type: 'text', text: '{{mapping_rate}}' },
        { type: 'text', text: '. Library coverage was ' },
        { type: 'text', text: '{{library_coverage}}' },
        { type: 'text', text: ', with ' },
        { type: 'text', text: '{{zero_counts}}' },
        { type: 'text', text: ' zero-count sgRNAs. The Gini coefficient was ' },
        { type: 'text', text: '{{gini_coefficient}}' },
        { type: 'text', text: ', indicating good library representation.' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Data Analysis' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Sequencing reads were aligned and analyzed using ' },
        { type: 'text', text: '{{analysis_method}}' },
        { type: 'text', text: '. Read counts were normalized using ' },
        { type: 'text', text: '{{normalization_method}}' },
        { type: 'text', text: ' normalization, with a minimum read threshold of ' },
        { type: 'text', text: '{{minimum_reads}}' },
        { type: 'text', text: ' reads per sgRNA. Significantly enriched or depleted genes were identified using an FDR threshold of ' },
        { type: 'text', text: '{{fdr_threshold}}' },
        { type: 'text', text: ' and a log₂ fold-change cutoff of ±' },
        { type: 'text', text: '{{lfc_threshold}}' },
        { type: 'text', text: '.' },
      ],
    },
  ],
};

export const RESULTS_SECTION_TEMPLATE: TipTapDoc = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Results' }],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Screen Overview' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The CRISPR screen "' },
        { type: 'text', text: '{{analysis_name}}' },
        { type: 'text', text: '" was conducted between ' },
        { type: 'text', text: '{{created_date}}' },
        { type: 'text', text: ' and ' },
        { type: 'text', text: '{{completed_date}}' },
        { type: 'text', text: '. Analysis of ' },
        { type: 'text', text: '{{gene_count}}' },
        { type: 'text', text: ' genes identified ' },
        { type: 'text', text: '{{significant_hits}}' },
        { type: 'text', text: ' significant hits (FDR < ' },
        { type: 'text', text: '{{fdr_threshold}}' },
        { type: 'text', text: '), including ' },
        { type: 'text', text: '{{enriched}}' },
        { type: 'text', text: ' enriched genes and ' },
        { type: 'text', text: '{{depleted}}' },
        { type: 'text', text: ' depleted genes.' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Sample Information' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Control samples: ' },
        { type: 'text', text: '{{control_samples}}' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Treatment samples: ' },
        { type: 'text', text: '{{treatment_samples}}' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Top Depleted Genes' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The following genes showed significant depletion, suggesting essential or growth-promoting functions...' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Top Enriched Genes' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'These genes were significantly enriched, potentially indicating tumor suppressor or growth-inhibitory roles...' },
      ],
    },
  ],
};

export const COMPLETE_REPORT_TEMPLATE: TipTapDoc = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '{{analysis_name}}' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Analysis completed: ' },
        { type: 'text', text: '{{completed_date}}' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Summary' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'This report summarizes the results of a genome-wide CRISPR screen performed using the ' },
        { type: 'text', text: '{{library_name}}' },
        { type: 'text', text: ' library and analyzed with ' },
        { type: 'text', text: '{{analysis_method}}' },
        { type: 'text', text: '. The screen identified ' },
        { type: 'text', text: '{{significant_hits}}' },
        { type: 'text', text: ' significant genes out of ' },
        { type: 'text', text: '{{gene_count}}' },
        { type: 'text', text: ' genes analyzed.' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Key Findings' }],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: '{{enriched}}' },
                { type: 'text', text: ' genes were significantly enriched (potential tumor suppressors)' },
              ],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: '{{depleted}}' },
                { type: 'text', text: ' genes were significantly depleted (potential essential genes)' },
              ],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Library coverage: ' },
                { type: 'text', text: '{{library_coverage}}' },
              ],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Sequencing depth: ' },
                { type: 'text', text: '{{total_reads}}' },
                { type: 'text', text: ' reads' },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Materials and Methods' }],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Experimental Design' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The screen included ' },
        { type: 'text', text: '{{sample_count}}' },
        { type: 'text', text: ' samples across control and treatment conditions. Control samples: ' },
        { type: 'text', text: '{{control_samples}}' },
        { type: 'text', text: '. Treatment samples: ' },
        { type: 'text', text: '{{treatment_samples}}' },
        { type: 'text', text: '.' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Quality Control' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Sequencing yielded ' },
        { type: 'text', text: '{{total_reads}}' },
        { type: 'text', text: ' total reads with ' },
        { type: 'text', text: '{{mapping_rate}}' },
        { type: 'text', text: ' mapping rate. Zero-count sgRNAs: ' },
        { type: 'text', text: '{{zero_counts}}' },
        { type: 'text', text: '. Gini coefficient: ' },
        { type: 'text', text: '{{gini_coefficient}}' },
        { type: 'text', text: '.' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Statistical Analysis' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Read counts were normalized using ' },
        { type: 'text', text: '{{normalization_method}}' },
        { type: 'text', text: ' normalization with a minimum threshold of ' },
        { type: 'text', text: '{{minimum_reads}}' },
        { type: 'text', text: ' reads per sgRNA. Gene-level statistics were computed using ' },
        { type: 'text', text: '{{analysis_method}}' },
        { type: 'text', text: '. Hits were called at FDR < ' },
        { type: 'text', text: '{{fdr_threshold}}' },
        { type: 'text', text: ' and |log₂FC| > ' },
        { type: 'text', text: '{{lfc_threshold}}' },
        { type: 'text', text: '.' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Results' }],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Top Depleted Genes' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The analysis identified genes showing significant depletion, suggesting essential or fitness-promoting roles. These genes represent potential therapeutic targets or critical cellular dependencies.' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Top Enriched Genes' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Significantly enriched genes may represent tumor suppressors or growth-inhibitory factors. Loss of these genes confers a selective advantage under the experimental conditions.' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Discussion' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'This CRISPR screen successfully identified ' },
        { type: 'text', text: '{{significant_hits}}' },
        { type: 'text', text: ' genes with significant phenotypic effects. The high quality metrics (mapping rate: ' },
        { type: 'text', text: '{{mapping_rate}}' },
        { type: 'text', text: ', coverage: ' },
        { type: 'text', text: '{{library_coverage}}' },
        { type: 'text', text: ') support the reliability of these findings. Further validation and mechanistic studies of the top hits are warranted.' },
      ],
    },
  ],
};

export const defaultTemplates: ReportTemplate[] = [
  {
    name: 'Complete Report',
    description: 'Full report with methods, results, and QC metrics',
    category: 'full-report',
    structure: COMPLETE_REPORT_TEMPLATE,
    placeholders: {
      analysis_name: { type: 'string', default: 'Screen Analysis' },
      library_name: { type: 'string', default: 'Brunello' },
      gene_count: { type: 'number', default: 19114 },
      analysis_method: { type: 'string', default: 'MAGeCK' },
      fdr_threshold: { type: 'number', default: 0.05 },
      lfc_threshold: { type: 'number', default: 1 },
      significant_hits: { type: 'number', default: 0 },
      enriched: { type: 'number', default: 0 },
      depleted: { type: 'number', default: 0 },
      sample_count: { type: 'number', default: 0 },
      total_reads: { type: 'string', default: 'N/A' },
      mapping_rate: { type: 'string', default: 'N/A' },
      library_coverage: { type: 'string', default: 'N/A' },
      created_date: { type: 'string', default: 'N/A' },
      completed_date: { type: 'string', default: 'N/A' },
    },
    journal_preset: 'nature',
    is_public: true,
  },
  {
    name: 'Results Section',
    description: 'Results section with screen overview and key findings',
    category: 'results',
    structure: RESULTS_SECTION_TEMPLATE,
    placeholders: {
      analysis_name: { type: 'string', default: 'Screen Analysis' },
      gene_count: { type: 'number', default: 19114 },
      significant_hits: { type: 'number', default: 0 },
      enriched: { type: 'number', default: 0 },
      depleted: { type: 'number', default: 0 },
      fdr_threshold: { type: 'number', default: 0.05 },
      created_date: { type: 'string', default: 'N/A' },
      completed_date: { type: 'string', default: 'N/A' },
      control_samples: { type: 'string', default: 'N/A' },
      treatment_samples: { type: 'string', default: 'N/A' },
    },
    journal_preset: 'nature',
    is_public: true,
  },
  {
    name: 'Methods Section',
    description: 'Comprehensive methods section with QC metrics',
    category: 'methods',
    structure: METHODS_SECTION_TEMPLATE,
    placeholders: {
      library_name: { type: 'string', default: 'Brunello' },
      gene_count: { type: 'number', default: 19114 },
      analysis_method: { type: 'string', default: 'MAGeCK' },
      fdr_threshold: { type: 'number', default: 0.05 },
      lfc_threshold: { type: 'number', default: 1 },
      sample_count: { type: 'number', default: 0 },
      total_reads: { type: 'string', default: 'N/A' },
      mapping_rate: { type: 'string', default: 'N/A' },
      library_coverage: { type: 'string', default: 'N/A' },
      zero_counts: { type: 'string', default: 'N/A' },
      gini_coefficient: { type: 'string', default: 'N/A' },
      normalization_method: { type: 'string', default: 'median' },
      minimum_reads: { type: 'number', default: 30 },
    },
    journal_preset: 'nature',
    is_public: true,
  },
];
