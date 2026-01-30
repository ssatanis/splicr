import { NextRequest, NextResponse } from 'next/server';
import { DrugZAnalyzer } from '@/lib/analysis/drugz';
import { rebuildMatrixFromStored } from '@/lib/analysis/runAdvancedAnalysis';

const globalStore = globalThis as any;
if (!globalStore.analysesStore) globalStore.analysesStore = new Map();
if (!globalStore.resultsStore) globalStore.resultsStore = new Map();
const analyses = globalStore.analysesStore;
const resultsStore = globalStore.resultsStore;

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { analysisId } = body;

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

    const drugz = new DrugZAnalyzer({
      minSgRNAs: (analysis.parameters?.minimumReads as number) ?? 3,
      unpaired: (analysis.parameters?.unpaired as boolean) ?? false
    });

    const geneResults = await drugz.runAnalysis(
      countMatrix,
      sgRNAToGene,
      controlIndices,
      treatmentIndices
    );

    const drugzResults = geneResults.map((r) => ({
      gene: r.gene,
      numSgRNAs: r.numSgRNAs,
      normZ: r.normZ,
      pValue: r.pValue,
      fdr: r.fdr,
      log2FC: r.log2FC,
      syntheticScore: r.syntheticScore,
      rank: r.rank
    }));

    const significantCount = drugzResults.filter((r) => r.fdr < 0.05).length;

    return NextResponse.json({
      status: 'completed',
      algorithm: 'drugz',
      totalGenes: drugzResults.length,
      significantGenes: significantCount,
      results: drugzResults,
      message: `DrugZ complete: ${significantCount} significant genes (FDR < 0.05)`
    });
  } catch (error) {
    console.error('DrugZ API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to run DrugZ' },
      { status: 500 }
    );
  }
}
