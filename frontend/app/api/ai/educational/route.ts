import { NextRequest, NextResponse } from 'next/server';
import { generateEducationalNarrative, type UserLevel, AIServiceError } from '@/lib/ai/gemini-client';

export const maxDuration = 60;

const VALID_LEVELS: UserLevel[] = ['undergraduate', 'graduate', 'expert'];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pdbId = body.pdbId?.trim();
    const userLevel = VALID_LEVELS.includes(body.userLevel) ? body.userLevel : 'graduate';

    if (!pdbId || pdbId.length < 4) {
      return NextResponse.json(
        { error: 'A valid structure ID is required' },
        { status: 400 }
      );
    }

    const text = await generateEducationalNarrative(pdbId, userLevel);
    return NextResponse.json({ text });
  } catch (err) {
    if (err instanceof AIServiceError) {
      return NextResponse.json(
        { error: err.userMessage || err.message },
        { status: err.statusCode }
      );
    }
    return NextResponse.json(
      { error: 'Unable to generate educational content. Please try again.' },
      { status: 500 }
    );
  }
}
