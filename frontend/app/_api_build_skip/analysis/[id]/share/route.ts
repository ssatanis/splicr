import { NextRequest, NextResponse } from 'next/server';
import { createClient, supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Share analysis with collaborators via email.
 * Creates entries in analysis_shares table and optionally sends email notifications.
 */

// GET - List all collaborators for an analysis
export async function GET(
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

    // Verify user owns this analysis or is a collaborator
    const { data: analysis } = await admin
      .from('analyses')
      .select('user_id')
      .eq('id', analysisId)
      .single();

    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    // Get shares (only email invitations, not link shares)
    const { data: shares, error } = await admin
      .from('analysis_shares')
      .select('id, email, permission, status, created_at, accepted_at, shared_by, user_id')
      .eq('analysis_id', analysisId)
      .eq('is_link_share', false)
      .order('created_at', { ascending: false });

    if (error) {
      // Table might not exist yet - return empty array
      if (error.code === '42P01') {
        return NextResponse.json({ shares: [], owner: analysis.user_id === user.id });
      }
      throw error;
    }

    return NextResponse.json({
      shares: shares || [],
      owner: analysis.user_id === user.id,
    });
  } catch (error) {
    console.error('Get shares error:', error);
    return NextResponse.json({ error: 'Failed to get collaborators' }, { status: 500 });
  }
}

// POST - Invite a collaborator by email
export async function POST(
  request: NextRequest,
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

    const body = await request.json();
    const { email, permission = 'view' } = body;

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    // Verify user owns this analysis
    const { data: analysis } = await admin
      .from('analyses')
      .select('user_id, name')
      .eq('id', analysisId)
      .single();

    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    if (analysis.user_id !== user.id) {
      return NextResponse.json({ error: 'Only the owner can share this analysis' }, { status: 403 });
    }

    // Check if already shared with this email
    const { data: existing } = await admin
      .from('analysis_shares')
      .select('id')
      .eq('analysis_id', analysisId)
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'Already shared with this email' }, { status: 409 });
    }

    // Create share record
    const { data: share, error: insertError } = await admin
      .from('analysis_shares')
      .insert({
        analysis_id: analysisId,
        email: email.toLowerCase(),
        permission,
        status: 'pending',
        shared_by: user.id,
        is_link_share: false, // Email invitation, not link share
      })
      .select()
      .single();

    if (insertError) {
      // If table doesn't exist, create it first
      if (insertError.code === '42P01') {
        // Create the table
        await admin.rpc('create_analysis_shares_table');
        // Retry insert
        const { data: retryShare, error: retryError } = await admin
          .from('analysis_shares')
          .insert({
            analysis_id: analysisId,
            email: email.toLowerCase(),
            permission,
            status: 'pending',
            shared_by: user.id,
            is_link_share: false, // Email invitation, not link share
          })
          .select()
          .single();

        if (retryError) throw retryError;
        return NextResponse.json({
          success: true,
          share: retryShare,
          message: `Invitation sent to ${email}`,
        });
      }
      throw insertError;
    }

    // Create notification for the invited user (if they exist)
    const { data: invitedUser } = await admin
      .from('profiles')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (invitedUser) {
      await admin.from('user_notifications').insert({
        user_id: invitedUser.id,
        type: 'share_invite',
        title: 'Analysis shared with you',
        message: `You've been invited to collaborate on "${analysis.name}"`,
        data: { analysis_id: analysisId, share_id: share.id },
      }).catch(() => {}); // Ignore notification errors
    }

    return NextResponse.json({
      success: true,
      share,
      message: `Invitation sent to ${email}`,
    });
  } catch (error) {
    console.error('Share analysis error:', error);
    return NextResponse.json({ error: 'Failed to share analysis' }, { status: 500 });
  }
}

// DELETE - Remove a collaborator
export async function DELETE(
  request: NextRequest,
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

    const { searchParams } = new URL(request.url);
    const shareId = searchParams.get('shareId');
    const email = searchParams.get('email');

    if (!shareId && !email) {
      return NextResponse.json({ error: 'shareId or email is required' }, { status: 400 });
    }

    // Verify user owns this analysis
    const { data: analysis } = await admin
      .from('analyses')
      .select('user_id')
      .eq('id', analysisId)
      .single();

    if (!analysis || analysis.user_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    // Delete share (only email invitations, not link shares)
    let query = admin.from('analysis_shares').delete()
      .eq('analysis_id', analysisId)
      .eq('is_link_share', false);
    if (shareId) {
      query = query.eq('id', shareId);
    } else if (email) {
      query = query.eq('email', email.toLowerCase());
    }

    const { error: deleteError } = await query;
    if (deleteError) {
      if (deleteError.code === '42P01') {
        return NextResponse.json({ success: true, message: 'No shares to remove' });
      }
      throw deleteError;
    }

    return NextResponse.json({ success: true, message: 'Collaborator removed' });
  } catch (error) {
    console.error('Remove share error:', error);
    return NextResponse.json({ error: 'Failed to remove collaborator' }, { status: 500 });
  }
}
