import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const globalStore = globalThis as any;
if (!globalStore.notesStore) globalStore.notesStore = new Map();
const notesMemory = globalStore.notesStore;

export const dynamic = 'force-dynamic';

/**
 * Get note for an analysis.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const id = params.id;

    const supabase = await createClient();
    const { user } = await (await import("@/lib/supabase/server")).getApiUser();

    if (user) {
      const { data: row, error } = await (supabase.from('analyses') as any)
        .select('parameters')
        .eq('id', id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!error && row?.parameters != null) {
        const note = (row.parameters as Record<string, unknown>)?.notes;
        const text = typeof note === 'string' ? note : '';
        return NextResponse.json({ note: text });
      }
    }

    const note = notesMemory.get(id) || '';
    return NextResponse.json({ note });
  } catch (error) {
    console.error('Notes GET error:', error);
    return NextResponse.json({ note: '' }, { status: 500 });
  }
}

/**
 * Save note for an analysis.
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const id = params.id;
    const body = await request.json();
    const note = typeof body.note === 'string' ? body.note : '';

    const supabase = await createClient();
    const { user } = await (await import("@/lib/supabase/server")).getApiUser();

    if (user) {
      const { data: row } = await (supabase.from('analyses') as any)
        .select('parameters')
        .eq('id', id)
        .eq('user_id', user.id)
        .maybeSingle();

      const parameters = (row?.parameters && typeof row.parameters === 'object') ? { ...row.parameters } : {};
      parameters.notes = note;

      const { error } = await (supabase.from('analyses') as any)
        .update({ parameters: parameters as Record<string, unknown> })
        .eq('id', id)
        .eq('user_id', user.id);

      if (!error) {
        return NextResponse.json({ success: true });
      }
    }

    notesMemory.set(id, note);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Notes PUT error:', error);
    return NextResponse.json(
      { message: 'Failed to save note' },
      { status: 500 }
    );
  }
}
