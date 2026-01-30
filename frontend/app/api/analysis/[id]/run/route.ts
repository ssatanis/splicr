import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/server';

/**
 * Simulated CRISPR analysis pipeline
 * In production, this would call your actual analysis backend
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const analysisId = params.id;

  try {
    // Get analysis details
    const { data: analysis, error } = await (supabaseAdmin as any)
      .from('analyses')
      .select('*')
      .eq('id', analysisId)
      .single();

    if (error || !analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    // Normalize file_names (may be in parameters.r2Keys on older schema)
    const analysisWithFiles = {
      ...analysis,
      file_names: analysis.file_names?.length ? analysis.file_names : (analysis.parameters?.r2Keys || []),
    };

    // Run analysis in background
    runAnalysisPipeline(analysisId, analysisWithFiles).catch(console.error);

    return NextResponse.json({
      success: true,
      message: 'Analysis processing started',
      analysisId
    });
  } catch (error) {
    console.error('Run analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to start analysis' },
      { status: 500 }
    );
  }
}

/**
 * Simulated analysis pipeline with real progress updates
 */
async function runAnalysisPipeline(analysisId: string, analysis: any) {
  const steps = [
    { name: 'Validating input files', progress: 10, duration: 1000 },
    { name: 'Parsing FASTQ files', progress: 20, duration: 2000 },
    { name: 'Counting sgRNA reads', progress: 35, duration: 3000 },
    { name: 'Quality control checks', progress: 50, duration: 2000 },
    { name: 'Normalizing read counts', progress: 60, duration: 1500 },
    { name: 'Running MAGeCK analysis', progress: 75, duration: 4000 },
    { name: 'Calculating gene scores', progress: 85, duration: 2000 },
    { name: 'Generating visualizations', progress: 95, duration: 2000 },
    { name: 'Finalizing results', progress: 100, duration: 500 },
  ];

  const logs: any[] = [];

  try {
    for (const step of steps) {
      // Update progress in database (current_step optional - add column via migration if needed)
      const updatePayload: Record<string, unknown> = {
        status: 'running',
        progress: step.progress,
      };
      await (supabaseAdmin as any)
        .from('analyses')
        .update(updatePayload)
        .eq('id', analysisId);

      // Add log entry
      logs.push({
        timestamp: new Date().toISOString(),
        step: step.name,
        message: `${step.name}...`,
        progress: step.progress,
        level: 'info',
      });

      // Update logs in database
      await (supabaseAdmin as any)
        .from('analyses')
        .update({ logs })
        .eq('id', analysisId);

      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, step.duration));
    }

    // Generate mock results
    const results = generateMockResults(analysis);

    // Update with final results (qc_metrics lives inside results, not as separate column)
    await (supabaseAdmin as any)
      .from('analyses')
      .update({
        status: 'complete',
        progress: 100,
        results,
        logs,
        completed_at: new Date().toISOString(),
      })
      .eq('id', analysisId);

  } catch (error) {
    console.error('Analysis pipeline error:', error);

    await (supabaseAdmin as any)
      .from('analyses')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Analysis failed',
        logs,
      })
      .eq('id', analysisId);
  }
}

/**
 * Generate realistic mock CRISPR screen results
 */
function generateMockResults(analysis: any) {
  const numGenes = 500;
  const genes: any[] = [];

  // Generate gene results with realistic distribution
  for (let i = 0; i < numGenes; i++) {
    const lfc = (Math.random() - 0.5) * 6; // Log fold change between -3 and 3
    const pValue = Math.pow(10, -Math.random() * 10); // p-value distribution
    const fdr = Math.min(1, pValue * numGenes / (i + 1)); // BH correction approximation

    genes.push({
      gene: `GENE${String(i + 1).padStart(4, '0')}`,
      sgrnaCount: Math.floor(Math.random() * 4) + 4,
      logFoldChange: Number(lfc.toFixed(3)),
      pValue: Number(pValue.toExponential(2)),
      fdr: Number(fdr.toFixed(4)),
      rank: i + 1,
    });
  }

  // Sort by absolute LFC for ranking
  genes.sort((a, b) => Math.abs(b.logFoldChange) - Math.abs(a.logFoldChange));
  genes.forEach((g, i) => g.rank = i + 1);

  const significantGenes = genes.filter(g => g.fdr < 0.05);
  const enriched = genes.filter(g => g.fdr < 0.05 && g.logFoldChange > 0);
  const depleted = genes.filter(g => g.fdr < 0.05 && g.logFoldChange < 0);

  // Generate volcano data points
  const volcanoData = genes.map(g => ({
    gene: g.gene,
    log2FC: g.logFoldChange,
    negLog10P: -Math.log10(g.pValue),
    fdr: g.fdr,
    isSignificant: g.fdr < 0.05,
  }));

  return {
    id: analysis.id,
    summary: {
      totalGenes: numGenes,
      significantHits: significantGenes.length,
      enriched: enriched.length,
      depleted: depleted.length,
    },
    qcMetrics: {
      totalReads: Math.floor(Math.random() * 50000000) + 10000000,
      mappingRate: 85 + Math.random() * 10,
      zeroCounts: Math.floor(Math.random() * 500),
      libraryCoverage: 95 + Math.random() * 4,
      giniCoefficient: 0.1 + Math.random() * 0.2,
      sampleStats: (analysis.file_names || []).map((f: string, i: number) => ({
        name: `Sample ${i + 1}`,
        totalReads: Math.floor(Math.random() * 20000000) + 5000000,
        uniqueSgRNAs: Math.floor(Math.random() * 10000) + 70000,
        mappingRate: (85 + Math.random() * 10).toFixed(1) + '%',
        avgQuality: (30 + Math.random() * 5).toFixed(1),
        gcContent: (45 + Math.random() * 10).toFixed(1) + '%',
      })),
    },
    topHits: {
      depleted: depleted.slice(0, 20),
      enriched: enriched.slice(0, 20),
    },
    allGenes: genes,
    volcanoData,
    logs: [],
    plots: {
      volcano: null,
      waterfall: null,
      topHits: null,
      qc: null,
    },
    rawFiles: {
      counts: null,
      geneSummary: null,
      sgrnaSummary: null,
    },
  };
}
