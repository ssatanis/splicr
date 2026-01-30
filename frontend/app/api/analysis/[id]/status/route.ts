import { NextRequest, NextResponse } from 'next/server';

const globalStore = globalThis as any;
if (!globalStore.analysesStore) globalStore.analysesStore = new Map();
if (!globalStore.statusStore) globalStore.statusStore = new Map();
if (!globalStore.logsStore) globalStore.logsStore = new Map();

const analyses = globalStore.analysesStore;
const analysisStatus = globalStore.statusStore;
const analysisLogs = globalStore.logsStore;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const id = params.id;
    const status = analysisStatus.get(id);
    const analysis = analyses.get(id);
    const logs = analysisLogs.get(id) || [];

    if (!status && !analysis) {
      return NextResponse.json(
        { status: 'not_found', progress: 0 },
        { status: 404 }
      );
    }

    const response = {
      status: status?.status || analysis?.status || 'created',
      progress: status?.progress || analysis?.progress || 0,
      currentStep: status?.currentStep || analysis?.currentStep,
      logs: logs.slice(-20), // Return last 20 log entries
      error: status?.error
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { status: 'error', progress: 0, error: 'Failed to fetch status' },
      { status: 500 }
    );
  }
}
