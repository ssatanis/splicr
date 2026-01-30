import { NextRequest, NextResponse } from 'next/server';

const globalStore = globalThis as any;
if (!globalStore.batchJobsStore) globalStore.batchJobsStore = new Map();
const batchJobs = globalStore.batchJobsStore;

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, analysisIds, algorithm = 'bagel2', userId = 'default_user' } = body;

    if (!name || !Array.isArray(analysisIds) || analysisIds.length === 0) {
      return NextResponse.json(
        { error: 'name and analysisIds (array) are required' },
        { status: 400 }
      );
    }

    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const job = {
      id: batchId,
      user_id: userId,
      name,
      status: 'pending',
      total_items: analysisIds.length,
      completed_items: 0,
      algorithm,
      analysis_ids: analysisIds,
      parameters: body.parameters || {},
      created_at: new Date().toISOString(),
      started_at: null as string | null,
      completed_at: null as string | null,
      items: analysisIds.map((aid: string, i: number) => ({
        analysis_id: aid,
        position: i,
        status: 'pending',
        result: null
      }))
    };

    batchJobs.set(batchId, job);

    return NextResponse.json({
      batchJobId: batchId,
      status: 'pending',
      totalItems: job.total_items,
      message: 'Batch job created. Run each analysis via POST /api/analyze/bagel2 or /api/analyze/drugz with the analysis IDs, or use the UI to start the batch.'
    });
  } catch (error) {
    console.error('Batch create error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create batch job' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const batchId = request.nextUrl.searchParams.get('batchJobId');
  if (!batchId) {
    return NextResponse.json({ error: 'batchJobId required' }, { status: 400 });
  }
  const job = batchJobs.get(batchId);
  if (!job) {
    return NextResponse.json({ error: 'Batch job not found' }, { status: 404 });
  }
  return NextResponse.json(job);
}
