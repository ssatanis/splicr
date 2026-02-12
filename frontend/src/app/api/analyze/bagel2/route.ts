import { NextRequest, NextResponse } from 'next/server';
import { getApiUser as getApiUserServer, supabaseAdmin } from '@/lib/supabase/server';
import { getR2FileAsFile } from '@/lib/storage/r2-get';
import { rebuildMatrixFromStored } from '@/lib/analysis/runAdvancedAnalysis';
import { BAGEL2Analyzer, BAGEL2GeneResult } from '@/lib/analysis/bagel2';

export const maxDuration = 300; // 5 minutes

export async function POST(req: NextRequest) {
    try {
        const { user, error: authError } = await getApiUserServer();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { analysisId } = body;

        if (!analysisId) {
            return NextResponse.json({ error: 'Missing analysis ID' }, { status: 400 });
        }

        // Fetch analysis
        const { data: analysis, error: fetchError } = await (supabaseAdmin as any)
            .from('analyses')
            .select('*')
            .eq('id', analysisId)
            .single();

        if (fetchError || !analysis) {
            return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
        }

        if (analysis.user_id !== user.id) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Get results to rebuild matrix
        let results = analysis.results as any;

        // If results are not in DB, check if we need to load from R2
        // If the analysis is complete, results should be in the DB column.
        // However, the count matrix might be in R2.
        // rebuildMatrixFromStored expects { rawData: { countMatrix: ... } }

        // Check if count matrix is in R2
        if (!results?.rawData?.countMatrix && analysis.count_matrix_r2_key) {
            try {
                const file = await getR2FileAsFile(analysis.count_matrix_r2_key);
                const text = await file.text();
                const countMatrix = JSON.parse(text);
                if (!results) results = {};
                if (!results.rawData) results.rawData = {};
                results.rawData.countMatrix = countMatrix;
            } catch (e) {
                console.error('Failed to fetch count matrix from R2', e);
                return NextResponse.json({ error: 'Failed to retrieve analysis data' }, { status: 500 });
            }
        }

        if (!results?.rawData?.countMatrix) {
            return NextResponse.json({ error: 'Analysis data not available' }, { status: 400 });
        }

        // Rebuild matrix
        const { countMatrix, sgRNAToGene, controlIndices, treatmentIndices } = rebuildMatrixFromStored(
            {
                id: analysis.id,
                sampleLabels: analysis.sample_labels,
                libraryType: analysis.library,
                parameters: analysis.parameters
            },
            results
        );

        // Initialize Analyzer
        // We use parameters from the analysis, optionally overridden by body parameters if functionality added
        const parameters = analysis.parameters || {};

        const analyzer = new BAGEL2Analyzer({
            essentialGenes: parameters.essentialGenes ? parameters.essentialGenes.split(',').map((s: string) => s.trim()) : undefined,
            nonEssentialGenes: parameters.nonEssentialGenes ? parameters.nonEssentialGenes.split(',').map((s: string) => s.trim()) : undefined,
            bootstrapIterations: parameters.bagelPermutations || 1000,
            normalizationMethod: parameters.normalizationMethod // Use the same normalization method as the main run
        });

        // Run Analysis
        const bagelResults = await analyzer.runAnalysis(
            countMatrix,
            sgRNAToGene,
            controlIndices,
            treatmentIndices,
            undefined // No progress callback for API response
        );

        // Format results for UI
        const formattedResults = bagelResults.map((r: BAGEL2GeneResult) => ({
            gene: r.gene,
            numSgRNAs: r.numSgRNAs,
            bayesFactor: r.bayesFactor,
            precision: r.precision,
            recall: r.recall,
            log2FC: r.log2FC,
            essentialProbability: r.essentialProbability,
            rank: r.rank
        }));

        // Calculate summary
        const essentialGenes = bagelResults.filter((r: BAGEL2GeneResult) => r.bayesFactor > 0).length;

        return NextResponse.json({
            success: true,
            algorithm: 'bagel2',
            totalGenes: bagelResults.length,
            essentialGenes,
            results: formattedResults
        });

    } catch (error) {
        console.error('Advanced Analysis Error (BAGEL2):', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Analysis failed' },
            { status: 500 }
        );
    }
}
