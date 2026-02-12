import { NextRequest, NextResponse } from 'next/server';
import { getApiUser, supabaseAdmin } from '@/lib/supabase/server';
import { getR2FileAsFile } from '@/lib/storage/r2-get';
import { rebuildMatrixFromStored } from '@/lib/analysis/runAdvancedAnalysis';
import { DrugZAnalyzer, DrugZGeneResult } from '@/lib/analysis/drugz';

export const maxDuration = 300; // 5 minutes

export async function POST(req: NextRequest) {
    try {
        const { user, error: authError } = await getApiUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const analysisId = body.analysisId;

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

        let results = analysis.results as any;

        // Check R2 for count matrix if needed
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
        const parameters = analysis.parameters || {};
        const analyzer = new DrugZAnalyzer({
            minSgRNAs: 3,
            pseudocount: 5,
            normalizationMethod: parameters.normalizationMethod
        });

        // Run Analysis
        const drugzResults = await analyzer.runAnalysis(
            countMatrix,
            sgRNAToGene,
            controlIndices,
            treatmentIndices,
            undefined
        );

        // Format results
        const formattedResults = drugzResults.map((r: DrugZGeneResult) => ({
            gene: r.gene,
            numSgRNAs: r.numSgRNAs,
            normZ: r.normZ,
            pValue: r.pValue,
            fdr: r.fdr,
            log2FC: r.log2FC,
            syntheticScore: r.syntheticScore,
            rank: r.rank
        }));

        const significantGenes = drugzResults.filter((r: DrugZGeneResult) => r.fdr < 0.05).length;

        return NextResponse.json({
            success: true,
            algorithm: 'drugz',
            totalGenes: drugzResults.length,
            significantGenes,
            results: formattedResults
        });

    } catch (error) {
        console.error('Advanced Analysis Error (DrugZ):', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Analysis failed' },
            { status: 500 }
        );
    }
}
