import { NextRequest, NextResponse } from 'next/server';
import { createClient, supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Accept a share invitation.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const analysisId = params.id;
    const supabase = await createClient();
    const admin = supabaseAdmin as any;

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find pending share for this user's email
    const { data: share, error } = await admin
      .from('analysis_shares')
      .select('*')
      .eq('analysis_id', analysisId)
      .eq('email', user.email?.toLowerCase())
      .eq('status', 'pending')
      .single();

    if (error || !share) {
      return NextResponse.json({ error: 'No pending invitation found' }, { status: 404 });
    }

    // Accept the share
    const { error: updateError } = await admin
      .from('analysis_shares')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        user_id: user.id,
      })
      .eq('id', share.id);

    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      message: 'Invitation accepted',
    });
  } catch (error) {
    console.error('Accept share error:', error);
    return NextResponse.json({ error: 'Failed to accept invitation' }, { status: 500 });
  }
}
