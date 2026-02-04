import { NextRequest, NextResponse } from 'next/server';
import { loadLibrary, matchSequences, aggregateByGene, calculateQCMetrics } from '@/lib/libraryLoader';
import { FASTQParser } from '@/lib/fastqParser';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max

/**
 * POST /api/libraries/analyze
 *
 * Analyze FASTQ file against selected CRISPR library
 *
 * Request body (FormData):
 * - file: FASTQ file (plain or gzipped)
 * - libraryId: ID of the library to use
 * - adapterSequence: Optional adapter sequence (default: TCTTGTGGAAAGGACGAAACACC)
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const libraryId = formData.get('libraryId') as string;
    const adapterSequence = (formData.get('adapterSequence') as string) || 'TCTTGTGGAAAGGACGAAACACC';

    // Validate inputs
    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    if (!libraryId) {
      return NextResponse.json(
        { success: false, error: 'No library ID provided' },
        { status: 400 }
      );
    }

    console.log(`[Analyze] Starting analysis: ${file.name} with library ${libraryId}`);
    const startTime = Date.now();

    // Step 1: Parse FASTQ file
    console.log('[Analyze] Step 1: Parsing FASTQ file...');
    const { reads, stats: fastqStats } = await FASTQParser.parseFASTQ(file);
    console.log(`[Analyze] Parsed ${reads.length.toLocaleString()} reads`);

    if (reads.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No reads found in FASTQ file' },
        { status: 400 }
      );
    }

    // Step 2: Extract sgRNA sequences
    console.log('[Analyze] Step 2: Extracting sgRNA sequences...');
    const sgRNACounts = FASTQParser.extractSgRNAs(reads, adapterSequence);
    console.log(`[Analyze] Extracted ${sgRNACounts.size.toLocaleString()} unique sgRNA sequences`);

    if (sgRNACounts.size === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No valid sgRNA sequences found. Check your adapter sequence or file format.',
        },
        { status: 400 }
      );
    }

    // Step 3: Load library
    console.log('[Analyze] Step 3: Loading library...');
    const library = await loadLibrary(libraryId);
    console.log(`[Analyze] Library loaded: ${library.metadata.name} (${library.totalLoaded.toLocaleString()} sgRNAs)`);

    // Step 4: Match sequences
    console.log('[Analyze] Step 4: Matching sequences...');
    const { matches, unmatched, stats } = matchSequences(sgRNACounts, library);
    console.log(`[Analyze] Matched: ${matches.length.toLocaleString()}, Unmatched: ${unmatched.length.toLocaleString()}`);

    // Step 5: Aggregate by gene
    console.log('[Analyze] Step 5: Aggregating by gene...');
    const geneAggregated = aggregateByGene(matches, stats.totalReads);
    console.log(`[Analyze] ${geneAggregated.length.toLocaleString()} genes detected`);

    // Step 6: Calculate QC metrics
    console.log('[Analyze] Step 6: Calculating QC metrics...');
    const qcMetrics = calculateQCMetrics(matches, stats, library);

    // Step 7: Sort unmatched by count (descending) and limit to top 100
    const topUnmatched = unmatched
      .sort((a, b) => b.count - a.count)
      .slice(0, 100);

    const analysisTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[Analyze] Analysis complete in ${analysisTime}s`);

    // Return results
    return NextResponse.json({
      success: true,
      analysisTime,
      file: {
        name: file.name,
        size: file.size,
      },
      library: {
        id: library.metadata.id,
        name: library.metadata.name,
        organism: library.metadata.organism,
        type: library.metadata.library_type,
      },
      fastqStats: {
        totalReads: fastqStats.totalReads,
        avgReadLength: Math.round(fastqStats.avgReadLength),
        avgQuality: Math.round(fastqStats.avgQuality),
        gcContent: Math.round(fastqStats.gcContent * 10) / 10,
      },
      summary: {
        totalReads: stats.totalReads,
        matchedReads: stats.matchedReads,
        unmatchedReads: stats.unmatchedReads,
        matchRate: Math.round(stats.matchRate * 1000) / 10, // Percentage with 1 decimal
        uniqueSgRNAs: stats.uniqueSgRNAs,
        genesDetected: stats.genesDetected,
        libraryCoverage: Math.round(stats.libraryCoverage * 1000) / 10, // Percentage with 1 decimal
      },
      qc: {
        matchRate: Math.round(qcMetrics.matchRate * 1000) / 10,
        matchRateQuality: qcMetrics.matchRateQuality,
        libraryCoverage: Math.round(qcMetrics.libraryCoverage * 1000) / 10,
        libraryQuality: qcMetrics.libraryQuality,
        zeroCountSgRNAs: qcMetrics.zeroCountSgRNAs,
        zeroCountPercentage: Math.round(qcMetrics.zeroCountPercentage * 1000) / 10,
        zeroCountQuality: qcMetrics.zeroCountQuality,
        giniCoefficient: Math.round(qcMetrics.giniCoefficient * 100) / 100,
        giniQuality: qcMetrics.giniQuality,
        overallQuality: qcMetrics.overallQuality,
        recommendation: qcMetrics.recommendation,
      },
      results: {
        // Top 1000 sgRNA matches (sorted by count)
        sgRNAMatches: matches
          .sort((a, b) => b.count - a.count)
          .slice(0, 1000)
          .map(m => ({
            sequence: m.sequence,
            gene: m.gene_symbol,
            geneId: m.gene_id,
            count: m.count,
            rpm: Math.round((m.count / stats.totalReads) * 1000000 * 10) / 10,
          })),

        // All gene aggregations (sorted by total reads)
        geneAggregated: geneAggregated.map(g => ({
          gene: g.gene,
          geneId: g.gene_id,
          totalReads: g.totalReads,
          sgRNACount: g.sgRNACount,
          avgReadsPerSgRNA: Math.round(g.avgReadsPerSgRNA * 10) / 10,
          rpm: Math.round(g.rpm * 10) / 10,
        })),

        // Top 100 unmatched sequences
        unmatchedSequences: topUnmatched.map(u => ({
          sequence: u.sequence,
          count: u.count,
          rpm: Math.round((u.count / stats.totalReads) * 1000000 * 10) / 10,
        })),
      },
    });
  } catch (error) {
    console.error('[Analyze] Error during analysis:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Analysis failed',
        details: error instanceof Error ? error.message : 'Unknown error',
        stack: process.env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
