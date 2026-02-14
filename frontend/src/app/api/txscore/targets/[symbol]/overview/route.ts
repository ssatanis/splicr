import { NextRequest, NextResponse } from 'next/server';
import { txScoreClient } from '@/lib/txscore-server';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ symbol: string }> }
) {
    try {
        const symbol = (await params).symbol;
        const searchParams = request.nextUrl.searchParams;
        const cancerType = searchParams.get('cancer_type') || undefined;

        // 1. Resolve Symbol to Gene ID
        const gene = await txScoreClient.getGeneBySymbol(symbol);

        if (!gene) {
            return NextResponse.json(
                { error: 'Gene not found' },
                { status: 404 }
            );
        }

        // 2. Fetch Full Profile
        // The profile includes: Gene, DepMap, GTEx, Constraint, Structure, ClinVar, Drugs, Trials, TxScores
        const profile = await txScoreClient.getGeneProfile(gene.gene_id, cancerType);

        return NextResponse.json(profile);

    } catch (error: any) {
        console.error('Error fetching gene overview:', error);
        return NextResponse.json(
            { error: 'Failed to fetch gene overview', details: error.message },
            { status: 500 }
        );
    }
}
