import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { Analysis } from '@/lib/types';

const globalStore = globalThis as any;
if (!globalStore.analysesStore) globalStore.analysesStore = new Map();
const analysesMemory = globalStore.analysesStore;

/** Map DB row to Analysis for frontend */
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

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (!authError && user) {
      const { data: rows, error } = await (supabase.from('analyses') as any)
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (!error && rows?.length) {
        const list = rows.map((r: any) => rowToAnalysis(r));
        return NextResponse.json(list);
      }
    }

    const analysesList = (Array.from(analysesMemory.values()) as Analysis[])
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return NextResponse.json(analysesList);
  } catch (error) {
    console.error('Error fetching analyses:', error);
    return NextResponse.json([], { status: 500 });
  }
}
