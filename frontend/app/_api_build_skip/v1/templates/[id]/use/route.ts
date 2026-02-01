import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/apiAuth';
import { defaultTemplates } from '@/lib/default-templates';

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
    const template = defaultTemplates.find(
      (t) => t.name.toLowerCase().replace(/\s+/g, '-') === id
    );
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404, headers });
    }

    const body = await request.json().catch(() => ({}));
    const placeholders = template.placeholders as Record<string, { type: string; default: unknown }>;
    const parameters: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(placeholders || {})) {
      parameters[key] = (val as { default?: unknown }).default;
    }
    Object.assign(parameters, body.parameters || {});

    return NextResponse.json(
      {
        templateId: id,
        templateName: template.name,
        parameters,
        message: 'Use these parameters when creating an analysis via POST /api/v1/analyses'
      },
      { headers }
    );
  } catch (error) {
    return NextResponse.json({ error: 'Failed to use template' }, { status: 500, headers });
  }
}
