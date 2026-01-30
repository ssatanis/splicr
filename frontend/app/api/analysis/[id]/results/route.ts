import { NextRequest, NextResponse } from 'next/server';

const globalStore = globalThis as any;
if (!globalStore.resultsStore) globalStore.resultsStore = new Map();

const analysisResults = globalStore.resultsStore;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const id = params.id;
    const results = analysisResults.get(id);

    if (!results) {
      return NextResponse.json(
        { message: 'Results not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(results);
  } catch (error) {
    return NextResponse.json(
      { message: 'Failed to fetch results' },
      { status: 500 }
    );
  }
}
