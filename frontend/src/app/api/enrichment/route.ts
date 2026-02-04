import { NextRequest, NextResponse } from 'next/server';

/**
 * Pathway Enrichment API
 * Performs enrichment analysis using STRING and Enrichr
 */

interface EnrichmentResult {
  term: string;
  pValue: number;
  fdr: number;
  geneCount: number;
  category: string;
  genes?: string[];
  database: string;
}

function isValidGeneSymbol(s: string): boolean {
  return /^[A-Za-z0-9\-\.]+$/.test(s) && s.length >= 1 && s.length <= 30;
}

async function fetchStringEnrichment(genes: string[]): Promise<EnrichmentResult[]> {
  try {
    // STRING enrichment endpoint
    const identifiers = genes.slice(0, 100).join('\r\n');
    const url = `https://string-db.org/api/json/enrichment?identifiers=${encodeURIComponent(identifiers)}&species=9606&caller_identity=splicr.app`;
    
    const res = await fetch(url);
    if (!res.ok) return [];
    
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    
    const results: EnrichmentResult[] = [];
    
    // Process different categories
    for (const item of data) {
      if (item.fdr > 0.05) continue; // Only significant results
      
      results.push({
        term: item.term || item.description || 'Unknown',
        pValue: parseFloat(item.p_value) || 0,
        fdr: parseFloat(item.fdr) || 1,
        geneCount: parseInt(item.number_of_genes) || 0,
        category: item.category || 'Unknown',
        database: 'STRING',
      });
    }
    
    // Sort by FDR
    return results.sort((a, b) => a.fdr - b.fdr).slice(0, 20);
  } catch (e) {
    console.error('STRING enrichment error:', e);
    return [];
  }
}

async function fetchEnrichrPathways(genes: string[]): Promise<EnrichmentResult[]> {
  try {
    // Enrichr API for additional pathway databases
    const geneList = genes.slice(0, 100).join('\n');
    
    // Step 1: Submit gene list
    const submitRes = await fetch('https://maayanlab.cloud/Enrichr/addList', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `list=${encodeURIComponent(geneList)}&description=SplicR_Analysis`,
    });
    
    if (!submitRes.ok) return [];
    const submitData = await submitRes.json();
    const userListId = submitData.userListId;
    
    if (!userListId) return [];
    
    // Step 2: Get enrichment results from KEGG and Reactome
    const databases = ['KEGG_2021_Human', 'Reactome_2022', 'GO_Biological_Process_2023'];
    const results: EnrichmentResult[] = [];
    
    for (const db of databases) {
      try {
        const enrichRes = await fetch(
          `https://maayanlab.cloud/Enrichr/enrich?userListId=${userListId}&backgroundType=${db}`
        );
        
        if (!enrichRes.ok) continue;
        const enrichData = await enrichRes.json();
        
        const dbResults = enrichData[db] || [];
        for (const item of dbResults.slice(0, 10)) {
          if (item[5] > 0.05) continue; // FDR filter
          
          results.push({
            term: item[1] || 'Unknown',
            pValue: item[2] || 0,
            fdr: item[6] || 1,
            geneCount: item[3]?.length || 0,
            category: db.includes('KEGG') ? 'KEGG' : db.includes('Reactome') ? 'Reactome' : 'GO BP',
            genes: item[5] || [],
            database: 'Enrichr',
          });
        }
      } catch (e) {
        console.error(`Enrichr ${db} error:`, e);
      }
    }
    
    return results.sort((a, b) => a.fdr - b.fdr);
  } catch (e) {
    console.error('Enrichr error:', e);
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const genesParam = searchParams.get('genes');
    
    if (!genesParam) {
      return NextResponse.json(
        { error: 'Missing genes parameter', details: 'Use ?genes=TP53,BRCA1,ATM' },
        { status: 400 }
      );
    }
    
    const genes = genesParam
      .split(',')
      .map(g => g.trim().toUpperCase())
      .filter(g => isValidGeneSymbol(g))
      .slice(0, 100);
    
    if (genes.length === 0) {
      return NextResponse.json(
        { error: 'No valid gene symbols provided' },
        { status: 400 }
      );
    }
    
    // Fetch enrichment from multiple sources in parallel
    const [stringResults, enrichrResults] = await Promise.all([
      fetchStringEnrichment(genes),
      fetchEnrichrPathways(genes),
    ]);
    
    // Combine and deduplicate results
    const allResults = [...stringResults, ...enrichrResults];
    const uniqueTerms = new Map<string, EnrichmentResult>();
    
    for (const result of allResults) {
      const key = result.term.toLowerCase().trim();
      const existing = uniqueTerms.get(key);
      
      // Keep the result with lower FDR
      if (!existing || result.fdr < existing.fdr) {
        uniqueTerms.set(key, result);
      }
    }
    
    const results = Array.from(uniqueTerms.values())
      .sort((a, b) => a.fdr - b.fdr)
      .slice(0, 30);
    
    return NextResponse.json({
      genes,
      geneCount: genes.length,
      results,
      resultCount: results.length,
    });
  } catch (error) {
    console.error('Enrichment API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to perform enrichment analysis',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
