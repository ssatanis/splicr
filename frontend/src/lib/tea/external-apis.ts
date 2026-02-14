/**
 * External API integrations for TEA (Therapeutic Editing Assessment)
 * Provides functions to fetch data from various genomics and research databases
 */

/**
 * Fetch gene dependency data from DepMap
 */
export async function fetchDepMapData(gene: string) {
  try {
    const depMapUrl = `https://depmap.org/portal/api/v1/gene/${gene}`;
    const res = await fetch(depMapUrl, {
      headers: { 'Accept': 'application/json' },
    });
    
    if (res.ok) {
      const data = await res.json();
      return {
        dependencyScore: data.dependency_score || null,
        cellLineData: data.cell_lines?.slice(0, 10) || [],
        isEssential: (data.dependency_score || 0) < -0.5,
      };
    }
  } catch (e) {
    console.error('DepMap fetch error:', e);
  }
  return null;
}

/**
 * Fetch chromatin accessibility data for a genomic position
 */
export async function fetchChromatinAccessibility(
  chromosome: string,
  position: number,
  tissue: string
): Promise<{
  accessibility_score: number;
  tissue: string;
  source: string;
  dnase_signal?: number;
} | null> {
  try {
    // ENCODE DHS (DNase Hypersensitivity) data
    // Using UCSC REST API
    const ucscUrl = `https://api.genome.ucsc.edu/getData/track`;
    const params = new URLSearchParams({
      genome: 'hg38',
      track: 'wgEncodeRegDnaseClustered',
      chrom: chromosome.startsWith('chr') ? chromosome : `chr${chromosome}`,
      start: String(position - 500),
      end: String(position + 500),
    });

    const res = await fetch(`${ucscUrl}?${params.toString()}`);
    
    if (res.ok) {
      const data = await res.json();
      
      // Calculate accessibility score from DHS data
      let accessibilityScore = 0;
      if (data && data.wgEncodeRegDnaseClustered && data.wgEncodeRegDnaseClustered.length > 0) {
        // Use the score from the first overlapping DHS site
        const dhsData = data.wgEncodeRegDnaseClustered[0];
        accessibilityScore = (dhsData.score || 0) / 1000; // Normalize to 0-1
      }

      return {
        accessibility_score: accessibilityScore,
        tissue,
        source: 'ENCODE',
        dnase_signal: accessibilityScore * 100,
      };
    }
  } catch (e) {
    console.error('Chromatin accessibility fetch error:', e);
  }
  
  // Return default moderate accessibility if data unavailable
  return {
    accessibility_score: 0.5,
    tissue,
    source: 'default',
  };
}

/**
 * Fetch related scientific papers from PubMed
 */
export async function fetchRelatedPapers(
  geneSymbol: string,
  editingStrategy: 'base_editing' | 'prime_editing' | 'nuclease' | string,
  maxResults: number = 5
): Promise<Array<{
  pmid: string;
  title: string;
  authors: string;
  journal: string;
  year: string;
  url: string;
}>> {
  try {
    // Build search query
    const strategies: { [key: string]: string } = {
      'base_editing': 'base editing',
      'prime_editing': 'prime editing',
      'nuclease': 'CRISPR nuclease',
    };
    
    const strategyTerm = strategies[editingStrategy] || editingStrategy;
    const searchQuery = `${geneSymbol} AND (${strategyTerm} OR CRISPR OR gene editing)`;
    
    // Search PubMed
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(searchQuery)}&retmax=${maxResults}&retmode=json&sort=relevance`;
    const searchRes = await fetch(searchUrl);
    
    if (!searchRes.ok) return [];
    
    const searchData = await searchRes.json();
    const pmids = searchData.esearchresult?.idlist || [];
    
    if (pmids.length === 0) return [];
    
    // Fetch paper details
    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmids.join(',')}&retmode=json`;
    const summaryRes = await fetch(summaryUrl);
    
    if (!summaryRes.ok) return [];
    
    const summaryData = await summaryRes.json();
    const results = summaryData.result || {};
    
    return pmids.map((pmid: string) => {
      const paper = results[pmid];
      if (!paper) return null;
      
      return {
        pmid,
        title: paper.title || 'Untitled',
        authors: paper.authors?.[0]?.name || 'Unknown',
        journal: paper.source || 'Unknown Journal',
        year: paper.pubdate?.split(' ')[0] || '',
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      };
    }).filter(Boolean);
  } catch (e) {
    console.error('PubMed fetch error:', e);
    return [];
  }
}

/**
 * Fetch gene expression data from GTEx
 */
export async function fetchGTExExpression(
  geneSymbol: string,
  tissue: string
): Promise<{
  median_tpm: number;
  is_highly_expressed: boolean;
  tissue: string;
}> {
  try {
    // GTEx API endpoint
    const gtexUrl = `https://gtexportal.org/api/v2/expression/medianGeneExpression?geneSymbol=${encodeURIComponent(geneSymbol)}`;
    const res = await fetch(gtexUrl);
    
    if (res.ok) {
      const data = await res.json();
      
      // Find expression for the specified tissue
      const tissueData = data.data?.find((d: any) => 
        d.tissueSiteDetailId?.toLowerCase().includes(tissue.toLowerCase()) ||
        d.tissueSiteDetail?.toLowerCase().includes(tissue.toLowerCase())
      );
      
      const medianTpm = tissueData?.median || 0;
      
      return {
        median_tpm: medianTpm,
        is_highly_expressed: medianTpm > 10, // TPM > 10 is considered highly expressed
        tissue,
      };
    }
  } catch (e) {
    console.error('GTEx fetch error:', e);
  }
  
  // Return default if data unavailable
  return {
    median_tpm: 0,
    is_highly_expressed: false,
    tissue,
  };
}

/**
 * Fetch off-target predictions (placeholder - would integrate with specialized tools)
 */
export async function fetchOffTargetPredictions(
  sequence: string,
  pamType: string = 'NGG'
): Promise<Array<{
  sequence: string;
  chromosome: string;
  position: number;
  mismatches: number;
  cfdScore: number;
}>> {
  // This would typically call a specialized off-target prediction service
  // For now, return empty array as placeholder
  console.log('Off-target prediction would be called for:', sequence);
  return [];
}

/**
 * Fetch protein structure data from AlphaFold/PDB
 */
export async function fetchProteinStructure(
  geneSymbol: string
): Promise<{
  pdbId?: string;
  alphafoldId?: string;
  hasStructure: boolean;
} | null> {
  try {
    // Search for UniProt ID first
    const uniprotUrl = `https://www.uniprot.org/uniprot/?query=gene:${encodeURIComponent(geneSymbol)}+AND+organism:9606&format=json&limit=1`;
    const res = await fetch(uniprotUrl);
    
    if (res.ok) {
      const data = await res.json();
      const uniprotId = data.results?.[0]?.primaryAccession;
      
      if (uniprotId) {
        return {
          alphafoldId: `AF-${uniprotId}-F1`,
          hasStructure: true,
        };
      }
    }
  } catch (e) {
    console.error('Protein structure fetch error:', e);
  }
  
  return {
    hasStructure: false,
  };
}
