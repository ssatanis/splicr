import { NextRequest, NextResponse } from 'next/server';
import { predictMutationEffect, AIServiceError } from '@/lib/ai/gemini-client';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pdbId = body.pdbId?.trim();
    const residue = body.residue?.trim();
    const mutation = body.mutation?.trim();
    const structuralContext = typeof body.structuralContext === 'string' ? body.structuralContext.trim() : '';

    if (!pdbId || !residue || !mutation) {
      return NextResponse.json(
        { error: 'Structure ID, residue, and mutation details are required' },
        { status: 400 }
      );
    }

    const text = await predictMutationEffect(
      pdbId,
      residue,
      mutation,
      structuralContext || 'No additional context provided.'
    );
    return NextResponse.json({ text });
  } catch (err) {
    if (err instanceof AIServiceError) {
      return NextResponse.json(
        { error: err.userMessage || err.message },
        { status: err.statusCode }
      );
    }
    return NextResponse.json(
      { error: 'Unable to predict mutation effect. Please try again.' },
      { status: 500 }
    );
  }
}
