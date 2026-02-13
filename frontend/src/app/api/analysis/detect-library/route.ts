
import { NextRequest, NextResponse } from 'next/server';
import { detectLibrary } from '@/lib/analysis/batch-correction';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { sequences } = body;

        if (!sequences || !Array.isArray(sequences) || sequences.length === 0) {
            return NextResponse.json({ error: 'No sequences provided' }, { status: 400 });
        }

        // Run detection
        const result = await detectLibrary(sequences);

        return NextResponse.json(result);
    } catch (error) {
        console.error('Library detection error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal Server Error' },
            { status: 500 }
        );
    }
}
