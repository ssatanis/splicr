
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { enrichWithExperimentalData } from '@/lib/analysis/crisprofft-integration';
import {
    runCRISPRitz,
    calculateOffTargetScore,
    OffTargetRiskAnalysis
} from '@/lib/analysis/off-target-scoring';
import { detectSuspiciousHits, crossCheckWithDepMap } from '@/lib/analysis/discordance-detection';

/**
 * Off-Target Analysis API
 * 
 * triggered via POST /api/analysis/[id]/off-targets
 */

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params; // await params in Next.js 15+
    const supabase = createClient();

    try {
        // 1. Fetch analysis data (sgRNAs, gene results)
        // For now, we mock fetching the sgRNA list from the database
        // In a real scenario, we would query the 'sgrna_results' table

        // Mock input data for demonstration
        const { sgrnas, hitGenes } = await req.json();

        if (!sgrnas || !Array.isArray(sgrnas)) {
            return NextResponse.json({ error: 'Invalid sgRNA data provided' }, { status: 400 });
        }

        // 2. Run CRISPRoffT enrichment (Experimental Validation)
        // Batch process sgRNAs to get validated off-targets
        const enrichedData = await enrichWithExperimentalData(
            sgrnas.map((s: any) => ({ id: s.id, sequence: s.sequence, pam: s.pam }))
        );

        // 3. Run CRISPRitz Prediction & Scoring
        const riskAnalyses: OffTargetRiskAnalysis[] = [];

        // We process a subset or all depending on performance constraints
        // limit to 50 for this demo to ensure speed
        const sgrnasToProcess = sgrnas.slice(0, 50);

        for (const sg of sgrnasToProcess) {
            // Run prediction
            const offTargets = await runCRISPRitz(sg.sequence, sg.pam || 'NGG');

            // Calculate risk
            const risk = calculateOffTargetScore(sg.id, sg.sequence, offTargets);
            riskAnalyses.push(risk);
        }

        // 4. Detect Suspicious Hits (Discordance)
        // We need LFC data for this
        const discordanceResults = detectSuspiciousHits(
            hitGenes || [],
            sgrnas.map((s: any) => ({
                id: s.id,
                gene: s.gene,
                lfc: s.lfc,
                offTargets: [] // We'd populate this from prediction results
            }))
        );

        // Cross-check with DepMap
        const finalFlaggedHits = crossCheckWithDepMap(discordanceResults);

        // 5. Store results (Mock storage for now, or return directly)
        // In production: await supabase.from('off_target_analysis').insert(...)

        return NextResponse.json({
            success: true,
            data: {
                enrichedSgRNAs: enrichedData,
                riskScores: riskAnalyses,
                suspiciousHits: finalFlaggedHits,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Off-target analysis failed:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
