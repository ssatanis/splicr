import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/apiAuth';

const globalStore = globalThis as any;
if (!globalStore.resultsStore) globalStore.resultsStore = new Map();
const resultsStore = globalStore.resultsStore;

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
    const results = resultsStore.get(id);
    if (!results) {
      return NextResponse.json({ error: 'Results not found' }, { status: 404, headers });
    }
    return NextResponse.json(results, { headers });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to get results' }, { status: 500, headers });
  }
}
