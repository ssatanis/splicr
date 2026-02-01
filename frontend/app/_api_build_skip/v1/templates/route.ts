import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/apiAuth';
import { defaultTemplates } from '@/lib/default-templates';

export async function GET(request: NextRequest) {
  const { ok, remaining } = checkRateLimit(request);
  const headers = { 'X-RateLimit-Remaining': String(remaining) };

  if (!ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers });
  }

  try {
    const list = defaultTemplates.map((t) => ({
      id: t.name.toLowerCase().replace(/\s+/g, '-'),
      name: t.name,
      description: t.description,
      category: t.category,
      parameters: t.placeholders
    }));
    return NextResponse.json(list, { headers });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to list templates' }, { status: 500, headers });
  }
}
