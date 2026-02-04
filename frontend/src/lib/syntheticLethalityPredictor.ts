/**
 * Genetic interaction / synthetic lethality predictor.
 * Uses STRING API for protein–protein interactions; ranks pairs where both genes
 * are in the screen hit list (potential synthetic lethal or combination targets).
 */

const STRING_API = 'https://string-db.org/api';
const SPECIES = 9606;

export interface PredictedInteraction {
  geneA: string;
  geneB: string;
  score: number;
  combinedScore: number;
  source: 'STRING';
  description?: string;
}

/**
 * Fetch STRING network for genes and return high-confidence edges.
 * Pairs where both genes are in the input list are candidate genetic interactions.
 */
export async function fetchStringInteractions(
  geneNames: string[],
  minScore = 0.4
): Promise<PredictedInteraction[]> {
  const unique = [...new Set(geneNames)].filter(Boolean).slice(0, 100);
  if (unique.length < 2) return [];

  const identifiers = unique.join('\r\n');
  const url = `${STRING_API}/tsv/network?identifiers=${encodeURIComponent(identifiers)}&species=${SPECIES}&required_score=${Math.round(minScore * 1000)}&caller_identity=splicr.app`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const text = await res.text();
  const lines = text.trim().split('\n');
  const header = lines[0]?.toLowerCase() ?? '';
  const nameAIdx = header.includes('preferredname_a') ? header.split('\t').indexOf('preferredname_a') : 2;
  const nameBIdx = header.includes('preferredname_b') ? header.split('\t').indexOf('preferredname_b') : 3;
  const scoreIdx = header.includes('score') ? header.split('\t').indexOf('score') : 5;
  const geneSet = new Set(unique.map((g) => g.toUpperCase()));

  const out: PredictedInteraction[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const a = (cols[nameAIdx] ?? '').trim();
    const b = (cols[nameBIdx] ?? '').trim();
    const score = parseFloat(cols[scoreIdx] ?? '0') || 0;
    if (!a || !b || score < minScore) continue;
    if (!geneSet.has(a.toUpperCase()) || !geneSet.has(b.toUpperCase())) continue;
    out.push({
      geneA: a,
      geneB: b,
      score,
      combinedScore: score,
      source: 'STRING',
      description: `STRING combined score ${(score * 1000).toFixed(0)}`,
    });
  }
  out.sort((x, y) => y.combinedScore - x.combinedScore);
  return out;
}

/**
 * Link to PubMed search for "synthetic lethality" + gene pair.
 */
export function pubmedSyntheticLethalityLink(geneA: string, geneB: string): string {
  const query = encodeURIComponent(`synthetic lethality ${geneA} ${geneB}`);
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${query}`;
}

/**
 * Link to STRING network for a gene pair.
 */
export function stringPairLink(geneA: string, geneB: string): string {
  return `https://string-db.org/cgi/network?identifiers=${encodeURIComponent(geneA)}%0d${encodeURIComponent(geneB)}&species=9606`;
}
