import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const globalStore = globalThis as any;
if (!globalStore.resultsStore) globalStore.resultsStore = new Map();
const analysisResultsMemory = globalStore.resultsStore;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const id = params.id;

    const supabase = await createClient();
    const { data: row, error } = await (supabase.from('analyses') as any)
      .select('results')
      .eq('id', id)
      .maybeSingle();

    if (!error && row?.results) {
      return NextResponse.json(row.results);
    }

    const results = analysisResultsMemory.get(id);
    if (results) return NextResponse.json(results);

    return NextResponse.json(
      { message: 'Results not found' },
      { status: 404 }
    );
  } catch (error) {
    return NextResponse.json(
      { message: 'Failed to fetch results' },
      { status: 500 }
    );
  }
}
