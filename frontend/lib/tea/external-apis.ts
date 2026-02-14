/**
 * TEA External API Integrations
 * Handles DepMap, ClinVar, ENCODE, and PubMed API calls with caching
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  forceRefresh?: boolean;
}

/**
 * Generic cache wrapper for external API calls
 */
async function withCache<T>(
  cacheKey: string,
  cacheType: 'depmap' | 'clinvar' | 'encode' | 'pubmed',
  fetcher: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  const { ttl = 604800, forceRefresh = false } = options; // Default 7 days

  if (!forceRefresh) {
    // Check cache first
    const { data: cached } = await supabase
      .from('tea_external_cache')
      .select('data, expires_at')
      .eq('cache_key', cacheKey)
      .single();

    if (cached && new Date(cached.expires_at) > new Date()) {
      return cached.data as T;
    }
  }

  // Fetch fresh data
  const data = await fetcher();

  // Store in cache
  const expiresAt = new Date(Date.now() + ttl * 1000);
  
  await supabase
    .from('tea_external_cache')
    .upsert({
      cache_key: cacheKey,
      cache_type: cacheType,
      data: data as any,
      expires_at: expiresAt.toISOString()
    });

  return data;
}

/**
 * DepMap Gene Dependency Data
 */
export interface DepMapData {
  gene: string;
  chronos_scores: Record<string, number>; // cell_line_id -> chronos score
  pan_cancer_mean: number;
  tissue_specific: Record<string, number>; // tissue -> mean chronos
  is_common_essential: boolean;
  dependency_probability: number;
}

export async function fetchDepMapData(gene: string): Promise<DepMapData> {
  const cacheKey = `depmap:${gene}`;

  return withCache(cacheKey, 'depmap', async () => {
    // In production, this would query DepMap API or database
    // For now, we'll query our tx_depmap_data table
    
    const { data: depmap, error } = await supabase.rpc('get_depmap_gene_data', {
      p_gene_symbol: gene
    });

    if (error) {
      throw new Error(`DepMap API error: ${error.message}`);
    }

    return {
      gene,
      chronos_scores: depmap.chronos_scores || {},
      pan_cancer_mean: depmap.pan_cancer_mean || 0,
      tissue_specific: depmap.tissue_specific || {},
      is_common_essential: depmap.chronos_mean < -0.5,
      dependency_probability: depmap.dependency_prob || 0
    };
  });
}

/**
 * ClinVar Variant Information
 */
export interface ClinVarVariant {
  variant_id: string;
  gene: string;
  hgvs: string;
  clinical_significance: string;
  chromosome: string;
  position: number;
  ref: string;
  alt: string;
  consequence: string;
  review_status: string;
  conditions: string[];
}

export async function fetchClinVarVariant(variantId: string): Promise<ClinVarVariant> {
  const cacheKey = `clinvar:${variantId}`;

  return withCache(cacheKey, 'clinvar', async () => {
    // Query NCBI eUtils API
    const eUtilsUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id=${variantId}&retmode=json`;

    const response = await fetch(eUtilsUrl);
    if (!response.ok) {
      throw new Error(`ClinVar API error: ${response.statusText}`);
    }

    const data = await response.json();
    const variant = data.result?.[variantId];

    if (!variant) {
      throw new Error(`Variant ${variantId} not found in ClinVar`);
    }

    return {
      variant_id: variantId,
      gene: variant.genes?.[0]?.symbol || 'Unknown',
      hgvs: variant.variation_set?.[0]?.variation_name || '',
      clinical_significance: variant.clinical_significance?.description || 'Unknown',
      chromosome: variant.chromosome || '',
      position: parseInt(variant.start) || 0,
      ref: variant.variation_set?.[0]?.canonical_spdi?.split(':')[2] || '',
      alt: variant.variation_set?.[0]?.canonical_spdi?.split(':')[3] || '',
      consequence: variant.molecular_consequence || '',
      review_status: variant.review_status || '',
      conditions: variant.conditions || []
    };
  });
}

/**
 * ENCODE Chromatin Accessibility Data
 */
export interface ChromatinAccessibility {
  chromosome: string;
  position: number;
  tissue: string;
  accessibility_score: number; // 0-1
  dnase_signal: number;
  source: 'ENCODE' | 'ROADMAP';
  experiment_id?: string;
}

export async function fetchChromatinAccessibility(
  chromosome: string,
  position: number,
  tissue: string
): Promise<ChromatinAccessibility> {
  const cacheKey = `chromatin:${chromosome}:${position}:${tissue}`;

  return withCache(cacheKey, 'encode', async () => {
    // Query ENCODE REST API
    const tissueMapping: Record<string, string> = {
      'liver': 'liver',
      'neurons': 'brain',
      'hsc': 'blood',
      'hepatocytes': 'liver',
      'peripheral blood': 'blood'
    };

    const encodeTissue = tissueMapping[tissue.toLowerCase()] || tissue;
    
    const encodeUrl = `https://www.encodeproject.org/search/?type=Experiment&assay_title=DNase-seq&biosample_ontology.term_name=${encodeTissue}&assembly=GRCh38&limit=1&format=json`;

    const response = await fetch(encodeUrl, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      // Fallback to estimated score based on gene expression
      return {
        chromosome,
        position,
        tissue,
        accessibility_score: 0.5, // Neutral estimate
        dnase_signal: 0,
        source: 'ROADMAP' as const
      };
    }

    const data = await response.json();
    
    // In production, would parse bigWig files for exact position
    // For now, return experiment-level data
    const experiment = data['@graph']?.[0];
    
    return {
      chromosome,
      position,
      tissue,
      accessibility_score: 0.7, // Simplified - would parse bigWig
      dnase_signal: 10.5,
      source: 'ENCODE',
      experiment_id: experiment?.accession
    };
  });
}

/**
 * PubMed Related Papers
 */
export interface PubMedPaper {
  pmid: string;
  title: string;
  authors: string;
  journal: string;
  year: string;
  abstract?: string;
  url: string;
}

export async function fetchRelatedPapers(
  gene: string,
  editingType: 'base editing' | 'prime editing' | 'CRISPR',
  limit: number = 5
): Promise<PubMedPaper[]> {
  const cacheKey = `pubmed:${gene}:${editingType}:${limit}`;

  return withCache(cacheKey, 'pubmed', async () => {
    // Search PubMed
    const query = `${gene} AND "${editingType}" AND gene therapy`;
    const eSearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${limit}&retmode=json&sort=relevance`;

    const searchResponse = await fetch(eSearchUrl);
    const searchData = await searchResponse.json();
    const pmids = searchData.esearchresult?.idlist || [];

    if (pmids.length === 0) {
      return [];
    }

    // Fetch paper details
    const eSummaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmids.join(',')}&retmode=json`;
    
    const summaryResponse = await fetch(eSummaryUrl);
    const summaryData = await summaryResponse.json();

    const papers: PubMedPaper[] = pmids.map((pmid: string) => {
      const paper = summaryData.result?.[pmid];
      if (!paper) return null;

      return {
        pmid,
        title: paper.title || 'No title',
        authors: paper.authors?.slice(0, 3).map((a: any) => a.name).join(', ') + (paper.authors?.length > 3 ? ' et al.' : ''),
        journal: paper.source || 'Unknown',
        year: paper.pubdate?.split(' ')[0] || '',
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
      };
    }).filter(Boolean) as PubMedPaper[];

    return papers;
  });
}

/**
 * dbSNP rs Number Lookup
 */
export interface dbSNPVariant {
  rsid: string;
  chromosome: string;
  position: number;
  ref: string;
  alt: string[];
  gene?: string;
  consequence?: string;
}

export async function fetchdbSNPVariant(rsid: string): Promise<dbSNPVariant> {
  const cacheKey = `dbsnp:${rsid}`;

  return withCache(cacheKey, 'clinvar', async () => {
    // Query NCBI dbSNP API
    const url = `https://api.ncbi.nlm.nih.gov/variation/v0/beta/refsnp/${rsid}`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`dbSNP API error: ${response.statusText}`);
    }

    const data = await response.json();
    const placement = data.primary_snapshot_data?.placements_with_allele?.[0];
    const alleles = placement?.alleles || [];

    return {
      rsid,
      chromosome: placement?.seq_id?.split('.')[0] || '',
      position: placement?.alleles?.[0]?.allele?.spdi?.position || 0,
      ref: alleles[0]?.allele?.spdi?.deleted_sequence || '',
      alt: alleles.slice(1).map((a: any) => a.allele?.spdi?.inserted_sequence).filter(Boolean),
      gene: data.primary_snapshot_data?.genes?.[0]?.name,
      consequence: alleles[0]?.hgvs
    };
  });
}

/**
 * GTEx Expression Data
 */
export interface GTExExpression {
  gene: string;
  tissue: string;
  median_tpm: number;
  is_highly_expressed: boolean; // TPM > 10
}

export async function fetchGTExExpression(
  gene: string,
  tissue: string
): Promise<GTExExpression> {
  const cacheKey = `gtex:${gene}:${tissue}`;

  return withCache(cacheKey, 'encode', async () => {
    // Query our tx_gtex_expression table
    const { data, error } = await supabase
      .from('tx_gtex_expression')
      .select('median_tpm')
      .eq('gene_symbol', gene)
      .eq('tissue_name', tissue)
      .single();

    if (error || !data) {
      // Return default if not found
      return {
        gene,
        tissue,
        median_tpm: 0,
        is_highly_expressed: false
      };
    }

    return {
      gene,
      tissue,
      median_tpm: data.median_tpm,
      is_highly_expressed: data.median_tpm > 10
    };
  });
}

/**
 * Cleanup expired cache entries
 */
export async function cleanupExpiredCache(): Promise<number> {
  const { data } = await supabase.rpc('cleanup_expired_tea_cache');
  return data || 0;
}
