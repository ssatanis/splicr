import { NextRequest, NextResponse } from 'next/server';
import { createClient, supabaseAdmin } from '@/lib/supabase/server';
import type { Analysis } from '@/lib/types';

const globalStore = globalThis as any;
if (!globalStore.resultsStore) globalStore.resultsStore = new Map();
const analysisResultsMemory = globalStore.resultsStore;

function rowToAnalysis(row: any): Analysis {
  const fileKeys = row.file_names?.length ? row.file_names : (row.parameters?.r2Keys || []);
  const sampleLabels = row.sample_labels?.length ? row.sample_labels : (row.parameters?.sampleLabels || []);
  // Get algorithms from parameters.algorithms first, then fall back to method
  const algorithms = row.parameters?.algorithms ||
    (Array.isArray(row.method) ? row.method : [row.method || 'mageck']);
  return {
    id: row.id,
    name: row.name,
    status: (row.status || 'pending') as Analysis['status'],
    algorithm: algorithms,
    libraryType: (row.library || row.library_type || 'brunello') as Analysis['libraryType'],
    fileKeys,
    sampleLabels,
    parameters: row.parameters || {},
    createdAt: row.created_at || new Date().toISOString(),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    progress: row.progress ?? 0,
    currentStep: row.current_step,
    errorMessage: row.error_message,
    logs: Array.isArray(row.logs) ? row.logs : undefined,
    userId: row.user_id,
  } as Analysis;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const id = params.id;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Fetch full row so we can return analysis metadata when results aren't ready
    const { data: row, error } = await (supabaseAdmin as any)
      .from('analyses')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('Results fetch error:', error);
      return NextResponse.json(
        { message: 'Failed to fetch results' },
        { status: 500 }
      );
    }

    if (row) {
      if (!user || row.user_id !== user.id) {
        return NextResponse.json(
          { message: 'Results not found' },
          { status: 404 }
        );
      }
      if (row.results != null) {
        return NextResponse.json(row.results);
      }
      // Analysis exists but results not ready: return 200 with analysis so UI can show it
      return NextResponse.json({
        results: null,
        analysis: rowToAnalysis(row),
      });
    }

    const results = analysisResultsMemory.get(id);
    if (results) return NextResponse.json(results);

    return NextResponse.json(
      { message: 'Results not found' },
      { status: 404 }
    );
  } catch (error) {
    console.error('Results route error:', error);
    return NextResponse.json(
      { message: 'Failed to fetch results' },
      { status: 500 }
    );
  }
}
