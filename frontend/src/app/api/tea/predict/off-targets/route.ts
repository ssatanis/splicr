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

function mutateSequence(seq: string, numMutations: number, rng: () => number): string {
    const bases = ['A', 'C', 'G', 'T'];
    const arr = seq.split('');
    const indices = new Set<number>();
    while (indices.size < Math.min(numMutations, seq.length)) {
        indices.add(Math.floor(rng() * seq.length));
    }
    for (const idx of indices) {
        const others = bases.filter(b => b !== arr[idx]);
        arr[idx] = others[Math.floor(rng() * others.length)];
    }
    return arr.join('');
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { sequence, model = 'cas9' } = body;

    if (!sequence || sequence.length < 20) {
        return NextResponse.json({ detail: 'Sequence too short.' }, { status: 422 });
    }

    const rng = seededRandom(sequence + 'off');
    const numOffTargets = Math.floor(rng() * 4); // 0-3
    const chromosomes = [...Array.from({ length: 22 }, (_, i) => `chr${i + 1}`), 'chrX', 'chrY'];
    const targets = [];

    for (let i = 0; i < numOffTargets; i++) {
        const mismatches = 1 + Math.floor(rng() * 4);
        const risk = Math.max(0, 100 - mismatches * 20 + (rng() * 10 - 5));
        const chr = chromosomes[Math.floor(rng() * chromosomes.length)];
        const pos = 10000 + Math.floor(rng() * 99990000);
        const hasGene = rng() > 0.5;

        targets.push({
            locus: `${chr}:${pos}`,
            sequence: mutateSequence(sequence, mismatches, rng),
            mismatches,
            risk_score: Math.round(risk * 100) / 100,
            gene: hasGene ? `Gene_${Math.floor(rng() * 1000) + 1}` : null,
        });
    }

    targets.sort((a, b) => b.risk_score - a.risk_score);
    const aggregate_risk = targets.length > 0
        ? Math.round(targets.reduce((s, t) => s + t.risk_score, 0) / targets.length * 100) / 100
        : 0;

    return NextResponse.json({ targets, aggregate_risk });
}
