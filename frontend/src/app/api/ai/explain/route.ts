import { NextRequest, NextResponse } from 'next/server';
import { explainStructure, type PDBMetadata, AIServiceError } from '@/lib/ai/gemini-client';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pdbId = body.pdbId?.trim();
    const userQuestion = typeof body.userQuestion === 'string' ? body.userQuestion.trim() : undefined;
    const metadata: PDBMetadata = {
      title: body.metadata?.title ?? null,
      organism: body.metadata?.organism ?? null,
      method: body.metadata?.method ?? null,
      resolution: body.metadata?.resolution ?? null,
    };

    if (!pdbId || pdbId.length < 4) {
      return NextResponse.json(
        { error: 'A valid structure ID is required' },
        { status: 400 }
      );
    }

    const text = await explainStructure(pdbId, metadata, userQuestion);
    return NextResponse.json({ text });
  } catch (err) {
    if (err instanceof AIServiceError) {
      return NextResponse.json(
        { error: err.userMessage || err.message },
        { status: err.statusCode }
      );
    }
    return NextResponse.json(
      { error: 'Unable to explain structure. Please try again.' },
      { status: 500 }
    );
  }
}
