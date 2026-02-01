import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

const DGIDB_GRAPHQL = 'https://dgidb.org/api/graphql';
const CACHE_DAYS = 7;
const CACHE_MS = CACHE_DAYS * 24 * 60 * 60 * 1000;

const DRUG_GENE_QUERY = `
  query InteractionSearch($genes: [String!]!) {
    genes(names: $genes) {
      nodes {
        name
        longName
        interactions {
          edges {
            node {
              drug {
                name
                conceptId
                approved
                immunotherapy
                antiNeoplastic
              }
              interactionTypes {
                type
                directionality
              }
              publications {
                pmid
              }
              sources {
                name
              }
            }
          }
        }
      }
    }
  }
`;

function isValidGene(s: string): boolean {
  return /^[A-Za-z0-9\-\.]+$/.test(s) && s.length >= 1 && s.length <= 30;
}

async function fetchDgidb(genes: string[]): Promise<any> {
  const res = await fetch(DGIDB_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: DRUG_GENE_QUERY, variables: { genes } }),
  });
  if (!res.ok) throw new Error(`DGIdb ${res.status}`);
  return res.json();
}

function normalizeDrugsFromApi(data: any): { gene: string; geneName: string; drugs: any[] }[] {
  const results: { gene: string; geneName: string; drugs: any[] }[] = [];
  const nodes = data?.data?.genes?.nodes ?? [];
  for (const g of nodes) {
    const edges = g.interactions?.edges ?? [];
    const drugsMap = new Map<string, any>();
    for (const e of edges) {
      const node = e?.node;
      const drug = node?.drug;
      if (!drug?.name) continue;
      const key = drug.name.toUpperCase();
      if (!drugsMap.has(key)) {
        drugsMap.set(key, {
          name: drug.name,
          conceptId: drug.conceptId ?? null,
          approved: !!drug.approved,
          antiNeoplastic: !!drug.antiNeoplastic,
          interactionTypes: (node.interactionTypes ?? []).map((t: any) => ({
            type: t?.type ?? 'unknown',
            directionality: t?.directionality ?? 'n/a',
          })),
          sources: [...new Set((node.sources ?? []).map((s: any) => s?.name).filter(Boolean))],
          pmids: [...new Set((node.publications ?? []).map((p: any) => p?.pmid).filter(Boolean))],
        });
      } else {
        const existing = drugsMap.get(key)!;
        (node.interactionTypes ?? []).forEach((t: any) => {
          const type = t?.type ?? 'unknown';
          if (!existing.interactionTypes.some((x: any) => x.type === type))
            existing.interactionTypes.push({ type: type, directionality: t?.directionality ?? 'n/a' });
        });
        (node.sources ?? []).forEach((s: any) => {
          if (s?.name && !existing.sources.includes(s.name)) existing.sources.push(s.name);
        });
        (node.publications ?? []).forEach((p: any) => {
          if (p?.pmid && !existing.pmids.includes(p.pmid)) existing.pmids.push(p.pmid);
        });
      }
    }
    const drugs = Array.from(drugsMap.values()).sort((a, b) => {
      if (a.approved !== b.approved) return a.approved ? -1 : 1;
      return (b.sources?.length ?? 0) - (a.sources?.length ?? 0);
    });
    results.push({
      gene: g.name ?? '',
      geneName: g.longName ?? g.name ?? '',
      drugs,
    });
  }
  return results;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const genesParam = searchParams.get('genes');
    const forceRefresh = searchParams.get('force') === 'true';

    if (!genesParam) {
      return NextResponse.json(
        { error: 'Missing genes', details: 'Use ?genes=TP53,BRCA1' },
        { status: 400 }
      );
    }
    const genes = genesParam
      .split(',')
      .map((g) => g.trim().toUpperCase())
      .filter(Boolean)
      .filter((g, i, a) => a.indexOf(g) === i)
      .slice(0, 20);
    if (genes.length === 0 || genes.some((g) => !isValidGene(g))) {
      return NextResponse.json(
        { error: 'Invalid or missing gene symbols' },
        { status: 400 }
      );
    }

    const results: { gene: string; geneName: string; totalInteractions: number; drugs: any[] }[] = [];
    let totalDrugs = 0;
    let approvedDrugs = 0;

    for (const gene of genes) {
      // Only check cache if not forcing refresh
      if (!forceRefresh) {
        const { data: cachedRow } = await supabaseAdmin
          .from('drug_gene_cache')
          .select('drugs, cached_at')
          .eq('gene_symbol', gene)
          .maybeSingle();
        const cached = cachedRow as { drugs: unknown; cached_at: string } | null;
        const cachedAt = cached?.cached_at ? new Date(cached.cached_at).getTime() : 0;
        if (cached && Date.now() - cachedAt < CACHE_MS && Array.isArray(cached.drugs)) {
          const drugs = cached.drugs as any[];
          results.push({
            gene,
            geneName: gene,
            totalInteractions: drugs.length,
            drugs,
          });
          totalDrugs += drugs.length;
          approvedDrugs += drugs.filter((d) => d.approved).length;
          continue;
        }
      }

      let apiData: any;
      try {
        apiData = await fetchDgidb([gene]);
      } catch (e) {
        results.push({ gene, geneName: gene, totalInteractions: 0, drugs: [] });
        continue;
      }
      const normalized = normalizeDrugsFromApi(apiData ?? {});
      const row = normalized[0];
      const drugs = row?.drugs ?? [];
      results.push({
        gene,
        geneName: row?.geneName ?? gene,
        totalInteractions: drugs.length,
        drugs,
      });
      totalDrugs += drugs.length;
      approvedDrugs += drugs.filter((d: any) => d.approved).length;

      if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        const table = supabaseAdmin.from('drug_gene_cache');
        const { data: existing } = await table.select('id').eq('gene_symbol', gene).maybeSingle();
        const row = { drugs, cached_at: new Date().toISOString() };
        if (existing) {
          await (table as any).update(row).eq('gene_symbol', gene);
        } else {
          await (table as any).insert({ gene_symbol: gene, ...row });
        }
      }
    }

    return NextResponse.json({
      results,
      summary: {
        totalGenes: genes.length,
        totalDrugs,
        approvedDrugs,
      },
    });
  } catch (error) {
    console.error('Drug-gene GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch drug-gene data', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: { genes?: string[] };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const genes = (body.genes ?? [])
      .filter((g) => typeof g === 'string' && isValidGene(g))
      .map((g) => String(g).trim().toUpperCase())
      .filter((g, i, a) => a.indexOf(g) === i)
      .slice(0, 15);
    if (genes.length < 2) {
      return NextResponse.json(
        { error: 'Provide at least 2 genes for combinations', details: 'Body: { "genes": ["TP53", "BRCA1"] }' },
        { status: 400 }
      );
    }

    const allResults: { gene: string; geneName: string; drugs: any[] }[] = [];
    try {
      const apiData = await fetchDgidb(genes);
      const nodes = apiData?.data?.genes?.nodes ?? [];
      const normalized = normalizeDrugsFromApi({ data: { genes: { nodes } } });
      allResults.push(...normalized);
    } catch (e) {
      return NextResponse.json({
        combinations: [],
        error: 'Could not fetch drug-gene data from DGIdb',
      });
    }

    const geneToDrugs = new Map<string, any[]>();
    for (const r of allResults) {
      const approved = (r.drugs ?? []).filter((d) => d.approved);
      geneToDrugs.set(r.gene, approved);
    }

    const combinations: {
      drugA: string;
      drugB: string;
      targetedGenesA: string[];
      targetedGenesB: string[];
      mechanismA: string;
      mechanismB: string;
      synergyScore: number;
      rationale: string;
      evidenceStrength: string;
    }[] = [];
    const seen = new Set<string>();

    for (const geneA of genes) {
      const drugsA = geneToDrugs.get(geneA) ?? [];
      for (const drugA of drugsA.slice(0, 25)) {
        const nameA = drugA.name?.toUpperCase();
        const typesA = drugA.interactionTypes?.map((t: any) => t.type).filter(Boolean) ?? [];
        const mechanismA = typesA[0] ?? 'unknown';
        for (const geneB of genes) {
          if (geneB === geneA) continue;
          const drugsB = geneToDrugs.get(geneB) ?? [];
          for (const drugB of drugsB.slice(0, 25)) {
            const nameB = drugB.name?.toUpperCase();
            if (nameA === nameB) continue;
            const key = [nameA, nameB].sort().join('|');
            if (seen.has(key)) continue;
            seen.add(key);
            const typesB = drugB.interactionTypes?.map((t: any) => t.type).filter(Boolean) ?? [];
            const mechanismB = typesB[0] ?? 'unknown';
            const nonOverlap = 0.3;
            const diffMech = mechanismA !== mechanismB ? 0.2 : 0;
            const sourcesScore = Math.min(0.4, ((drugA.sources?.length ?? 0) + (drugB.sources?.length ?? 0)) / 20 * 0.4);
            const pubScore = Math.min(0.1, ((drugA.pmids?.length ?? 0) + (drugB.pmids?.length ?? 0)) / 50 * 0.1);
            const synergyScore = Math.round((nonOverlap + diffMech + sourcesScore + pubScore) * 100) / 100;
            combinations.push({
              drugA: drugA.name,
              drugB: drugB.name,
              targetedGenesA: [geneA],
              targetedGenesB: [geneB],
              mechanismA,
              mechanismB,
              synergyScore,
              rationale: `${drugA.name} targets ${geneA} while ${drugB.name} targets ${geneB}, providing complementary effects.`,
              evidenceStrength: synergyScore >= 0.7 ? 'Strong' : synergyScore >= 0.4 ? 'Moderate' : 'Limited',
            });
          }
        }
      }
    }

    combinations.sort((a, b) => b.synergyScore - a.synergyScore);
    const top = combinations.slice(0, 10);

    return NextResponse.json({ combinations: top });
  } catch (error) {
    console.error('Drug-gene POST error:', error);
    return NextResponse.json(
      { error: 'Failed to compute combinations', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
