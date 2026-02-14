import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { on_target_score, off_target_risk } = body;

    if (on_target_score == null || off_target_risk == null) {
        return NextResponse.json({ detail: 'Missing on_target_score or off_target_risk.' }, { status: 422 });
    }

    const riskFactor = Math.max(off_target_risk, 1.0);
    const windowScore = (on_target_score / riskFactor) * 10;

    let classification: string;
    if (windowScore > 50) classification = 'Excellent';
    else if (windowScore > 20) classification = 'Good';
    else if (windowScore > 5) classification = 'Fair';
    else classification = 'Poor';

    return NextResponse.json({
        window_score: Math.round(windowScore * 100) / 100,
        classification,
        on_target_contribution: on_target_score,
        off_target_penalty: off_target_risk,
    });
}
