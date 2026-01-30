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
        { type: 'text', text: ' genes with multiple sgRNAs per gene.' },
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
        { type: 'text', text: '. Significantly enriched or depleted genes were identified using an FDR threshold of ' },
        { type: 'text', text: '{{fdr_threshold}}' },
        { type: 'text', text: ' and a log₂ fold-change cutoff of ±' },
        { type: 'text', text: '{{lfc_threshold}}' },
        { type: 'text', text: '.' },
      ],
    },
  ],
};

export const defaultTemplates: ReportTemplate[] = [
  {
    name: 'Methods Section Template',
    description: 'Standard methods section for CRISPR screen analysis',
    category: 'methods',
    structure: METHODS_SECTION_TEMPLATE,
    placeholders: {
      library_name: { type: 'string', default: 'Brunello' },
      gene_count: { type: 'number', default: 19114 },
      analysis_method: { type: 'string', default: 'MAGeCK' },
      fdr_threshold: { type: 'number', default: 0.05 },
      lfc_threshold: { type: 'number', default: 1 },
    },
    journal_preset: 'nature',
    is_public: true,
  },
];
