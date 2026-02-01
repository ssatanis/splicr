import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxy for DepMap dependency data. Returns dependency scores for requested genes.
 * DepMap portal API (depmap.org/portal/api) may require specific endpoints;
 * this route returns empty scores when external fetch is not configured,
 * and the UI still provides links to depmap.org/portal/gene/{gene}.
 */
export async function GET(request: NextRequest) {
  try {
    const genesParam = request.nextUrl.searchParams.get('genes');
    const genes = genesParam ? genesParam.split(',').map((g) => g.trim()).filter(Boolean) : [];
    if (genes.length === 0) {
      return NextResponse.json([]);
    }

    // Optional: fetch from DepMap portal API if available
    // e.g. context_explorer/analysis_data or download/gene_dep_summary (parse CSV)
    const results = genes.map((gene) => ({
      gene,
      dependencyScore: null as number | null,
      meanDependency: undefined,
      cellLineCount: undefined,
    }));

    return NextResponse.json(results);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
