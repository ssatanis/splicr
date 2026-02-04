import { NextRequest, NextResponse } from 'next/server';
import { assessDruggability, type PocketGeometry, AIServiceError } from '@/lib/ai/gemini-client';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pdbId = body.pdbId?.trim();
    const targetResidue = body.targetResidue?.trim();
    const pocketGeometry: PocketGeometry = {
      volume: body.pocketGeometry?.volume,
      surfaceArea: body.pocketGeometry?.surfaceArea,
      hpRatio: body.pocketGeometry?.hpRatio,
      residues: Array.isArray(body.pocketGeometry?.residues)
        ? body.pocketGeometry.residues
        : undefined,
    };

    if (!pdbId || !targetResidue) {
      return NextResponse.json(
        { error: 'Structure ID and target residue are required' },
        { status: 400 }
      );
    }

    const text = await assessDruggability(pdbId, targetResidue, pocketGeometry);
    return NextResponse.json({ text });
  } catch (err) {
    if (err instanceof AIServiceError) {
      return NextResponse.json(
        { error: err.userMessage || err.message },
        { status: err.statusCode }
      );
    }
    return NextResponse.json(
      { error: 'Unable to assess druggability. Please try again.' },
      { status: 500 }
    );
  }
}
