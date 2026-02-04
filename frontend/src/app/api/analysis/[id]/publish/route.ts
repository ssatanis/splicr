import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** GET: Check if analysis is published to the caller's public profile */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ published: false }, { status: 200 });
    }
    const { data } = await supabase
      .from('public_analyses')
      .select('id')
      .eq('analysis_id', id)
      .eq('published_by', user.id)
      .maybeSingle();
    return NextResponse.json({ published: !!data });
  } catch {
    return NextResponse.json({ published: false }, { status: 500 });
  }
}

/** POST: Publish analysis to caller's public profile (owner only) */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const title = typeof body.title === 'string' ? body.title.trim() : null;
    const description = typeof body.description === 'string' ? body.description.trim() : null;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: 'Sign in to publish.' }, { status: 401 });
    }

    const { data: analysis } = await (supabase.from('analyses') as any)
      .select('id, name, user_id')
      .eq('id', id)
      .single();

    if (!analysis || (analysis as { user_id?: string }).user_id !== user.id) {
      return NextResponse.json({ message: 'Analysis not found or you are not the owner.' }, { status: 404 });
    }

    const { data: existing } = await supabase
      .from('public_analyses')
      .select('id')
      .eq('analysis_id', id)
      .maybeSingle();

    if (existing) {
      const existingRow = existing as { id: string };
      const { error } = await (supabase.from('public_analyses') as any)
        .update({
          title: title ?? (analysis as { name?: string }).name,
          description: description ?? null,
        })
        .eq('id', existingRow.id);
      if (error) {
        return NextResponse.json({ message: 'Failed to update.' }, { status: 500 });
      }
      return NextResponse.json({ success: true, updated: true });
    }

    const { error } = await (supabase.from('public_analyses') as any)
      .insert({
        analysis_id: id,
        title: title ?? (analysis as { name?: string }).name,
        description: description ?? null,
        published_by: user.id,
      });

    if (error) {
      return NextResponse.json({ message: error.message || 'Failed to publish.' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}

/** DELETE: Unpublish from public profile (owner only) */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: 'Sign in to unpublish.' }, { status: 401 });
    }

    const { error } = await supabase
      .from('public_analyses')
      .delete()
      .eq('analysis_id', id)
      .eq('published_by', user.id);

    if (error) {
      return NextResponse.json({ message: error.message || 'Failed to unpublish.' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}
