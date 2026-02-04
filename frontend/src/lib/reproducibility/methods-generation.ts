/**
 * Methods Text Generation System
 *
 * Auto-generates publication-ready methods sections based on analysis
 * parameters, provenance, and templates. Supports multiple citation styles
 * and journal formats.
 */

import { createClient } from '@/lib/supabase/server';
import {
  AnalysisMethod,
  MethodsTemplate,
  Citation,
  CitationStyle,
  MethodsSections,
  GenerateMethodsRequest,
  GenerateMethodsResponse,
  AnalysisParameters,
  AnalysisVersion,
  Analysis,
} from '@/lib/types';
import { getAnalysisVersion, getCurrentVersion } from './versions';
import { getProvActivities } from './provenance';

// =============================================================================
// METHODS GENERATION
// =============================================================================

/**
 * Generate methods text for an analysis
 */
export async function generateMethodsText(
  request: GenerateMethodsRequest
): Promise<GenerateMethodsResponse> {
  const supabase = await createClient();

  // Get analysis details
  const { data: analysis } = await supabase
    .from('analyses')
    .select('*')
    .eq('id', request.analysis_id)
    .single();

  if (!analysis) {
    throw new Error('Analysis not found');
  }

  // Get version (current or specified)
  let version: AnalysisVersion;
  if (request.version_id) {
    version = await getAnalysisVersion(request.analysis_id, request.version_id);
  } else {
    version = await getCurrentVersion(request.analysis_id);
  }

  // Get template (specified or default)
  const template = await getMethodsTemplate(request.template_name || 'crispr_screen_default');

  // Get provenance activities for this analysis
  const activities = await getProvActivities(request.analysis_id, version.id);

  // Extract variables from analysis
  const variables = extractVariables(analysis, version, activities, request.custom_variables);

  // Fill template with variables
  const sections = fillTemplate(template, variables);

  // Generate citations
  const citations = generateCitations(version, activities);

  // Combine sections into full text
  const generated_text = generateFullText(sections, citations, request.citation_style || 'apa');

  // Create methods record
  const methodsRecord = {
    analysis_id: request.analysis_id,
    version_id: version.id,
    generated_text,
    edited_text: null,
    is_edited: false,
    template_name: template.name,
    citation_style: request.citation_style || 'apa',
    sections,
    citations,
    export_formats: { plain: true, word: false, latex: false },
    version: 1,
    parent_methods_id: null,
  };

  const { data: methods, error } = await (supabase as any)
    .from('analysis_methods')
    .insert(methodsRecord)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create methods record: ${error.message}`);
  }

  // Check for missing variables
  const missing_variables = findMissingVariables(template, variables);

  return {
    methods: methods as AnalysisMethod,
    missing_variables,
    warnings: missing_variables.length > 0
      ? ['Some template variables could not be filled. Please review and edit manually.']
      : [],
  };
}

/**
 * Extract variables from analysis for template filling
 */
function extractVariables(
  analysis: any,
  version: AnalysisVersion,
  activities: any[],
  customVariables?: Record<string, string>
): Record<string, string> {
  const params = version.snapshot_data.parameters as AnalysisParameters;
  const library = version.library_info;

  const variables: Record<string, string> = {
    // SplicR version
    splicr_version: version.software_environment.splicr_version,

    // Library information
    library_name: library.library,
    guide_count: library.guide_count?.toString() || 'N',
    gene_count: library.gene_count?.toString() || 'M',

    // Sequencing information (from sample stats if available)
    platform: 'Illumina',
    read_count: version.results_snapshot?.qcMetrics?.totalReads
      ? (version.results_snapshot.qcMetrics.totalReads / 1_000_000).toFixed(1)
      : 'X',

    // MAGeCK version
    mageck_version: version.software_environment.mageck_version || '0.5.9.4',

    // Processing parameters
    mismatch_allowed: '1',
    normalization_method: params.normalizationMethod,

    // QC metrics
    read_depth_range: version.results_snapshot?.qcMetrics?.sampleStats
      ? `${Math.min(...version.results_snapshot.qcMetrics.sampleStats.map((s: any) => s.totalReads))}-${Math.max(...version.results_snapshot.qcMetrics.sampleStats.map((s: any) => s.totalReads))}`
      : 'varies',
    gini_value: version.results_snapshot?.qcMetrics?.giniCoefficient?.toFixed(3) || 'calculated',
    correlation: version.results_snapshot?.qcMetrics?.correlations
      ? calculateMeanCorrelation(version.results_snapshot.qcMetrics.correlations).toFixed(2)
      : '> 0.8',

    // Statistical analysis
    algorithm: getAlgorithmNames(analysis.method),
    fdr_threshold: params.fdrThreshold.toString(),
    fc_threshold: params.lfcThreshold.toString(),
    essential_gene_list: params.essentialGenes || 'CEG2',

    // Data availability
    repository: 'TBD', // User should fill this
    accession_id: 'TBD', // User should fill this
    url: `https://splicr.org/analysis/${analysis.id}`,
    analysis_id: analysis.id,

    // Custom variables override
    ...customVariables,
  };

  return variables;
}

/**
 * Get algorithm names as human-readable string
 */
function getAlgorithmNames(methods: string[]): string {
  const algorithmMap: Record<string, string> = {
    mageck: 'MAGeCK-RRA',
    bagel2: 'BAGEL2',
    drugz: 'DrugZ',
  };

  const names = methods.map((m) => algorithmMap[m] || m);

  if (names.length === 1) return names[0];
  if (names.length === 2) return names.join(' and ');
  return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
}

/**
 * Calculate mean correlation from correlation matrix
 */
function calculateMeanCorrelation(correlations: number[][]): number {
  let sum = 0;
  let count = 0;

  for (let i = 0; i < correlations.length; i++) {
    for (let j = i + 1; j < correlations[i].length; j++) {
      sum += correlations[i][j];
      count++;
    }
  }

  return count > 0 ? sum / count : 0;
}

/**
 * Fill template sections with variables
 */
function fillTemplate(
  template: MethodsTemplate,
  variables: Record<string, string>
): MethodsSections {
  const sections: MethodsSections = {};

  Object.entries(template.template_content.sections).forEach(([sectionName, sectionContent]) => {
    let text = sectionContent.template;

    // Replace all {{variable}} placeholders
    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      text = text.replace(regex, value);
    });

    sections[sectionName] = text;
  });

  return sections;
}

/**
 * Find variables that weren't filled
 */
function findMissingVariables(
  template: MethodsTemplate,
  variables: Record<string, string>
): string[] {
  const missing: Set<string> = new Set();

  Object.values(template.template_content.sections).forEach((section) => {
    const matches = section.template.match(/\{\{([^}]+)\}\}/g);
    if (matches) {
      matches.forEach((match) => {
        const varName = match.slice(2, -2);
        if (!variables[varName] || variables[varName] === 'TBD' || variables[varName] === 'N') {
          missing.add(varName);
        }
      });
    }
  });

  return Array.from(missing);
}

/**
 * Generate citations for software and algorithms used
 */
function generateCitations(version: AnalysisVersion, activities: any[]): Citation[] {
  const citations: Citation[] = [];

  // SplicR citation
  citations.push({
    type: 'software',
    title: 'SplicR: Web-based platform for CRISPR screening analysis',
    authors: ['SplicR Team'],
    year: 2026,
    url: 'https://splicr.org',
    version: version.software_environment.splicr_version,
  });

  // MAGeCK citation
  if (version.software_environment.mageck_version) {
    citations.push({
      type: 'algorithm',
      title: 'MAGeCK enables robust identification of essential genes from genome-scale CRISPR/Cas9 knockout screens',
      authors: ['Li, W.', 'Xu, H.', 'Xiao, T.', 'et al.'],
      year: 2014,
      doi: '10.1186/s13059-014-0554-4',
      url: 'https://genomebiology.biomedcentral.com/articles/10.1186/s13059-014-0554-4',
      version: version.software_environment.mageck_version,
    });
  }

  // BAGEL2 citation
  if (version.software_environment.bagel2_version) {
    citations.push({
      type: 'algorithm',
      title: 'Improved identification of essential genes from CRISPR knockout screens using BAGEL2',
      authors: ['Kim, E.', 'Hart, T.'],
      year: 2021,
      doi: '10.1186/s13059-020-02207-9',
      url: 'https://genomebiology.biomedcentral.com/articles/10.1186/s13059-020-02207-9',
      version: version.software_environment.bagel2_version,
    });
  }

  // DrugZ citation
  if (version.software_environment.drugz_version) {
    citations.push({
      type: 'algorithm',
      title: 'Optimized sgRNA design to maximize activity and minimize off-target effects of CRISPR-Cas9',
      authors: ['Chari, R.', 'Yeo, N.C.', 'Chavez, A.', 'Church, G.M.'],
      year: 2015,
      doi: '10.1038/nbt.3437',
      url: 'https://www.nature.com/articles/nbt.3437',
    });
  }

  return citations;
}

/**
 * Generate full methods text with citations in specified style
 */
function generateFullText(
  sections: MethodsSections,
  citations: Citation[],
  citationStyle: CitationStyle
): string {
  let text = '';

  // Standard section order
  const sectionOrder = [
    'study_design',
    'data_processing',
    'statistical_analysis',
    'data_availability',
  ];

  sectionOrder.forEach((sectionName) => {
    if (sections[sectionName]) {
      text += sections[sectionName] + '\n\n';
    }
  });

  // Add citations section
  text += '## References\n\n';
  citations.forEach((citation, index) => {
    text += `${index + 1}. ${formatCitation(citation, citationStyle)}\n`;
  });

  return text.trim();
}

/**
 * Format a single citation in the specified style
 */
function formatCitation(citation: Citation, style: CitationStyle): string {
  switch (style) {
    case 'apa':
      return formatCitationAPA(citation);
    case 'nature':
      return formatCitationNature(citation);
    case 'science':
      return formatCitationScience(citation);
    case 'cell':
      return formatCitationCell(citation);
    default:
      return formatCitationAPA(citation);
  }
}

/**
 * Format citation in APA style
 */
function formatCitationAPA(citation: Citation): string {
  const authors = citation.authors?.join(', ') || 'Unknown';
  const year = citation.year || 'n.d.';
  const title = citation.title;
  const version = citation.version ? ` (Version ${citation.version})` : '';

  if (citation.type === 'software') {
    return `${authors}. (${year}). ${title}${version}. ${citation.url}`;
  }

  const doi = citation.doi ? ` https://doi.org/${citation.doi}` : '';
  return `${authors}. (${year}). ${title}.${doi}`;
}

/**
 * Format citation in Nature style
 */
function formatCitationNature(citation: Citation): string {
  const authors = citation.authors?.slice(0, 3).join(', ') || 'Unknown';
  const moreAuthors = citation.authors && citation.authors.length > 3 ? ' et al.' : '';
  const title = citation.title;
  const doi = citation.doi ? ` https://doi.org/${citation.doi}` : '';

  return `${authors}${moreAuthors} ${title}.${doi} (${citation.year}).`;
}

/**
 * Format citation in Science style
 */
function formatCitationScience(citation: Citation): string {
  const authors = citation.authors?.slice(0, 5).join(', ') || 'Unknown';
  const moreAuthors = citation.authors && citation.authors.length > 5 ? ' et al.' : '';
  const title = citation.title;

  return `${authors}${moreAuthors}, ${title} (${citation.year}).`;
}

/**
 * Format citation in Cell style
 */
function formatCitationCell(citation: Citation): string {
  // Cell style is similar to Nature but with different formatting
  return formatCitationNature(citation);
}

// =============================================================================
// TEMPLATE MANAGEMENT
// =============================================================================

/**
 * Get a methods template by name
 */
export async function getMethodsTemplate(name: string): Promise<MethodsTemplate> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('methods_templates')
    .select('*')
    .eq('name', name)
    .eq('is_active', true)
    .single();

  if (error) {
    throw new Error(`Failed to fetch methods template: ${error.message}`);
  }

  return data as MethodsTemplate;
}

/**
 * Get all available templates
 */
export async function getAllMethodsTemplates(): Promise<MethodsTemplate[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('methods_templates')
    .select('*')
    .eq('is_active', true)
    .order('display_name');

  if (error) {
    throw new Error(`Failed to fetch methods templates: ${error.message}`);
  }

  return data as MethodsTemplate[];
}

/**
 * Get default template
 */
export async function getDefaultMethodsTemplate(): Promise<MethodsTemplate> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('methods_templates')
    .select('*')
    .eq('is_default', true)
    .eq('is_active', true)
    .single();

  if (error) {
    throw new Error(`Failed to fetch default methods template: ${error.message}`);
  }

  return data as MethodsTemplate;
}

// =============================================================================
// METHODS EDITING
// =============================================================================

/**
 * Update methods text (user editing)
 */
export async function updateMethodsText(
  methods_id: string,
  edited_text: string,
  edited_by: string
): Promise<AnalysisMethod> {
  const supabase = await createClient();

  const { data, error } = await (supabase as any)
    .from('analysis_methods')
    .update({
      edited_text,
      is_edited: true,
      edited_at: new Date().toISOString(),
      edited_by,
    })
    .eq('id', methods_id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update methods text: ${error.message}`);
  }

  return data as AnalysisMethod;
}

/**
 * Get methods for an analysis
 */
export async function getMethodsForAnalysis(
  analysis_id: string,
  version_id?: string
): Promise<AnalysisMethod | null> {
  const supabase = await createClient();

  let query = (supabase as any)
    .from('analysis_methods')
    .select('*')
    .eq('analysis_id', analysis_id)
    .order('generated_at', { ascending: false });

  if (version_id) {
    query = query.eq('version_id', version_id);
  }

  const { data } = await query.limit(1).single();

  return data as AnalysisMethod | null;
}

/**
 * Regenerate methods text (e.g., after parameter change)
 */
export async function regenerateMethodsText(
  methods_id: string,
  custom_variables?: Record<string, string>
): Promise<AnalysisMethod> {
  const supabase = await createClient();

  // Get existing methods
  const { data: existing } = await (supabase as any)
    .from('analysis_methods')
    .select('*')
    .eq('id', methods_id)
    .single();

  if (!existing) {
    throw new Error('Methods record not found');
  }

  // Regenerate with same template and citation style
  const result = await generateMethodsText({
    analysis_id: existing.analysis_id,
    version_id: existing.version_id,
    template_name: existing.template_name,
    citation_style: existing.citation_style,
    custom_variables,
  });

  // Update existing record with new generated text
  const { data, error } = await (supabase as any)
    .from('analysis_methods')
    .update({
      generated_text: result.methods.generated_text,
      sections: result.methods.sections,
      citations: result.methods.citations,
      version: existing.version + 1,
      parent_methods_id: methods_id,
    })
    .eq('id', methods_id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to regenerate methods text: ${error.message}`);
  }

  return data as AnalysisMethod;
}

// =============================================================================
// METHODS EXPORT
// =============================================================================

/**
 * Export methods text as plain text
 */
export function exportMethodsAsPlainText(methods: AnalysisMethod): string {
  return methods.is_edited ? methods.edited_text! : methods.generated_text;
}

/**
 * Export methods text as Word-compatible HTML
 */
export function exportMethodsAsWordHTML(methods: AnalysisMethod): string {
  const text = methods.is_edited ? methods.edited_text! : methods.generated_text;

  // Convert markdown-like formatting to HTML
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Methods Section</title>
  <style>
    body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 2; }
    h2 { font-size: 14pt; font-weight: bold; }
    p { margin: 0 0 12pt 0; text-align: justify; }
  </style>
</head>
<body>
  ${text.split('\n\n').map(para => `<p>${para}</p>`).join('\n')}
</body>
</html>
  `.trim();

  return html;
}

/**
 * Export methods text as LaTeX
 */
export function exportMethodsAsLaTeX(methods: AnalysisMethod): string {
  const text = methods.is_edited ? methods.edited_text! : methods.generated_text;

  // Convert to LaTeX format
  const latex = `
\\section*{Methods}

${text.split('\n\n').map(para => para + '\n').join('\n')}
  `.trim();

  return latex;
}
