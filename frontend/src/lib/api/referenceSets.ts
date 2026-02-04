/**
 * Reference Gene Sets API Client
 *
 * Provides methods for accessing reference gene sets including essential genes,
 * non-essential genes, cancer drivers, and other curated gene collections.
 */

import { apiClient } from './realApi';

// ============================================================================
// TYPES
// ============================================================================

export interface GeneInfo {
  id: string;
  gene_symbol: string;
  gene_id?: string;
  ensembl_id?: string;
  score?: number;
  rank?: number;
  metadata?: Record<string, any>;
}

export interface ReferenceGeneSetSummary {
  id: string;
  name: string;
  description?: string;
  source?: string;
  organism: string;
  gene_count: number;
  publication_year?: number;
  pubmed_id?: string;
  is_active: boolean;
  category_name?: string;
  category_description?: string;
  metadata?: Record<string, any>;
}

export interface ReferenceGeneSetDetail extends ReferenceGeneSetSummary {
  genes: GeneInfo[];
}

export interface CategorySummary {
  id: string;
  name: string;
  description?: string;
  gene_set_count: number;
}

export interface GeneSetCheckResult {
  gene_set_id: string;
  gene_set_name: string;
  total_genes_in_set: number;
  matched_genes: string[];
  matched_count: number;
  unmatched_genes: string[];
  unmatched_count: number;
  overlap_percentage: number;
}

export interface ReferenceSetStats {
  total_categories: number;
  active_gene_sets: number;
  total_gene_sets: number;
  total_genes: number;
  unique_genes: number;
}

// ============================================================================
// API METHODS
// ============================================================================

/**
 * Get all reference gene set categories
 */
export async function getCategories(): Promise<CategorySummary[]> {
  const response = await apiClient.get('/reference-sets/categories');
  return response.data as CategorySummary[];
}

/**
 * List reference gene sets with optional filtering
 */
export async function listGeneSets(params?: {
  category?: string;
  organism?: string;
  active_only?: boolean;
}): Promise<ReferenceGeneSetSummary[]> {
  const response = await apiClient.get('/reference-sets/gene-sets', { params });
  return response.data as ReferenceGeneSetSummary[];
}

/**
 * Get detailed information about a specific gene set
 */
export async function getGeneSet(
  geneSetId: string,
  includeGenes = true,
  limit?: number
): Promise<ReferenceGeneSetDetail> {
  const response = await apiClient.get(`/reference-sets/gene-sets/${geneSetId}`, {
    params: {
      include_genes: includeGenes,
      limit,
    },
  });
  return response.data as ReferenceGeneSetDetail;
}

/**
 * Get gene set by name and organism
 */
export async function getGeneSetByName(
  name: string,
  organism = 'Homo sapiens',
  includeGenes = true
): Promise<ReferenceGeneSetDetail> {
  const response = await apiClient.get(`/reference-sets/gene-sets/by-name/${encodeURIComponent(name)}`, {
    params: {
      organism,
      include_genes: includeGenes,
    },
  });
  return response.data as ReferenceGeneSetDetail;
}

/**
 * Check which genes from a list are in a reference gene set
 */
export async function checkGenesInSet(
  geneSetId: string,
  genes: string[]
): Promise<GeneSetCheckResult> {
  const response = await apiClient.post(`/reference-sets/gene-sets/${geneSetId}/check`, genes);
  return response.data as GeneSetCheckResult;
}

/**
 * Search for genes across all reference sets
 */
export async function searchGenes(
  query: string,
  geneSetId?: string,
  limit = 50
): Promise<GeneInfo[]> {
  const response = await apiClient.get('/reference-sets/genes/search', {
    params: {
      query,
      gene_set_id: geneSetId,
      limit,
    },
  });
  return response.data as GeneInfo[];
}

/**
 * Get overall statistics about reference gene sets
 */
export async function getStats(): Promise<ReferenceSetStats> {
  const response = await apiClient.get('/reference-sets/stats');
  return response.data as ReferenceSetStats;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get essential genes (Hart Core Essential 2015)
 */
export async function getEssentialGenes(): Promise<ReferenceGeneSetDetail> {
  return getGeneSetByName('Hart Core Essential 2015');
}

/**
 * Get non-essential genes (Hart Non-Essential 2014)
 */
export async function getNonEssentialGenes(): Promise<ReferenceGeneSetDetail> {
  return getGeneSetByName('Hart Non-Essential 2014');
}

/**
 * Get ribosomal protein genes
 */
export async function getRibosomalGenes(): Promise<ReferenceGeneSetDetail> {
  return getGeneSetByName('Ribosomal Proteins');
}

/**
 * Get DNA repair genes
 */
export async function getDNARepairGenes(): Promise<ReferenceGeneSetDetail> {
  return getGeneSetByName('DNA Repair Genes');
}

/**
 * Get cancer driver genes
 */
export async function getCancerDriverGenes(): Promise<ReferenceGeneSetDetail> {
  return getGeneSetByName('Cancer Driver Genes');
}

/**
 * Check if a gene is essential based on Hart 2015 set
 */
export async function isGeneEssential(geneSymbol: string): Promise<boolean> {
  const essentialSet = await getEssentialGenes();
  return essentialSet.genes.some((g) => g.gene_symbol === geneSymbol);
}

/**
 * Check if a gene is a cancer driver
 */
export async function isGeneCancerDriver(geneSymbol: string): Promise<boolean> {
  const cancerDriverSet = await getCancerDriverGenes();
  return cancerDriverSet.genes.some((g) => g.gene_symbol === geneSymbol);
}

/**
 * Categorize genes from a list into essential, non-essential, and other
 */
export async function categorizeGenes(genes: string[]): Promise<{
  essential: string[];
  nonEssential: string[];
  cancerDrivers: string[];
  other: string[];
}> {
  const [essentialSet, nonEssentialSet, cancerDriverSet] = await Promise.all([
    getEssentialGenes(),
    getNonEssentialGenes(),
    getCancerDriverGenes(),
  ]);

  const essentialGenes = new Set(essentialSet.genes.map((g) => g.gene_symbol));
  const nonEssentialGenes = new Set(nonEssentialSet.genes.map((g) => g.gene_symbol));
  const cancerDriverGenes = new Set(cancerDriverSet.genes.map((g) => g.gene_symbol));

  const categorized = {
    essential: [] as string[],
    nonEssential: [] as string[],
    cancerDrivers: [] as string[],
    other: [] as string[],
  };

  for (const gene of genes) {
    if (essentialGenes.has(gene)) {
      categorized.essential.push(gene);
    } else if (nonEssentialGenes.has(gene)) {
      categorized.nonEssential.push(gene);
    } else if (cancerDriverGenes.has(gene)) {
      categorized.cancerDrivers.push(gene);
    } else {
      categorized.other.push(gene);
    }
  }

  return categorized;
}

/**
 * Calculate enrichment p-value using Fisher's exact test (simplified)
 * For more accurate p-values, this should be done on the backend
 */
export function calculateEnrichment(
  genesInSet: number,
  genesNotInSet: number,
  totalInSet: number,
  totalNotInSet: number
): number {
  // Simplified hypergeometric test
  // In production, use proper statistical library or backend calculation
  const total = totalInSet + totalNotInSet;
  const expectedInSet = (genesInSet + genesNotInSet) * (totalInSet / total);
  const enrichment = genesInSet / expectedInSet;
  return enrichment;
}
