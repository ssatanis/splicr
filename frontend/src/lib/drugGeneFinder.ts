/**
 * Drug-gene interaction finder via DGIdb GraphQL API (https://dgidb.org/api)
 * Find FDA-approved and investigational drugs targeting screen hits.
 */

const DGIDB_GRAPHQL = 'https://dgidb.org/api/graphql';

export interface DrugGeneInteraction {
  gene: string;
  drugName: string;
  drugConceptId: string | null;
  interactionScore: number | null;
  interactionTypes: string[];
  directionality: string | null;
  sources: string[];
  pmids: string[];
  attributes: { name: string; value: string }[];
}

interface DGIdbGeneNode {
  name?: string;
  interactions?: Array<{
    drug?: { name?: string; conceptId?: string };
    interactionScore?: number;
    interactionTypes?: Array<{ type?: string; directionality?: string }>;
    sources?: Array<{ sourceDbName?: string }>;
    publications?: Array<{ pmid?: string }>;
    interactionAttributes?: Array<{ name?: string; value?: string }>;
  }>;
}

/**
 * Fetch drug-gene interactions for a list of genes from DGIdb.
 */
export async function fetchDrugGeneInteractions(
  geneNames: string[],
  limitPerGene = 20
): Promise<DrugGeneInteraction[]> {
  const unique = [...new Set(geneNames)].filter(Boolean).slice(0, 50);
  if (unique.length === 0) return [];

  const query = `query GetInteractions($names: [String!]!) {
    genes(names: $names) {
      nodes {
        name
        interactions {
          drug { name conceptId }
          interactionScore
          interactionTypes { type directionality }
          sources { sourceDbName }
          publications { pmid }
          interactionAttributes { name value }
        }
      }
    }
  }`;

  const res = await fetch(DGIDB_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { names: unique } }),
  });
  if (!res.ok) throw new Error(`DGIdb API failed: ${res.status}`);

  const json = await res.json();
  const nodes = (json?.data?.genes?.nodes ?? []) as DGIdbGeneNode[];
  const out: DrugGeneInteraction[] = [];

  for (const node of nodes) {
    const gene = node.name ?? '';
    const interactions = node.interactions ?? [];
    for (const int of interactions.slice(0, limitPerGene)) {
      const drug = int.drug;
      if (!drug?.name) continue;
      out.push({
        gene,
        drugName: drug.name,
        drugConceptId: drug.conceptId ?? null,
        interactionScore: int.interactionScore ?? null,
        interactionTypes: (int.interactionTypes ?? []).map((t) => t.type ?? '').filter(Boolean),
        directionality: int.interactionTypes?.[0]?.directionality ?? null,
        sources: (int.sources ?? []).map((s) => s.sourceDbName ?? '').filter(Boolean),
        pmids: (int.publications ?? []).map((p) => p.pmid ?? '').filter(Boolean),
        attributes: (int.interactionAttributes ?? []).map((a) => ({ name: a.name ?? '', value: a.value ?? '' })),
      });
    }
  }

  return out;
}

/** Link to DrugBank for a drug name */
export function drugBankLink(drugName: string): string {
  return `https://go.drugbank.com/unearth/q?query=${encodeURIComponent(drugName)}`;
}

/** Link to ClinicalTrials.gov for a drug */
export function clinicalTrialsLink(drugName: string): string {
  return `https://clinicaltrials.gov/search?term=${encodeURIComponent(drugName)}`;
}

/** Link to PubChem for a drug */
export function pubChemLink(drugName: string): string {
  return `https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(drugName)}`;
}
