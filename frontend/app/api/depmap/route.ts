import { NextRequest, NextResponse } from 'next/server';
import depmapGeneScores from '@/lib/depmap-gene-scores.json';

/**
 * Proxy for DepMap dependency data. Returns dependency scores (CERES-like, negative = essential)
 * for requested genes. Uses a built-in map of real DepMap-style mean dependency scores for
 * common genes; genes not in the map return null.
 */
const scoresMap = depmapGeneScores as Record<string, number>;

export async function GET(request: NextRequest) {
  try {
    const genesParam = request.nextUrl.searchParams.get('genes');
    const genes = genesParam ? genesParam.split(',').map((g) => g.trim()).filter(Boolean) : [];
    if (genes.length === 0) {
      return NextResponse.json([]);
    }

    const results = genes.map((gene) => {
      const upper = gene.toUpperCase();
      const score = scoresMap[upper] ?? scoresMap[gene] ?? null;
      return {
        gene,
        dependencyScore: score,
        meanDependency: score ?? undefined,
        cellLineCount: undefined,
      };
    });

    return NextResponse.json(results);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
