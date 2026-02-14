import { NextRequest, NextResponse } from 'next/server';
import { txScoreClient } from '@/lib/txscore-server';
import { TxScoreFilters, RankingOptions } from '@sdk/txscore-client';

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;

        const cancerType = searchParams.get('cancer_type') || 'pan-cancer';

        // Parse filters
        const filters: TxScoreFilters = {
            min_tvs: searchParams.has('min_tvs') ? parseFloat(searchParams.get('min_tvs')!) : undefined,
            min_efficacy: searchParams.has('min_efficacy') ? parseFloat(searchParams.get('min_efficacy')!) : undefined,
            min_safety: searchParams.has('min_safety') ? parseFloat(searchParams.get('min_safety')!) : undefined,
            min_druggability: searchParams.has('min_druggability') ? parseFloat(searchParams.get('min_druggability')!) : undefined,
            protein_class: searchParams.get('protein_class') || undefined,
            has_approved_drugs: searchParams.has('has_approved_drugs') ? searchParams.get('has_approved_drugs') === 'true' : undefined,
            has_clinical_trials: searchParams.has('has_clinical_trials') ? searchParams.get('has_clinical_trials') === 'true' : undefined,
            recommended_modality: (searchParams.get('recommended_modality') as any) || undefined,
            gene_ids: searchParams.has('gene_ids') ? searchParams.get('gene_ids')?.split(',') : undefined,
        };

        // Parse options
        const options: RankingOptions = {
            limit: searchParams.has('limit') ? parseInt(searchParams.get('limit')!, 10) : 50,
            offset: searchParams.has('offset') ? parseInt(searchParams.get('offset')!, 10) : 0,
            order_by: (searchParams.get('order_by') as any) || 'tvs',
            order_direction: (searchParams.get('order_direction') as any) || 'desc',
        };

        // Fetch data
        const targets = await txScoreClient.getTopTargets(cancerType, filters, options);

        return NextResponse.json({
            data: targets,
            meta: {
                count: targets.length, // Note: Real pagination count would need a separate query
                filters,
                options
            }
        });

    } catch (error: any) {
        console.error('Error fetching target ranking:', error);
        return NextResponse.json(
            { error: 'Failed to fetch target ranking', details: error.message },
            { status: 500 }
        );
    }
}
