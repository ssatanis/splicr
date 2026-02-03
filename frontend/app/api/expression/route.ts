import { NextRequest, NextResponse } from 'next/server';

/**
 * Expression & Disease API
 * Fetches tissue expression patterns and disease associations
 */

interface TissueExpression {
  tissue: string;
  expression: number; // TPM or normalized value
  specificity: 'high' | 'medium' | 'low' | 'not detected';
}

interface DiseaseAssociation {
  disease: string;
  score: number;
  source: string;
  description?: string;
}

interface ExpressionData {
  tissueExpression?: TissueExpression[];
  diseases?: DiseaseAssociation[];
  isEssential?: boolean;
  conservationScore?: number;
}

function isValidGeneSymbol(s: string): boolean {
  return /^[A-Za-z0-9\-\.]+$/.test(s) && s.length >= 1 && s.length <= 30;
}

async function fetchTissueExpression(gene: string): Promise<TissueExpression[]> {
  try {
    // Use MyGene.info for tissue expression data from GTEx
    const url = `https://mygene.info/v3/query?q=symbol:${encodeURIComponent(gene)}&species=human&fields=generif,expression`;
    const res = await fetch(url);
    
    if (!res.ok) return [];
    
    const data = await res.json();
    const hit = data.hits?.[0];
    if (!hit) return [];
    
    // Process expression data if available
    const expression = hit.expression || {};
    const tissues: TissueExpression[] = [];
    
    // Note: Real implementation would parse GTEx or other expression databases
    // This is a simplified version
    if (expression.gtex) {
      for (const [tissue, value] of Object.entries(expression.gtex)) {
        const expValue = typeof value === 'number' ? value : parseFloat(String(value)) || 0;
        tissues.push({
          tissue: tissue.replace(/_/g, ' '),
          expression: expValue,
          specificity: expValue > 50 ? 'high' : expValue > 10 ? 'medium' : expValue > 1 ? 'low' : 'not detected',
        });
      }
    }
    
    return tissues.sort((a, b) => b.expression - a.expression).slice(0, 15);
  } catch (e) {
    console.error('Tissue expression fetch error:', e);
    return [];
  }
}

async function fetchDiseaseAssociations(gene: string): Promise<DiseaseAssociation[]> {
  try {
    // Use Open Targets for disease associations
    const query = `
      query DiseaseAssociations($ensemblId: String!) {
        target(ensemblId: $ensemblId) {
          associatedDiseases(page: {size: 15}) {
            rows {
              disease {
                name
                description
              }
              score
              datasourceScores {
                id
                score
              }
            }
          }
        }
      }
    `;
    
    // First get Ensembl ID
    const geneInfoUrl = `https://mygene.info/v3/query?q=symbol:${encodeURIComponent(gene)}&species=human&fields=ensembl.gene`;
    const geneRes = await fetch(geneInfoUrl);
    if (!geneRes.ok) return [];
    
    const geneData = await geneRes.json();
    const ensemblId = geneData.hits?.[0]?.ensembl?.gene;
    
    if (!ensemblId) return [];
    
    // Query Open Targets
    const res = await fetch('https://api.platform.opentargets.org/api/v4/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { ensemblId },
      }),
    });
    
    if (!res.ok) return [];
    
    const data = await res.json();
    const diseases = data.data?.target?.associatedDiseases?.rows || [];
    
    return diseases.map((row: any) => ({
      disease: row.disease?.name || 'Unknown',
      score: row.score || 0,
      source: 'Open Targets',
      description: row.disease?.description,
    })).sort((a: any, b: any) => b.score - a.score);
  } catch (e) {
    console.error('Disease associations fetch error:', e);
    return [];
  }
}

async function fetchEssentialityData(gene: string) {
  try {
    // Check if gene is essential using DepMap data
    const depMapUrl = `https://depmap.org/portal/api/v1/gene/${gene}`;
    const res = await fetch(depMapUrl);
    
    if (res.ok) {
      const data = await res.json();
      return {
        isEssential: (data.dependency_score || 0) < -0.5,
        conservationScore: data.conservation_score || null,
      };
    }
  } catch (e) {
    console.error('Essentiality data fetch error:', e);
  }
  return { isEssential: null, conservationScore: null };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gene = searchParams.get('gene')?.trim().toUpperCase();
    
    if (!gene || !isValidGeneSymbol(gene)) {
      return NextResponse.json(
        { error: 'Missing or invalid gene symbol', details: 'Use ?gene=TP53' },
        { status: 400 }
      );
    }
    
    // Fetch all data in parallel
    const [tissueExpression, diseases, essentialityData] = await Promise.all([
      fetchTissueExpression(gene),
      fetchDiseaseAssociations(gene),
      fetchEssentialityData(gene),
    ]);
    
    const result: ExpressionData = {
      tissueExpression: tissueExpression.length > 0 ? tissueExpression : undefined,
      diseases: diseases.length > 0 ? diseases : undefined,
      ...essentialityData,
    };
    
    return NextResponse.json({
      gene,
      ...result,
    });
  } catch (error) {
    console.error('Expression API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch expression data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
