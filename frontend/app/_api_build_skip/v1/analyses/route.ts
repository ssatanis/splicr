import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/apiAuth';

const globalStore = globalThis as any;
if (!globalStore.analysesStore) globalStore.analysesStore = new Map();
const analyses = globalStore.analysesStore;

export async function GET(request: NextRequest) {
  const { ok, remaining } = checkRateLimit(request);
  const headers = { 'X-RateLimit-Remaining': String(remaining) };

  if (!ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers });
  }

  try {
    const list = Array.from(analyses.values()).sort(
      (a: any, b: any) =>
        new Date(b.createdAt || b.created_at || 0).getTime() -
        new Date(a.createdAt || a.created_at || 0).getTime()
    );
    return NextResponse.json(list, { headers });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to list analyses' }, { status: 500, headers });
  }
}

export async function POST(request: NextRequest) {
  const { ok, remaining } = checkRateLimit(request);
  const headers = { 'X-RateLimit-Remaining': String(remaining) };

  if (!ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers });
  }

  try {
    const body = await request.json();
    const { name, library, method = 'mageck', fastq_files } = body;

    const id = `analysis_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const record = {
      id,
      name: name || 'API Analysis',
      status: 'created',
      algorithm: [method],
      libraryType: library || 'brunello',
      fileKeys: Array.isArray(fastq_files) ? fastq_files : [],
      sampleLabels: [],
      parameters: body.parameters || {},
      createdAt: new Date().toISOString(),
      progress: 0,
      currentStep: 'Created via API'
    };

    analyses.set(id, record);
    return NextResponse.json(record, { status: 201, headers });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create analysis' }, { status: 500, headers });
  }
}
