/**
 * Client API for Screen-to-Structure integration
 * Calls Next.js API routes that proxy to RCSB, AlphaFold, PubMed, and cache.
 */

import type { StructureMatchResult } from '@/types/structure-viewer';
import type { PubMedArticle } from '@/types/ai.types';
import type { StructureOption } from './screenStructureTypes';

const API_BASE = typeof window !== 'undefined' ? '' : (process.env.NEXT_PUBLIC_APP_URL ?? '');

export async function findGeneStructures(geneName: string): Promise<StructureMatchResult[]> {
  const res = await fetch(`${API_BASE}/_api_build_skip/structure/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geneName: geneName.trim().toUpperCase() }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Structure search failed: ${res.status}`);
  }
  const data = await res.json();
  return data.result_set ?? [];
}

export async function getAlphaFoldForGene(geneName: string): Promise<{ uniprotId: string; url: string } | null> {
  const res = await fetch(
    `${API_BASE}/_api_build_skip/structure/alphafold?gene=${encodeURIComponent(geneName.trim())}`
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.available || !data.url) return null;
  return { uniprotId: data.uniprotId, url: data.url };
}

export async function getStructureCache(geneName: string): Promise<{
  cached: boolean;
  pdb_matches?: string[];
  alphafold_id?: string | null;
  last_updated?: string;
}> {
  const res = await fetch(
    `${API_BASE}/_api_build_skip/structure/cache?gene=${encodeURIComponent(geneName.trim().toUpperCase())}`
  );
  const data = await res.json();
  return data;
}

export async function setStructureCache(
  geneName: string,
  pdbMatches: string[],
  alphafoldId?: string | null
): Promise<void> {
  await fetch(`${API_BASE}/_api_build_skip/structure/cache`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gene_name: geneName.trim().toUpperCase(),
      pdb_matches: pdbMatches,
      alphafold_id: alphafoldId ?? null,
    }),
  });
}

export async function fetchLiterature(
  gene: string,
  limit = 10
): Promise<PubMedArticle[]> {
  const res = await fetch(
    `${API_BASE}/_api_build_skip/literature/pubmed?gene=${encodeURIComponent(gene)}&limit=${limit}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.articles ?? [];
}

export async function fetchArticleByPmid(pmid: string): Promise<PubMedArticle | null> {
  const res = await fetch(
    `${API_BASE}/_api_build_skip/literature/pubmed?pmid=${encodeURIComponent(pmid)}`
  );
  if (!res.ok) return null;
  const data = await res.json();
  const list = data.articles ?? [];
  return list[0] ?? null;
}

/** Fetch PubMed articles that mention a PDB ID (structure-related papers). */
export async function fetchLiteratureByPdb(
  pdbId: string,
  limit = 8
): Promise<PubMedArticle[]> {
  if (!pdbId || pdbId.length < 4 || pdbId === 'Upload') return [];
  const res = await fetch(
    `${API_BASE}/_api_build_skip/literature/pubmed?pdb=${encodeURIComponent(pdbId)}&limit=${limit}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.articles ?? [];
}

/**
 * Resolve all structure options for a gene: PDB (from RCSB or cache) + AlphaFold.
 * Uses cache when fresh; otherwise calls RCSB and AlphaFold, then caches.
 */
export async function resolveStructuresForGene(
  geneName: string,
  options?: { useCache?: boolean; preferExperimental?: boolean }
): Promise<StructureOption[]> {
  const useCache = options?.useCache !== false;
  const preferExperimental = options?.preferExperimental !== false;
  const gene = geneName.trim().toUpperCase();

  let pdbIds: string[] = [];
  let pdbDetails: StructureMatchResult[] = [];
  let alphafold: { uniprotId: string; url: string } | null = null;

  if (useCache) {
    const cached = await getStructureCache(gene);
    if (cached.cached) {
      pdbIds = cached.pdb_matches ?? [];
      if (cached.alphafold_id) {
        alphafold = {
          uniprotId: cached.alphafold_id,
          url: `https://alphafold.ebi.ac.uk/files/AF-${cached.alphafold_id}-F1-model_v4.pdb`,
        };
      } else {
        alphafold = await getAlphaFoldForGene(gene);
        if (alphafold) await setStructureCache(gene, pdbIds, alphafold.uniprotId);
      }
    }
  }

  if (pdbIds.length === 0) {
    try {
      const results = await findGeneStructures(gene);
      pdbDetails = results;
      pdbIds = results.map((r) => r.identifier);
      if (useCache) {
        const af = await getAlphaFoldForGene(gene);
        if (af) alphafold = af;
        await setStructureCache(gene, pdbIds, alphafold?.uniprotId ?? null);
      }
    } catch {
      const af = await getAlphaFoldForGene(gene);
      if (af) alphafold = af;
      if (useCache && (pdbIds.length > 0 || alphafold)) {
        await setStructureCache(gene, pdbIds, alphafold?.uniprotId ?? null);
      }
    }
  }

  const out: StructureOption[] = [];

  if (preferExperimental && pdbIds.length > 0) {
    pdbIds.forEach((id, i) => {
      const det = pdbDetails[i];
      out.push({
        type: 'pdb',
        identifier: id,
        resolution: det?.resolution,
        method: det?.method,
        title: det?.title,
      });
    });
  } else {
    pdbIds.forEach((id, i) => {
      const det = pdbDetails[i];
      out.push({
        type: 'pdb',
        identifier: id,
        resolution: det?.resolution,
        method: det?.method,
        title: det?.title,
      });
    });
  }

  if (alphafold) {
    out.push({
      type: 'alphafold',
      identifier: alphafold.uniprotId,
      uniprotId: alphafold.uniprotId,
      url: alphafold.url,
    });
  }

  return out;
}
