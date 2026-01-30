import { NextRequest, NextResponse } from 'next/server';

// Shared storage (in production, use database)
const globalAnalyses = globalThis as any;
if (!globalAnalyses.analysesStore) {
  globalAnalyses.analysesStore = new Map();
}
const analyses = globalAnalyses.analysesStore;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const id = params.id;
    const analysis = analyses.get(id);

    if (!analysis) {
      return NextResponse.json(
        { message: 'Analysis not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(analysis);
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
    analyses.delete(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { message: 'Failed to delete analysis' },
      { status: 500 }
    );
  }
}
