/**
 * Enhanced report templates for academic/research use
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
      content: [{ type: 'text', text: 'CRISPR Screen Design and Experimental Setup' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'A genome-wide CRISPR/Cas9 knockout screen was performed using the ' },
        { type: 'text', text: '{{library_name}}' },
        { type: 'text', text: ' sgRNA library, which targets ' },
        { type: 'text', text: '{{gene_count}}' },
        { type: 'text', text: ' protein-coding genes with multiple guide RNAs per gene to ensure robust target coverage. The library was designed to minimize off-target effects through' +
          ' stringent selection criteria based on predicted specificity scores and validated using computational tools for sgRNA efficacy prediction.' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'A total of ' },
        { type: 'text', text: '{{sample_count}}' },
        { type: 'text', text: ' biological samples were prepared and sequenced, comprising control (T0/baseline) and experimental (treatment/selection) conditions. Sample labeling: ' },
        { type: 'text', text: '{{sample_names}}' },
        { type: 'text', text: '. Each condition was processed with biological replicates to ensure statistical robustness and reproducibility.' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'High-Throughput Sequencing and Quality Assessment' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Deep sequencing of sgRNA cassettes was performed on an Illumina platform, generating ' },
        { type: 'text', text: '{{total_reads}}' },
        { type: 'text', text: ' total raw reads. Following adapter trimming and quality filtering (Q>30), reads were aligned to the reference sgRNA library with a mapping efficiency of ' },
        { type: 'text', text: '{{mapping_rate}}' },
        { type: 'text', text: ', indicating high-quality library preparation and sequencing. Mean library coverage was ' },
        { type: 'text', text: '{{library_coverage}}' },
        { type: 'text', text: ' reads per sgRNA, providing sufficient statistical power for downstream analysis.' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Quality control metrics revealed ' },
        { type: 'text', text: '{{zero_counts}}' },
        { type: 'text', text: ' sgRNAs with zero counts across all samples, representing ' +
          'either failed synthesis, low-efficiency guides, or critically essential targets eliminated during early passages. The Gini coefficient, a measure of sgRNA count inequality, was ' },
        { type: 'text', text: '{{gini_coefficient}}' },
        { type: 'text', text: ' (ideal range: 0.1-0.3), indicating balanced library representation without excessive skew toward highly abundant guides. Lorenz curves confirmed uniform distribution' +
          ' across the library, validating the absence of PCR amplification biases.' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Computational Analysis and Statistical Framework' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Sequencing reads were processed through the ' },
        { type: 'text', text: '{{analysis_method}}' },
        { type: 'text', text: ' analysis pipeline (Li et al., Genome Biology, 2014/2015), which employs a negative binomial model to account for overdispersion in count data' +
          ' and applies a modified robust rank aggregation (α-RRA) algorithm to combine multiple sgRNA' +
          ' scores into a single gene-level statistic. This approach minimizes false positives arising from individual guide effects while maintaining sensitivity to detect' +
          ' true biological hits.' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Read counts were normalized using ' },
        { type: 'text', text: '{{normalization_method}}' },
        { type: 'text', text: ' normalization to correct for sequencing depth variations between samples. A minimum threshold of ' },
        { type: 'text', text: '{{minimum_reads}}' },
        { type: 'text', text: ' reads per sgRNA was enforced to exclude lowly represented guides that could introduce noise.' +
          ' Gene-level significance was assessed using permutation-based false discovery rate (FDR) correction, with hits called at FDR < ' },
        { type: 'text', text: '{{fdr_threshold}}' },
        { type: 'text', text: ' and an effect size threshold of |log₂ fold-change| > ' },
        { type: 'text', text: '{{lfc_threshold}}' },
        { type: 'text', text: ' to ensure both statistical and biological significance. P-values were adjusted using the Benjamini-Hochberg procedure to control the expected proportion of false discoveries.' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Validation and Data Integration' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'To validate screen quality and biological relevance, significant hits were cross-referenced with curated databases including the Cancer Dependency Map (DepMap)' +
          ' for context-specific essentiality, Gene Ontology (GO) for functional enrichment, and KEGG/Reactome for pathway analysis. Known essential genes from DepMap' +
          ' served as positive controls to benchmark screen performance (precision-recall analysis). Enrichment analysis identified overrepresented biological processes,' +
          ' molecular functions, and cellular components among hit genes using hypergeometric tests with Benjamini-Hochberg correction (FDR < 0.05).' },
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
