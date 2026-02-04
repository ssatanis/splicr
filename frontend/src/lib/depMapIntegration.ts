/**
 * DepMap integration for comparing screen hits to Cancer Dependency Map.
 * Uses DepMap portal API where possible; otherwise provides links to depmap.org.
 */

export interface DepMapGeneSummary {
  gene: string;
  dependencyScore: number | null;  // Chronos or DEMETER2 score (negative = essential)
  meanDependency?: number;
  cellLineCount?: number;
}

const DEPMAP_PORTAL_API = 'https://depmap.org/portal/api';

/**
 * Fetch dependency summary for given genes from our API proxy (which may call DepMap).
 * Returns empty array if API not available or genes not found.
 */
export async function fetchDepMapScores(genes: string[]): Promise<DepMapGeneSummary[]> {
  if (genes.length === 0) return [];
  try {
    const res = await fetch(
      `/api/depmap?genes=${encodeURIComponent(genes.slice(0, 100).join(','))}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : data?.genes ?? [];
  } catch {
    return [];
  }
}

/**
 * Link to DepMap gene page.
 */
export function depMapGeneLink(gene: string): string {
  return `https://depmap.org/portal/gene/${encodeURIComponent(gene)}?tab=overview`;
}

/**
 * Label for comparison: "Validated" (essential in both), "Novel" (our hit not in DepMap top essentials), etc.
 */
export function getComparisonLabel(
  ourLog2FC: number,
  depMapScore: number | null,
  depMapEssentialThreshold = -0.5
): 'Validated' | 'Novel' | 'Consistent' | '—' {
  if (depMapScore == null) return '—';
  const depMapEssential = depMapScore <= depMapEssentialThreshold;
  const ourDepleted = ourLog2FC < -0.5;
  if (ourDepleted && depMapEssential) return 'Validated';
  if (ourDepleted && !depMapEssential) return 'Novel';
  if (!ourDepleted && depMapEssential) return 'Consistent';
  return '—';
}
