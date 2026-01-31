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
    userId: row.user_id,
  } as Analysis;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (!authError && user) {
      // Get user's own analyses
      const { data: ownRows, error: ownError } = await (supabase.from('analyses') as any)
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (ownError) {
        console.error('Error fetching own analyses:', ownError);
      }

      const ownAnalyses = (ownRows || []).map((r: any) => ({
        ...rowToAnalysis(r),
        isOwner: true,
        isShared: false,
      }));

      // Get analyses shared with user (by email)
      let sharedAnalyses: any[] = [];
      try {
        const { data: shares } = await (supabase.from('analysis_shares') as any)
          .select('analysis_id, permission')
          .eq('email', user.email?.toLowerCase())
          .eq('status', 'accepted');

        if (shares && shares.length > 0) {
          const sharedIds = shares.map((s: any) => s.analysis_id);
          const { data: sharedRows } = await (supabase.from('analyses') as any)
            .select('*')
            .in('id', sharedIds)
            .order('created_at', { ascending: false });

          sharedAnalyses = (sharedRows || []).map((r: any) => {
            const share = shares.find((s: any) => s.analysis_id === r.id);
            return {
              ...rowToAnalysis(r),
              isOwner: false,
              isShared: true,
              permission: share?.permission || 'view',
            };
          });
        }
      } catch {
        // analysis_shares table might not exist
      }

      // Combine and deduplicate
      const allAnalyses = [...ownAnalyses, ...sharedAnalyses];
      return NextResponse.json(allAnalyses);
    }

    const analysesList = (Array.from(analysesMemory.values()) as Analysis[])
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return NextResponse.json(analysesList);
  } catch (error) {
    console.error('Error fetching analyses:', error);
    return NextResponse.json([], { status: 500 });
  }
}
