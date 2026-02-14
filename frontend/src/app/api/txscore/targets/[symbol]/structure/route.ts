import { NextRequest, NextResponse } from 'next/server';
import { txScoreClient } from '@/lib/txscore-server';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ symbol: string }> }
) {
    try {
        const symbol = (await params).symbol;

        // 1. Resolve Symbol
        const gene = await txScoreClient.getGeneBySymbol(symbol);

        if (!gene) {
            return NextResponse.json(
                { error: 'Gene not found' },
                { status: 404 }
            );
        }

        // 2. Get Structure Data
        const structure = await txScoreClient.getAlphaFoldStructure(gene.gene_id);

        return NextResponse.json(structure || null);

    } catch (error: any) {
        console.error('Error fetching structure data:', error);
        return NextResponse.json(
            { error: 'Failed to fetch structure data', details: error.message },
            { status: 500 }
        );
    }
}
