import { NextRequest, NextResponse } from 'next/server';
import { createClient, supabaseAdmin } from '@/lib/supabase/server';
import { sendShareInviteEmail } from '@/lib/email/send';

export const dynamic = 'force-dynamic';

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

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

    const { user, error: authError } = await (await import('@/lib/supabase/server')).getApiUser();
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
      if (error.code === '42P01') {
        return NextResponse.json({ shares: [], owner: analysis.user_id === user.id });
      }
      // Column is_link_share may be missing — run migration 20260201120000_ensure_analysis_shares_is_link_share.sql
      const msg = String((error as { message?: string }).message ?? '');
      if (msg.includes('is_link_share') || msg.includes('schema cache')) {
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

    const { user, error: authError } = await (await import('@/lib/supabase/server')).getApiUser();
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
        shared_by: user.id, // Database column is 'shared_by', not 'shared_by_user_id'
        is_link_share: false, // Email invitation, not link share
      })
      .select()
      .single();

    if (insertError) {
      const code = (insertError as { code?: string }).code;
      const msg = String(insertError.message ?? '');
      const details = (insertError as any).details;
      const hint = (insertError as any).hint;

      // ENHANCED LOGGING - Log full error details for debugging
      console.error('❌ Share insert error FULL DETAILS:', {
        code,
        message: msg,
        details,
        hint,
        fullError: JSON.stringify(insertError, null, 2)
      });

      // Missing table
      if (code === '42P01') {
        return NextResponse.json(
          { error: 'Sharing is not available yet. Please run database migrations.' },
          { status: 503 }
        );
      }

      // Missing column (e.g. is_link_share not added yet)
      if (
        (msg.includes('is_link_share') && (msg.includes('does not exist') || msg.includes('could not find') || msg.includes('column'))) ||
        msg.includes('schema cache')
      ) {
        return NextResponse.json(
          {
            error:
              `Database schema issue: ${msg}. The migration may have run but the schema cache needs refresh. Try: 1) Restart your dev server, 2) Run 'NOTIFY pgrst, \'reload schema\'' in Supabase SQL Editor, or 3) Wait 60 seconds for cache refresh.`,
          },
          { status: 503 }
        );
      }

      // Unique constraint (e.g. old constraint allowed only one invite per analysis)
      if (code === '23505') {
        console.error('Unique constraint violation:', { msg, details, hint });
        return NextResponse.json(
          { error: 'This email has already been invited to this analysis, or a constraint is blocking the invite. Try removing the existing share first.' },
          { status: 409 }
        );
      }

      // Return the actual error message for debugging
      return NextResponse.json(
        { error: `Share failed: ${msg}${details ? ` (${details})` : ''}${hint ? ` Hint: ${hint}` : ''}` },
        { status: 500 }
      );
    }

    // In-app notification for the invited user (if they exist); also get display name for email
    const { data: invitedUser } = await admin
      .from('profiles')
      .select('id, full_name')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (invitedUser) {
      await admin.from('user_notifications').insert({
        user_id: invitedUser.id,
        type: 'share_invite',
        title: 'Analysis shared with you',
        message: `You've been invited to collaborate on "${analysis.name}"`,
        data: { analysis_id: analysisId, share_id: share.id },
      }).catch(() => {});
    }

    // Inviter display name for personalized email (SplicR branding)
    const { data: inviterProfile } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();

    const inviterNameOrEmail = user.email ?? 'A SplicR user';
    const inviterDisplayName = inviterProfile?.full_name?.trim() || null;
    const recipientDisplayName = invitedUser?.full_name?.trim() || null;
    const resultsUrl = `${getAppUrl().replace(/\/$/, '')}/results/${analysisId}`;

    const emailResult = await sendShareInviteEmail({
      to: email.toLowerCase(),
      inviterNameOrEmail,
      inviterDisplayName,
      analysisName: analysis.name ?? 'Screen Analysis',
      permission,
      resultsUrl,
      recipientDisplayName,
    });
    if (!emailResult.success) {
      console.warn('Share invite email failed:', emailResult.error);
    }

    return NextResponse.json({
      success: true,
      share,
      message: `Invitation sent to ${email}`,
      emailSent: emailResult.success,
      emailError: emailResult.success ? undefined : emailResult.error,
    });
  } catch (error) {
    console.error('Share analysis error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to share analysis' },
      { status: 500 }
    );
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

    const { user, error: authError } = await (await import('@/lib/supabase/server')).getApiUser();
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
