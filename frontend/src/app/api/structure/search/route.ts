import { NextRequest, NextResponse } from 'next/server';
import type { StructureMatchResult } from '@/types/structure-viewer';

const RCSB_SEARCH_URL = 'https://search.rcsb.org/rcsbsearch/v2/query';

function parseRCSBResult(hit: any): StructureMatchResult {
  const id = typeof hit === 'string' ? hit : hit?.identifier ?? hit?.struct_id ?? '';
  return {
    identifier: id.toUpperCase(),
    score: hit?.score,
    title: hit?.title ?? hit?.struct?.title,
    resolution: hit?.resolution ?? hit?.rcsb_entry_info?.resolution_combined,
    method: hit?.exptl?.[0]?.method ?? hit?.experimental_method,
    organism: hit?.src_organism?.[0]?.ncbi_scientific_name ?? hit?.organism,
    deposition_date: hit?.rcsb_accession_info?.initial_release_date ?? hit?.deposition_date,
    citation: hit?.citation ? { title: hit.citation.title, pmid: hit.citation.pmid, doi: hit.citation.doi } : undefined,
  };
}

/**
 * POST /api/structure/search
 * Body: { geneName: string }
 * Proxies to RCSB PDB Search API v2 for gene name exact match.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const geneName = (body.geneName ?? body.gene ?? '').trim().toUpperCase();
    if (!geneName || geneName.length > 30) {
      return NextResponse.json(
        { error: 'Missing or invalid gene name. Use { "geneName": "TP53" }' },
        { status: 400 }
      );
    }

    const query = {
      query: {
        type: 'terminal',
        service: 'text',
        parameters: {
          attribute: 'rcsb_entity_source_organism.rcsb_gene_name.value',
          operator: 'exact_match',
          value: geneName,
          case_sensitive: false,
        },
      },
      return_type: 'entry',
      request_options: {
        results_content_type: ['experimental'],
        results_verbosity: 'minimal',
        sort: [{ sort_by: 'score', direction: 'desc' }],
        paginate: { start: 0, rows: 20 },
      },
    };

    const res = await fetch(RCSB_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    });

    if (res.status === 204) {
      return NextResponse.json({ result_set: [], total_count: 0 });
    }

    if (!res.ok) {
      const text = await res.text();
      console.error('RCSB search error:', res.status, text);
      return NextResponse.json(
        { error: 'RCSB search failed', details: text.slice(0, 200) },
        { status: 502 }
      );
    }

    const data = await res.json();
    const resultSet = data.result_set ?? [];
    const totalCount = data.total_count ?? resultSet.length;
    const results: StructureMatchResult[] = resultSet.map((hit: any) => {
      const id = hit.identifier ?? hit;
      return parseRCSBResult(typeof id === 'string' ? { identifier: id, score: hit.score } : hit);
    });

    return NextResponse.json({ result_set: results, total_count: totalCount });
  } catch (error) {
    console.error('Structure search API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to search structures',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
