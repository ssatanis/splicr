import { NextResponse } from 'next/server';
import { getApiUser, supabaseAdmin } from '@/lib/supabase/server';
import type { Analysis } from '@/lib/types';

const globalStore = globalThis as any;
if (!globalStore.analysesStore) globalStore.analysesStore = new Map();
const analysesMemory = globalStore.analysesStore;

/** Map DB row to Analysis for frontend */
function rowToAnalysis(row: any): Analysis {
  // Handle file keys from multiple sources
  const fileKeys = row.file_names?.length ? row.file_names : (row.parameters?.r2Keys || row.parameters?.fileKeys || []);
  
  // Handle sample labels from multiple sources
  const sampleLabels = row.sample_labels?.length ? row.sample_labels : (row.parameters?.sampleLabels || []);
  
  // Handle algorithms from multiple sources (note: database has both 'method' and 'algorithms')
  const algorithms = row.algorithms || 
    row.parameters?.algorithms ||
    (Array.isArray(row.method) ? row.method : [row.method || 'mageck']);
  
  return {
    id: row.id,
    name: row.name,
    status: (row.status || 'pending') as Analysis['status'],
    algorithm: algorithms,
    libraryType: (row.library_type || row.library || row.parameters?.libraryType || 'brunello') as Analysis['libraryType'],
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

export const dynamic = 'force-dynamic';

function isSupabaseUnreachable(error: unknown): boolean {
  const msg = String(error && typeof error === 'object' && 'message' in error ? (error as { message: string }).message : '');
  return msg.includes('521') || msg.includes('Web server is down') || msg.includes('<!DOCTYPE') || msg.includes('connection') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT');
}

export async function GET() {
  try {
    const { user, error: authError } = await getApiUser();

    if (authError && isSupabaseUnreachable(authError)) {
      return NextResponse.json([]);
    }

    if (!authError && user) {
      // Fetch only metadata — do NOT select results (huge JSONB); use status for "has results"
      const { data: ownRows, error: ownError } = await supabaseAdmin
        .from('analyses')
        .select('id, name, status, created_at, updated_at, started_at, completed_at, progress, current_step, error_message, file_names, sample_labels, parameters, method, library, user_id, logs')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100);

      if (ownError) {
        if (isSupabaseUnreachable(ownError)) {
          return NextResponse.json([]);
        }
        console.error('Error fetching own analyses:', ownError.message || ownError);
        return NextResponse.json([]);
      }

      const ownAnalyses = (ownRows || []).map((r: any) => ({
        ...rowToAnalysis(r),
        isOwner: true,
        isShared: false,
        ownerEmail: user.email,
      }));

      const res = NextResponse.json(ownAnalyses);
      res.headers.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30');
      return res;
    }

    const analysesList = (Array.from(analysesMemory.values()) as Analysis[])
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return NextResponse.json(analysesList);
  } catch (error) {
    if (isSupabaseUnreachable(error)) {
      return NextResponse.json([]);
    }
    console.error('Error fetching analyses:', error);
    return NextResponse.json([], { status: 500 });
  }
}
