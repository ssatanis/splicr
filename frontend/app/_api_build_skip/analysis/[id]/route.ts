import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { Analysis } from '@/lib/types';

const globalAnalyses = globalThis as any;
if (!globalAnalyses.analysesStore) globalAnalyses.analysesStore = new Map();
const analysesMemory = globalAnalyses.analysesStore;

function rowToAnalysis(row: any): Analysis {
  const fileKeys = row.file_names?.length ? row.file_names : (row.parameters?.r2Keys || []);
  const sampleLabels = row.sample_labels?.length ? row.sample_labels : (row.parameters?.sampleLabels || []);
  return {
    id: row.id,
    name: row.name,
    status: (row.status || 'pending') as Analysis['status'],
    algorithm: Array.isArray(row.method) ? row.method : [row.method || 'mageck'],
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
    const { data: row, error } = await (supabase.from('analyses') as any)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!error && row) {
      return NextResponse.json(rowToAnalysis(row));
    }

    const analysis = analysesMemory.get(id);
    if (analysis) return NextResponse.json(analysis);

    return NextResponse.json(
      { message: 'Analysis not found' },
      { status: 404 }
    );
  } catch (error) {
    return NextResponse.json(
      { message: 'Failed to fetch analysis' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const id = params.id;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { error } = await (supabase.from('analyses') as any)
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (!error) {
        analysesMemory.delete(id);
        return NextResponse.json({ success: true });
      }
    }

    analysesMemory.delete(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { message: 'Failed to delete analysis' },
      { status: 500 }
    );
  }
}
