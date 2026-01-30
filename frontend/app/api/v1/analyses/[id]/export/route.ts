import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/apiAuth';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { ok, remaining } = checkRateLimit(request);
  const headers = { 'X-RateLimit-Remaining': String(remaining) };

  if (!ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers });
  }

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const format = body.format || 'pdf';

    return NextResponse.json(
      {
        message: 'Export requested',
        analysisId: id,
        format,
        downloadUrl: `/api/v1/analyses/${id}/export/download?format=${format}`,
        note: 'Use the SplicR UI for full PDF/DOCX export.'
      },
      { status: 202, headers }
    );
  } catch (error) {
    return NextResponse.json({ error: 'Failed to request export' }, { status: 500, headers });
  }
}
