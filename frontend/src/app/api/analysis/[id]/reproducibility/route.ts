import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { supabaseAdmin } from '@/lib/supabase/server';
import { createServerR2Client, R2_BUCKET_NAME, isR2Configured } from '@/lib/storage/r2-client';
import { loadRealLibrary } from '@/lib/analysis/analysis-utils';
import {
    calculateWBCScore,
    calculateBinwiseCorrelations,
    assessScreenQuality,
    ScreenData,
    ReplicateComparison,
    ReproducibilityMetrics
} from '@/lib/analysis/reproducibility-metrics';

export const dynamic = 'force-dynamic';

// Helper to calculate LFC
function calculateLFC(count: number, controlMean: number): number {
    // Simple Log2(CPM+pseudo / ControlCPM+pseudo)
    // Assuming inputs are already normalized or we normalize here.
    // Let's assume input counts are RAW, so we need to normalize to CPM first.
    // Actually, easiest is to normalize the whole vector first.
    return Math.log2((count + 1) / (controlMean + 1));
}

// Helper to normalize to CPM (Counts Per Million)
function normalizeCPM(counts: number[], totalReads: number): number[] {
    return counts.map(c => (c / totalReads) * 1e6);
}

export async function GET(
    _request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const params = await context.params;
        const id = params.id;

        // 1. Auth & DB Data Fetching
        const { user, error: authError } = await (await import('@/lib/supabase/server')).getApiUser();
        if (authError || !user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { data: row, error } = await (supabaseAdmin as any)
            .from('analyses')
            .select('id, user_id, count_matrix_r2_key, parameters, library_type')
            .eq('id', id)
            .maybeSingle();

        if (error || !row) return NextResponse.json({ message: 'Analysis not found' }, { status: 404 });

        // Check permission (Owner or Public - simplified to Owner for now)
        if (row.user_id !== user.id) {
            return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
        }

        // 2. Fetch Count Matrix from R2
        const r2Key = row.count_matrix_r2_key;
        if (!r2Key) return NextResponse.json({ message: 'No count matrix available' }, { status: 404 });

        if (!isR2Configured()) return NextResponse.json({ message: 'Storage config error' }, { status: 503 });

        const client = createServerR2Client();
        const command = new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: r2Key });
        const response = await client.send(command);

        if (!response.Body) return NextResponse.json({ message: 'Failed to fetch matrix' }, { status: 500 });

        const countMatrixText = await response.Body.transformToString();
        const rawMatrix: Record<string, Record<string, number>> = JSON.parse(countMatrixText);

        // 3. Load Library for Gene Mapping
        // Use library from analysis metadata or default
        const libraryType = row.library_type || row.parameters?.libraryType || 'brunello';
        const library = await loadRealLibrary(libraryType); // Returns Map<seq, gene>

        // 4. Process Data & Calculate Metrics

        // A. Identify Samples
        // Matrix: sgrna -> { sample1: c1, sample2: c2 }
        const firstSgRNA = Object.keys(rawMatrix)[0];
        if (!firstSgRNA) return NextResponse.json({ message: 'Empty matrix' }, { status: 400 });

        const sampleNames = Object.keys(rawMatrix[firstSgRNA]);

        // Parse sample labels from parameters
        const sampleLabels: any[] = row.parameters?.sampleLabels || [];
        // If no labels, fallback? (Can't distinguish T vs C without labels)
        if (!sampleLabels.length) {
            return NextResponse.json({ message: 'No sample metadata found' }, { status: 400 });
        }

        const controlSamples = sampleLabels.filter(s => s.condition === 'control').map(s => s.sampleName);
        const treatmentSamples = sampleLabels.filter(s => s.condition === 'treatment').map(s => s.sampleName);

        if (treatmentSamples.length < 2) {
            return NextResponse.json({
                message: 'Reproducibility analysis requires at least 2 treatment replicates.',
                error_code: 'INSUFFICIENT_REPLICATES'
            }, { status: 400 });
        }

        // B. Reconstruct ScreenData for each Treatment Replicate
        // We need normalized counts and LFCs.
        // First, verify all samples exist in matrix
        // ...

        // Calculate Total Reads per Sample (for CPM)
        const sampleTotals: Record<string, number> = {};
        sampleNames.forEach(s => sampleTotals[s] = 0);

        Object.values(rawMatrix).forEach(counts => {
            for (const [s, c] of Object.entries(counts)) {
                sampleTotals[s] = (sampleTotals[s] || 0) + c;
            }
        });

        // Calculate Mean Control CPM
        const sgrnaStats: Record<string, { gene: string, meanCtrlCPM: number, treatmentCPMs: Record<string, number> }> = {};

        for (const [sgrna, counts] of Object.entries(rawMatrix)) {
            const gene = library.get(sgrna) || 'Unknown';

            // Calc Control CPMs
            const ctrlCPMs = controlSamples.map(s => {
                const raw = counts[s] || 0;
                const total = sampleTotals[s] || 1;
                return (raw / total) * 1e6;
            });

            const meanCtrl = ctrlCPMs.reduce((a, b) => a + b, 0) / (ctrlCPMs.length || 1);

            const treatCPMs: Record<string, number> = {};
            treatmentSamples.forEach(s => {
                const raw = counts[s] || 0;
                const total = sampleTotals[s] || 1;
                treatCPMs[s] = (raw / total) * 1e6;
            });

            sgrnaStats[sgrna] = { gene, meanCtrlCPM: meanCtrl, treatmentCPMs: treatCPMs };
        }

        // C. Create Replicate Datasets
        const replicateDataMap: Record<string, ScreenData[]> = {};

        treatmentSamples.forEach(s => {
            replicateDataMap[s] = [];
        });

        // Also create Control Datasets for "Between" comparison (Signal vs Noise)
        const controlDataMap: Record<string, ScreenData[]> = {};
        controlSamples.forEach(s => controlDataMap[s] = []);

        for (const [sgrna, stats] of Object.entries(sgrnaStats)) {
            // Treatment LFCs
            treatmentSamples.forEach(s => {
                const cpm = stats.treatmentCPMs[s];
                // LFC vs Mean Control
                const lfc = Math.log2((cpm + 1) / (stats.meanCtrlCPM + 1));
                replicateDataMap[s].push({
                    sgrnaId: sgrna,
                    geneName: stats.gene,
                    readcounts: cpm, // Using CPM as readcounts proxy for size
                    lfc: lfc
                });
            });

            // Control LFCs (vs Mean Control - capturing noise)
            controlSamples.forEach(s => {
                // We need to re-calc CPM for this specific control sample
                // It's already calculated implicitly but I didn't store it.
                // Re-calc:
                const raw = rawMatrix[sgrna][s] || 0;
                const total = sampleTotals[s] || 1;
                const cpm = (raw / total) * 1e6;
                const lfc = Math.log2((cpm + 1) / (stats.meanCtrlCPM + 1));
                controlDataMap[s].push({
                    sgrnaId: sgrna,
                    geneName: stats.gene,
                    readcounts: cpm,
                    lfc: lfc
                });
            });
        }

        // D. Define Comparisons
        const withinContextPairs: ReplicateComparison[] = [];
        const betweenContextPairs: ReplicateComparison[] = [];

        // Within: All pairs of Treatment replicates
        for (let i = 0; i < treatmentSamples.length; i++) {
            for (let j = i + 1; j < treatmentSamples.length; j++) {
                withinContextPairs.push({
                    replicate1: replicateDataMap[treatmentSamples[i]],
                    replicate2: replicateDataMap[treatmentSamples[j]],
                    contextType: 'within'
                });
            }
        }

        // Between: Treatment vs Control pairs
        // This measures "Signal vs Noise" separation
        for (const tSample of treatmentSamples) {
            for (const cSample of controlSamples) {
                betweenContextPairs.push({
                    replicate1: replicateDataMap[tSample],
                    replicate2: controlDataMap[cSample],
                    contextType: 'between'
                });
            }
        }

        // If we only have 1 Control, we can't get variation of noise well?
        // Use what we have.

        // E. Calculate Metrics
        const { wbcScore, wbcZScore } = calculateWBCScore(withinContextPairs, betweenContextPairs);

        // Traditional Metrics (Average of all within pairs)
        // We can just take the first pair or average
        // calculateWBCScore computes correlations internally but returns agg score.
        // We need to re-compute simple PCC for display.
        // Let's use the first pair for "Representative" correlation or average.

        // Helper to calc PCC of arrays
        const simplePCC = (d1: ScreenData[], d2: ScreenData[], key: 'lfc' | 'readcounts') => {
            const x = d1.map(d => d[key]);
            const y = d2.map(d => d[key]);
            // Use simple-statistics sampleCorrelation if imported, or basic implementation
            // Re-implementing basic PCC here to avoid large import separation
            const n = x.length;
            const meanX = x.reduce((a, b) => a + b, 0) / n;
            const meanY = y.reduce((a, b) => a + b, 0) / n;
            let num = 0, denX = 0, denY = 0;
            for (let i = 0; i < n; i++) {
                const dx = x[i] - meanX;
                const dy = y[i] - meanY;
                num += dx * dy;
                denX += dx * dx;
                denY += dy * dy;
            }
            return (denX === 0 || denY === 0) ? 0 : num / Math.sqrt(denX * denY);
        };

        const firstPair = withinContextPairs[0];
        const lfcPCC = simplePCC(firstPair.replicate1, firstPair.replicate2, 'lfc');
        const readcountPCC = simplePCC(firstPair.replicate1, firstPair.replicate2, 'readcounts');

        // Binwise
        const binwise = calculateBinwiseCorrelations(firstPair.replicate1, firstPair.replicate2);

        // Quality stats
        // Signal Density: % sgRNAs with |LFC| > 1 (arbitrary threshold)
        const allLFCs = firstPair.replicate1.map(d => d.lfc);
        const signalDensity = (allLFCs.filter(l => Math.abs(l) > 1).length / allLFCs.length) * 100;

        // Skewness
        // 3 * (Mean - Median) / SD
        // Approx: average of cubed deviations?
        // Use 3rd moment
        const meanLFC = allLFCs.reduce((a, b) => a + b, 0) / allLFCs.length;
        const m3 = allLFCs.reduce((a, b) => a + Math.pow(b - meanLFC, 3), 0) / allLFCs.length;
        const m2 = allLFCs.reduce((a, b) => a + Math.pow(b - meanLFC, 2), 0) / allLFCs.length;
        const skewIndex = m3 / Math.pow(m2, 1.5);

        const metrics: ReproducibilityMetrics = {
            readcountPCC,
            lfcPCC,
            wbcScore,
            wbcZScore,
            binwiseCorrelations: binwise,
            signalDensity,
            skewIndex,
            overallQuality: 'POOR', // Placeholder
            recommendation: ''
        };

        // Assess
        const assessment = assessScreenQuality(metrics);
        metrics.overallQuality = assessment.quality;
        metrics.recommendation = assessment.recommendation;
        // metrics.shouldProceed = assessment.shouldProceed; // Not in interface but useful

        return NextResponse.json(metrics);

    } catch (err) {
        console.error('Reproducibility analysis error:', err);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}
