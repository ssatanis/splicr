import { NextRequest, NextResponse } from 'next/server';

/**
 * Comprehensive Gene Details API
 * Aggregates data from multiple sources:
 * - DepMap (cancer dependency)
 * - ClinicalTrials.gov
 * - DrugBank (via OpenTargets)
 * - STRING (protein interactions)
 */

interface DrugInfo {
  name: string;
  mechanism: string;
  phase: string;
  source: string;
}

interface ClinicalTrial {
  nctId: string;
  title: string;
  status: string;
  phase: string;
  conditions: string[];
  url: string;
}

interface ProteinInteraction {
  protein: string;
  score: number;
  experimentalEvidence: boolean;
}

interface GeneDetails {
  depmap?: {
    dependencyScore: number | null;
    cellLineData: any[];
    isEssential: boolean;
  };
  drugs?: DrugInfo[];
  clinicalTrials?: ClinicalTrial[];
  interactions?: ProteinInteraction[];
}

function isValidGeneSymbol(s: string): boolean {
  return /^[A-Za-z0-9\-\.]+$/.test(s) && s.length >= 1 && s.length <= 30;
}

async function fetchDepMapData(gene: string) {
  try {
    // DepMap data - using public API
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

async function fetchClinicalTrials(gene: string, maxResults: number = 5): Promise<ClinicalTrial[]> {
  try {
    // ClinicalTrials.gov API
    const searchUrl = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(gene)}&pageSize=${maxResults}&format=json`;
    const res = await fetch(searchUrl);
    
    if (!res.ok) return [];
    
    const data = await res.json();
    const studies = data.studies || [];
    
    return studies.map((study: any) => {
      const protocol = study.protocolSection || {};
      const identification = protocol.identificationModule || {};
      const status = protocol.statusModule || {};
      const design = protocol.designModule || {};
      const conditions = protocol.conditionsModule?.conditions || [];
      
      return {
        nctId: identification.nctId || '',
        title: identification.briefTitle || 'Untitled Study',
        status: status.overallStatus || 'Unknown',
        phase: design.phases?.[0] || 'N/A',
        conditions: conditions.slice(0, 3),
        url: `https://clinicaltrials.gov/study/${identification.nctId}`,
      };
    }).filter((t: ClinicalTrial) => t.nctId);
  } catch (e) {
    console.error('ClinicalTrials fetch error:', e);
    return [];
  }
}

async function fetchDrugTargets(gene: string): Promise<DrugInfo[]> {
  try {
    // Open Targets Platform API for drug information
    const query = `
      query TargetDrugs($ensemblId: String!) {
        target(ensemblId: $ensemblId) {
          knownDrugs(page: {size: 10}) {
            rows {
              drug {
                name
                mechanismsOfAction {
                  mechanismOfAction
                }
              }
              clinicalTrial {
                phase
                status
              }
            }
          }
        }
      }
    `;

    // First, get Ensembl ID from gene symbol
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
    const drugs = data.data?.target?.knownDrugs?.rows || [];
    
    return drugs.map((row: any) => ({
      name: row.drug?.name || 'Unknown',
      mechanism: row.drug?.mechanismsOfAction?.[0]?.mechanismOfAction || 'Unknown mechanism',
      phase: row.clinicalTrial?.phase || 'Unknown',
      source: 'OpenTargets',
    })).slice(0, 10);
  } catch (e) {
    console.error('Drug targets fetch error:', e);
    return [];
  }
}

async function fetchProteinInteractions(gene: string): Promise<ProteinInteraction[]> {
  try {
    // STRING network endpoint returns interactions with combined scores
    const url = `https://string-db.org/api/json/network?identifiers=${encodeURIComponent(gene)}&species=9606&required_score=400&limit=25&caller_identity=splicr.app`;
    const res = await fetch(url);
    
    if (!res.ok) {
      console.error('STRING API error:', res.status);
      return [];
    }
    
    const data = await res.json();
    if (!Array.isArray(data)) {
      console.error('Unexpected STRING response format:', data);
      return [];
    }
    
    const interactions: ProteinInteraction[] = [];
    const seen = new Set<string>();
    
    for (const interaction of data) {
      // STRING returns preferredName_B or stringId_B for partner
      const partnerName =
        interaction.preferredName_B ??
        interaction.preferred_name_B ??
        (typeof interaction.stringId_B === 'string' ? interaction.stringId_B.split('.')[1] : null);
      if (!partnerName || seen.has(partnerName) || String(partnerName).toLowerCase() === gene.toLowerCase()) {
        continue;
      }
      seen.add(partnerName);

      // STRING score can be 0-1000 (integer) or 0-1 (float); normalize to 0-1
      const rawScore = interaction.score ?? interaction.combined_score ?? 0;
      const combinedScore = typeof rawScore === 'number' ? rawScore : parseFloat(String(rawScore)) || 0;
      const scoreNormalized = combinedScore > 1 ? combinedScore / 1000 : combinedScore;

      const expRaw = interaction.escore ?? interaction.experimental_score ?? 0;
      const experimentalScore = typeof expRaw === 'number' ? expRaw : parseFloat(String(expRaw)) || 0;

      interactions.push({
        protein: String(partnerName),
        score: Math.min(1, Math.max(0, scoreNormalized)),
        experimentalEvidence: experimentalScore > 0,
      });
    }
    
    // Sort by score descending
    return interactions.sort((a, b) => b.score - a.score).slice(0, 15);
  } catch (e) {
    console.error('Protein interactions fetch error:', e);
    return [];
  }
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
    const [depmap, clinicalTrials, drugs, interactions] = await Promise.all([
      fetchDepMapData(gene),
      fetchClinicalTrials(gene),
      fetchDrugTargets(gene),
      fetchProteinInteractions(gene),
    ]);

    const details: GeneDetails = {
      depmap: depmap || undefined,
      drugs: drugs.length > 0 ? drugs : undefined,
      clinicalTrials: clinicalTrials.length > 0 ? clinicalTrials : undefined,
      interactions: interactions.length > 0 ? interactions : undefined,
    };

    return NextResponse.json({
      gene,
      ...details,
    });
  } catch (error) {
    console.error('Gene details API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch gene details',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
