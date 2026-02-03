import { NextRequest, NextResponse } from 'next/server';

const RCSB_CORE = 'https://data.rcsb.org/rest/v1/core';

interface RcsbEntryResponse {
  struct?: { title?: string };
  rcsb_entry_info?: {
    deposited_atom_count?: number;
    polymer_entity_count_protein?: number;
    source_organism?: Array<{ ncbi_scientific_name?: string }>;
  };
  rcsb_accession_info?: {
    deposit_date?: string;
    initial_release_date?: string;
  };
  rcsb_primary_citation?: {
    title?: string;
    journal_abbrev?: string;
    year?: string | number;
    pdbx_database_id_DOI?: string;
    pdbx_database_id_PubMed?: string;
  };
  audit_author?: Array<{ name?: string }>;
  exptl?: Array<{ method?: string }>;
  refine?: Array<{
    ls_d_res_high?: number;
    ls_R_factor_R_work?: number;
    ls_R_factor_R_free?: number;
  }>;
  em_3d_reconstruction?: Array<{ resolution?: number }>;
  pdbx_vrpt_summary?: { clashscore?: number };
}

/**
 * GET /api/structure/rcsb?pdbId=5F9R
 * Fetches structure metadata from RCSB PDB Data API (title, organism, resolution, citation, authors, quality).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pdbId = searchParams.get('pdbId')?.trim().toUpperCase();
    if (!pdbId || pdbId.length < 4 || pdbId.length > 10) {
      return NextResponse.json(
        { error: 'Missing or invalid pdbId. Use ?pdbId=5F9R' },
        { status: 400 }
      );
    }

    const res = await fetch(`${RCSB_CORE}/entry/${pdbId}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json({ error: 'Structure not found' }, { status: 404 });
      }
      return NextResponse.json(
        { error: `RCSB API error: ${res.status}` },
        { status: 502 }
      );
    }

    const data = (await res.json()) as RcsbEntryResponse;
    const struct = data.struct;
    const entryInfo = data.rcsb_entry_info;
    const accessionInfo = data.rcsb_accession_info;
    const citation = data.rcsb_primary_citation;
    const authors = data.audit_author?.map((a) => a.name ?? '').filter(Boolean) ?? [];
    const exptl = data.exptl?.[0];
    const refine = data.refine?.[0];
    const em = data.em_3d_reconstruction?.[0];

    const title = struct?.title ?? citation?.title ?? null;
    const resolution =
      (typeof refine?.ls_d_res_high === 'number' && refine.ls_d_res_high > 0
        ? refine.ls_d_res_high
        : em?.resolution) ?? null;
    const depositionDate = accessionInfo?.deposit_date ?? null;
    const releaseDate = accessionInfo?.initial_release_date ?? null;
    const organism = entryInfo?.source_organism?.[0]?.ncbi_scientific_name ?? null;
    const method = exptl?.method ?? null;
    const atomCount = entryInfo?.deposited_atom_count ?? null;
    const chainCount = entryInfo?.polymer_entity_count_protein ?? null;
    const rWork = refine?.ls_R_factor_R_work ?? null;
    const rFree = refine?.ls_R_factor_R_free ?? null;
    const clashScore = data.pdbx_vrpt_summary?.clashscore ?? null;

    return NextResponse.json({
      pdbId,
      title,
      resolution: typeof resolution === 'number' && resolution > 0 ? resolution : null,
      depositionDate,
      releaseDate,
      organism,
      method,
      atomCount,
      chainCount,
      authors: authors.length > 0 ? authors : null,
      citation: citation
        ? {
            title: citation.title ?? null,
            journal: citation.journal_abbrev ?? null,
            year: citation.year != null ? Number(citation.year) : null,
            doi: citation.pdbx_database_id_DOI ?? null,
            pmid: citation.pdbx_database_id_PubMed ?? null,
          }
        : null,
      quality: {
        rValue: typeof rWork === 'number' ? rWork : null,
        rFree: typeof rFree === 'number' ? rFree : null,
        clashScore: typeof clashScore === 'number' ? clashScore : null,
      },
    });
  } catch (err) {
    console.error('RCSB API error:', err);
    return NextResponse.json(
      {
        error: 'Failed to fetch structure info',
        details: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
