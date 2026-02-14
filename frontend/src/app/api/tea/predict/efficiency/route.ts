import { NextRequest, NextResponse } from 'next/server';

function seededRandom(seed: string): () => number {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
        h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
    }
    return () => {
        h ^= h << 13; h ^= h >> 17; h ^= h << 5;
        return ((h >>> 0) / 4294967296);
    };
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { sequence, model = 'pridict' } = body;

    if (!sequence || sequence.length < 20) {
        return NextResponse.json({ detail: 'Sequence too short (minimum 20 bases).' }, { status: 422 });
    }

    const rng = seededRandom(sequence);
    const score = 20 + rng() * 75; // 20-95
    const contextScore = 0.5 + rng() * 0.5;

    return NextResponse.json({
        model,
        efficiency_score: Math.round(score * 100) / 100,
        confidence: model === 'pridict' ? 0.9 : 0.8,
        details: {
            guide_efficiency: Math.round(score * 0.9 * 100) / 100,
            context_score: Math.round(contextScore * 1000) / 1000,
        },
    });
}
