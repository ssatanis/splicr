/**
 * Pathway enrichment via Enrichr API (https://maayanlab.cloud/Enrichr/)
 * One-click GO, KEGG, Reactome enrichment from significant genes.
 */

const ENRICHR_BASE = 'https://maayanlab.cloud/Enrichr';

export const ENRICHR_LIBRARIES = [
  { id: 'GO_Biological_Process_2021', name: 'GO Biological Process' },
  { id: 'GO_Molecular_Function_2021', name: 'GO Molecular Function' },
  { id: 'GO_Cellular_Component_2021', name: 'GO Cellular Component' },
  { id: 'KEGG_2021_Human', name: 'KEGG 2021 Human' },
  { id: 'Reactome_2022', name: 'Reactome 2022' },
  { id: 'WikiPathway_2021_Human', name: 'WikiPathway 2021 Human' },
  { id: 'MSigDB_Hallmark_2020', name: 'MSigDB Hallmark 2020' },
] as const;

export type EnrichrLibraryId = (typeof ENRICHR_LIBRARIES)[number]['id'];

export interface EnrichmentTerm {
  term: string;
  overlap: string;       // e.g. "5/42"
  pValue: number;
  adjustedPValue: number;
  zScore: number;
  combinedScore: number;
  genes: string[];
  rank?: number;
}

export interface EnrichmentResult {
  library: string;
  terms: EnrichmentTerm[];
  queryGenes: string[];
  userListId?: number;
}

/**
 * Upload gene list to Enrichr and return userListId.
 */
export async function enrichrAddList(genes: string[], description?: string): Promise<{ userListId: number; shortId: string }> {
  const list = genes.filter(Boolean).join('\n');
  const body = new URLSearchParams();
  body.set('list', list);
  if (description) body.set('description', description);

  const res = await fetch(`${ENRICHR_BASE}/addList`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Enrichr addList failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  if (!data.userListId && !data.shortId) {
    throw new Error('Enrichr did not return userListId');
  }
  return {
    userListId: data.userListId ?? (parseInt(String(data.shortId), 36) || 0),
    shortId: (data.shortId ?? data.userListId?.toString()) ?? '',
  };
}

/**
 * Get enrichment results for a user list and library.
 */
export async function enrichrEnrich(
  userListId: number,
  library: EnrichrLibraryId
): Promise<EnrichmentTerm[]> {
  const url = `${ENRICHR_BASE}/enrich?userListId=${userListId}&backgroundType=${encodeURIComponent(library)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Enrichr enrich failed: ${res.status}`);
  const data = await res.json();

  const key = library in data ? library : Object.keys(data)[0];
  const raw = (data[key] ?? data) as unknown[];
  if (!Array.isArray(raw)) return [];

  return raw.slice(0, 50).map((row, rank) => {
    const arr = Array.isArray(row) ? row : [];
    // Enrichr format: [term, shortId?, overlap, p-value, adj p-value, genes[], z-score?, combined score?, ...]
    const term = String(arr[0] ?? arr[1] ?? '');
    const overlap = String(arr[2] ?? arr[3] ?? '');
    const pVal = arr[3] ?? arr[4];
    const adjP = arr[4] ?? arr[5];
    const genes = Array.isArray(arr[5]) ? arr[5] : Array.isArray(arr[6]) ? arr[6] : [];
    const zScore = arr[6] ?? arr[7];
    const comb = arr[7] ?? arr[8];
    return {
      term,
      overlap,
      pValue: parseFloat(String(pVal ?? 1)),
      adjustedPValue: parseFloat(String(adjP ?? 1)),
      zScore: typeof zScore === 'number' ? zScore : parseFloat(String(zScore ?? 0)),
      combinedScore: typeof comb === 'number' ? comb : parseFloat(String(comb ?? 0)),
      genes,
      rank: rank + 1,
    };
  });
}

/**
 * One-shot: add list and get enrichment for a library.
 */
export async function runPathwayEnrichment(
  genes: string[],
  library: EnrichrLibraryId
): Promise<EnrichmentResult> {
  const unique = [...new Set(genes)].filter(Boolean).slice(0, 500);
  if (unique.length === 0) return { library, terms: [], queryGenes: [] };

  const { userListId } = await enrichrAddList(unique, 'SplicR');
  const terms = await enrichrEnrich(userListId, library);
  return { library, terms, queryGenes: unique, userListId };
}
