import { NextRequest, NextResponse } from 'next/server';
import { createClient, supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Update analysis metadata (name, etc.)
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const analysisId = params.id;
    const supabase = await createClient();
    const admin = supabaseAdmin as any;

    const { user, error: authError } = await (await import("@/lib/supabase/server")).getApiUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const { data: analysis } = await admin
      .from('analyses')
      .select('user_id')
      .eq('id', analysisId)
      .single();

    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    const isOwner = analysis.user_id === user.id;
    let hasEditPermission = false;

    if (!isOwner) {
      const { data: share } = await admin
        .from('analysis_shares')
        .select('permission')
        .eq('analysis_id', analysisId)
        .eq('email', user.email?.toLowerCase())
        .eq('status', 'accepted')
        .maybeSingle();

      hasEditPermission = share?.permission === 'edit' || share?.permission === 'admin';
    }

    if (!isOwner && !hasEditPermission) {
      return NextResponse.json({ error: 'Not authorized to edit this analysis' }, { status: 403 });
    }

    const { error: updateError } = await admin
      .from('analyses')
      .update({ name: name.trim() })
      .eq('id', analysisId);

    if (updateError) {
      console.error('Update error:', updateError);
      return NextResponse.json({ error: 'Failed to update analysis' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Analysis updated' });
  } catch (error) {
    console.error('Update analysis error:', error);
    return NextResponse.json({ error: 'Failed to update analysis' }, { status: 500 });
  }
}
