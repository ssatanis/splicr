
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getR2FileAsFile } from '@/lib/storage/r2-get';
import { putR2Json } from '@/lib/storage/r2-put';
import { detectLibrary, applyBatchCorrection } from '@/lib/analysis/batch-correction';
import { loadDepMapReference } from '@/lib/analysis/depmap-integration';

export const maxDuration = 300; // 5 minutes timeout

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> } // Next.js 15+ params are async
) {
    try {
        const { id } = await params;
        const supabase = await createClient();

        // 1. Auth & Existence Check
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: analysis, error: fetchError } = await supabase
            .from('analyses')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !analysis) {
            return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
        }

        // Cast to any to access json fields safely without full DB types
        const analysisData = analysis as any;

        // 2. Get Count Matrix
        // The key is stored in analysis.count_matrix_r2_key or inside results json?
        // runAnalysisPipeline.ts:335 -> count_matrix_r2_key column exists.
        const r2Key = analysisData.count_matrix_r2_key || analysisData.results?.rawData?.countMatrixR2Key;

        if (!r2Key) {
            return NextResponse.json({ error: 'No count matrix found for this analysis' }, { status: 400 });
        }

        // Fetch from R2
        let countMatrix: Record<string, Record<string, number>>; // Gene -> Sample -> Count
        try {
            const file = await getR2FileAsFile(r2Key);
            const text = await file.text();
            countMatrix = JSON.parse(text);
        } catch (e) {
            console.error('R2 Fetch Error:', e);
            return NextResponse.json({ error: 'Failed to retrieve count matrix from storage' }, { status: 500 });
        }

        // 3. Prepare Data for Correction
        // Convert Record<Gene, Record<Sample, Count>> to Matrix
        const geneNames = Object.keys(countMatrix);
        if (geneNames.length === 0) {
            return NextResponse.json({ error: 'Count matrix is empty' }, { status: 400 });
        }

        const sampleNames = Object.keys(countMatrix[geneNames[0]]);
        const matrix: number[][] = []; // Top level: Genes

        // Check library first (using sequences if available, or just heuristic)
        // We don't have sequences in the count matrix usually.
        // We might accept "library" from request body or database.
        const providedLibrary = analysisData.library || 'Unknown';

        // Convert to Matrix
        for (const gene of geneNames) {
            const row: number[] = [];
            for (const sample of sampleNames) {
                row.push(countMatrix[gene][sample] || 0);
            }
            matrix.push(row);
        }

        // 4. Detect Library (if possible, validation step)
        // Real detection requires sequences. For now, we trust the DB or return mock details.
        // If request has 'detect' flag and sequences, we'd use that.
        const libraryDetails = await detectLibrary([providedLibrary]); // Passing name to mock detection if needed or just skipping

        // 5. Load DepMap Reference
        const depMapRef = await loadDepMapReference();
        if (!depMapRef) {
            // Fallback or error?
            // If mock fails, we can't correct.
            // For MVP, if downloadDepMapReference hasn't finished, we might trigger it.
            // For this route, we fail if not ready.
            // Or we trigger the mock build.
            const { downloadDepMapReference } = await import('@/lib/analysis/depmap-integration');
            await downloadDepMapReference(); // Ensure it exists
            // Reload
            const refRetry = await loadDepMapReference();
            if (!refRetry) {
                return NextResponse.json({ error: 'DepMap reference unavailable' }, { status: 503 });
            }
            // Proceed with refRetry
        }

        // 6. Run Batch Correction
        // We need DepMap Matrix in same gene order.
        // Intersection of genes:
        const ref = await loadDepMapReference();
        if (!ref) throw new Error('Failed to load ref');

        const commonGenes = geneNames.filter(g => ref.genes.includes(g));

        // Filter User Data
        const userMatrixFiltered = matrix.filter((_, i) => commonGenes.includes(geneNames[i]));

        // Filter Ref Data
        // ref.data is Genes x CellLines (let's say). We need to pull rows corresponding to commonGenes.
        const refIndices = commonGenes.map(g => ref.genes.indexOf(g));
        const refMatrixFiltered = refIndices.map(i => ref.data[i]);

        // Exec
        const correctionResult = await applyBatchCorrection(
            userMatrixFiltered,
            refMatrixFiltered,
            commonGenes
        );

        // 7. Save Results
        // Save corrected matrix to R2?
        // Convert back to Gene -> Sample -> Count map
        const correctedMap: Record<string, Record<string, number>> = {};
        for (let i = 0; i < commonGenes.length; i++) {
            const gene = commonGenes[i];
            correctedMap[gene] = {};
            for (let j = 0; j < sampleNames.length; j++) {
                // correctionResult.correctedData is Matrix
                correctedMap[gene][sampleNames[j]] = correctionResult.correctedData[i][j];
            }
        }

        const newR2Key = `analysis/${id}/corrected-counts-${Date.now()}.json`;
        await putR2Json(newR2Key, correctedMap);

        // Update DB with metrics
        const newResults = {
            ...analysisData.results,
            batchCorrection: {
                metrics: correctionResult.metrics,
                r2Key: newR2Key,
                library: libraryDetails,
                timestamp: new Date().toISOString()
            }
        };

        // Cast to any to bypass strict type check for now
        await (supabase.from('analyses') as any).update({ results: newResults }).eq('id', id);

        return NextResponse.json({
            success: true,
            metrics: correctionResult.metrics,
            library: libraryDetails,
            correctedR2Key: newR2Key
        });

    } catch (error) {
        console.error('Batch correction error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal Server Error' },
            { status: 500 }
        );
    }
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const supabase = await createClient();
    // Fetch existing metrics
    const { data, error } = await supabase
        .from('analyses')
        .select('results')
        .eq('id', id)
        .single();

    if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Cast data to any
    const dataAny = data as any;
    if (dataAny.results?.batchCorrection) {
        return NextResponse.json(dataAny.results.batchCorrection);
    }

    return NextResponse.json({ status: 'No batch correction run yet' });
}
