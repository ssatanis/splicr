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

/** Get Ensembl gene ID from gene symbol (MyGene.info) */
async function getEnsemblId(gene: string): Promise<string | null> {
  try {
    const url = `https://mygene.info/v3/query?q=symbol:${encodeURIComponent(gene)}&species=human&fields=ensembl.gene&size=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const id = data.hits?.[0]?.ensembl?.gene ?? data.hits?.[0]?.ensembl?.gene_id;
    return id ?? null;
  } catch {
    return null;
  }
}

async function fetchTissueExpression(gene: string): Promise<TissueExpression[]> {
  const tissues: TissueExpression[] = [];

  try {
    // 1) GTEx Portal API - median gene expression by tissue (requires versioned GENCODE/Ensembl ID)
    const ensemblId = await getEnsemblId(gene);
    if (ensemblId) {
      // GTEx medianGeneExpression returns median TPM per tissue
      const gtexUrl = `https://gtexportal.org/api/v2/expression/medianGeneExpression?gencodeId=${encodeURIComponent(ensemblId)}&page=0&itemsPerPage=250`;
      const gtexRes = await fetch(gtexUrl);
      if (gtexRes.ok) {
        const gtexData = await gtexRes.json();
        const rows = gtexData?.data ?? [];
        for (const row of rows) {
          const median = typeof row.median === 'number' ? row.median : parseFloat(String(row.median)) || 0;
          const tissueName = row.tissueSiteDetail ?? row.tissueSiteDetailId ?? 'Unknown';
          tissues.push({
            tissue: String(tissueName).replace(/_/g, ' '),
            expression: median,
            specificity: median > 50 ? 'high' : median > 10 ? 'medium' : median > 1 ? 'low' : 'not detected',
          });
        }
      }
    }

    // 2) Fallback: MyGene.info expression field (various sources)
    if (tissues.length === 0) {
      const url = `https://mygene.info/v3/query?q=symbol:${encodeURIComponent(gene)}&species=human&fields=expression&size=1`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const hit = data.hits?.[0];
        const expression = hit?.expression ?? {};
        if (expression.gtex && typeof expression.gtex === 'object') {
          for (const [tissue, value] of Object.entries(expression.gtex)) {
            const expValue = typeof value === 'number' ? value : parseFloat(String(value)) || 0;
            tissues.push({
              tissue: String(tissue).replace(/_/g, ' '),
              expression: expValue,
              specificity: expValue > 50 ? 'high' : expValue > 10 ? 'medium' : expValue > 1 ? 'low' : 'not detected',
            });
          }
        }
      }
    }

    return tissues.sort((a, b) => b.expression - a.expression).slice(0, 15);
  } catch (e) {
    console.error('Tissue expression fetch error:', e);
    return [];
  }
}

async function fetchDiseaseAssociations(gene: string): Promise<DiseaseAssociation[]> {
  const results: DiseaseAssociation[] = [];

  try {
    const ensemblId = await getEnsemblId(gene);
    if (ensemblId) {
      // Open Targets GraphQL for disease associations
      const query = `
        query DiseaseAssociations($ensemblId: String!) {
          target(ensemblId: $ensemblId) {
            associatedDiseases(page: { size: 15 }) {
              rows {
                disease { name description }
                score
              }
            }
          }
        }
      `;
      const res = await fetch('https://api.platform.opentargets.org/api/v4/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { ensemblId } }),
      });
      if (res.ok) {
        const data = await res.json();
        const rows = data.data?.target?.associatedDiseases?.rows ?? [];
        for (const row of rows) {
          results.push({
            disease: row.disease?.name ?? 'Unknown',
            score: typeof row.score === 'number' ? row.score : parseFloat(String(row.score)) || 0,
            source: 'Open Targets',
            description: row.disease?.description,
          });
        }
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 15);
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
        conservationScore: data.conservation_score || undefined,
      };
    }
  } catch (e) {
    console.error('Essentiality data fetch error:', e);
  }
  return { isEssential: undefined, conservationScore: undefined };
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
