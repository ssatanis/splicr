import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/apiAuth';

const globalStore = globalThis as any;
if (!globalStore.analysesStore) globalStore.analysesStore = new Map();
const analyses = globalStore.analysesStore;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { ok, remaining } = checkRateLimit(request);
  const headers = { 'X-RateLimit-Remaining': String(remaining) };

  if (!ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers });
  }

  try {
    const { id } = await context.params;
    const analysis = analyses.get(id);
    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404, headers });
    }
    return NextResponse.json(analysis, { headers });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to get analysis' }, { status: 500, headers });
  }
}
