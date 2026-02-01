import { NextRequest, NextResponse } from 'next/server';
import { BAGEL2Analyzer } from '@/lib/analysis/bagel2';
import { rebuildMatrixFromStored } from '@/lib/analysis/runAdvancedAnalysis';
import { ESSENTIAL_GENES, NON_ESSENTIAL_GENES } from '@/lib/analysis/sgRNALibraries';

const globalStore = globalThis as any;
if (!globalStore.analysesStore) globalStore.analysesStore = new Map();
if (!globalStore.resultsStore) globalStore.resultsStore = new Map();
const analyses = globalStore.analysesStore;
const resultsStore = globalStore.resultsStore;

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { analysisId, essentialList = 'CEGv2', nonessentialList = 'NEGv1' } = body;

    if (!analysisId) {
      return NextResponse.json({ error: 'analysisId is required' }, { status: 400 });
    }

    const analysis = analyses.get(analysisId);
    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    const results = resultsStore.get(analysisId);
    if (!results?.rawData?.countMatrix) {
      return NextResponse.json(
        { error: 'No results or count matrix for this analysis. Run the main pipeline first.' },
        { status: 400 }
      );
    }

    const { countMatrix, sgRNAToGene, controlIndices, treatmentIndices } = rebuildMatrixFromStored(
      analysis,
      results
    );

    const essentialGenes = body.essentialGenes ?? ESSENTIAL_GENES;
    const nonEssentialGenes = body.nonEssentialGenes ?? NON_ESSENTIAL_GENES;
    const bagel2 = new BAGEL2Analyzer({
      essentialGenes: Array.isArray(essentialGenes) ? essentialGenes : undefined,
      nonEssentialGenes: Array.isArray(nonEssentialGenes) ? nonEssentialGenes : undefined,
      bootstrapIterations: analysis.parameters?.bagelPermutations ?? 1000
    });

    const geneResults = await bagel2.runAnalysis(
      countMatrix,
      sgRNAToGene,
      controlIndices,
      treatmentIndices
    );

    const bagel2Results = geneResults.map((r) => ({
      gene: r.gene,
      numSgRNAs: r.numSgRNAs,
      bayesFactor: r.bayesFactor,
      precision: r.precision,
      recall: r.recall,
      log2FC: r.log2FC,
      essentialProbability: r.essentialProbability,
      rank: r.rank
    }));

    const essentialCount = bagel2Results.filter((r) => r.bayesFactor > 0).length;

    return NextResponse.json({
      status: 'completed',
      algorithm: 'bagel2',
      totalGenes: bagel2Results.length,
      essentialGenes: essentialCount,
      results: bagel2Results,
      message: `BAGEL2 complete: ${essentialCount} putative essential genes`
    });
  } catch (error) {
    console.error('BAGEL2 API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to run BAGEL2' },
      { status: 500 }
    );
  }
}
