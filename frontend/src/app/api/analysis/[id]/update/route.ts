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
    const admin = supabaseAdmin as any;

    if (!analysisId) {
      return NextResponse.json({ error: 'Analysis ID is required' }, { status: 400 });
    }

    const { user, error: authError } = await (await import("@/lib/supabase/server")).getApiUser();
    if (authError || !user) {
      console.error('Auth error in update:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Name is required and must be a non-empty string' }, { status: 400 });
    }

    // Check if analysis exists and get ownership info
    const { data: analysis, error: fetchError } = await admin
      .from('analyses')
      .select('user_id')
      .eq('id', analysisId)
      .maybeSingle();

    if (fetchError) {
      console.error('Error fetching analysis:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch analysis', details: fetchError.message }, { status: 500 });
    }

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

    // Update the analysis name
    const { data: updated, error: updateError } = await admin
      .from('analyses')
      .update({
        name: name.trim(),
        updated_at: new Date().toISOString()
      })
      .eq('id', analysisId)
      .select()
      .single();

    if (updateError) {
      console.error('Update error:', updateError);
      return NextResponse.json({ error: 'Failed to update analysis', details: updateError.message }, { status: 500 });
    }

    console.log('Analysis updated successfully:', analysisId, 'New name:', name.trim());
    return NextResponse.json({
      success: true,
      message: 'Analysis updated successfully',
      data: updated
    });
  } catch (error) {
    console.error('Update analysis error:', error);
    return NextResponse.json({
      error: 'Failed to update analysis',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
