/**
 * Link-based sharing API
 * POST: Create or update link share configuration
 * GET: Get current link share configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, supabaseAdmin } from '@/lib/supabase/server';
import { generateShareToken, getShareableUrl } from '@/lib/access-control';
import type { ShareVisibility, SharePermission } from '@/lib/types';

export const dynamic = 'force-dynamic';

// GET - Get link share configuration
export async function GET(
  _request: NextRequest,
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

    // Verify user owns this analysis
    const { data: analysis } = await admin
      .from('analyses')
      .select('user_id')
      .eq('id', analysisId)
      .single();

    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    if (analysis.user_id !== user.id) {
      return NextResponse.json({ error: 'Only the owner can view share settings' }, { status: 403 });
    }

    // Get link share configuration
    const { data: linkShare } = await admin
      .from('analysis_shares')
      .select('*')
      .eq('analysis_id', analysisId)
      .eq('is_link_share', true)
      .maybeSingle();

    if (!linkShare) {
      return NextResponse.json({
        exists: false,
        linkShare: null
      });
    }

    // Generate shareable URL if token exists
    let shareableUrl = null;
    if (linkShare.share_token) {
      shareableUrl = getShareableUrl(analysisId, linkShare.share_token);
    }

    return NextResponse.json({
      exists: true,
      linkShare: {
        id: linkShare.id,
        visibility: linkShare.visibility,
        link_permission: linkShare.link_permission,
        institution_permission: linkShare.institution_permission,
        institution_domain: linkShare.institution_domain,
        link_expires_at: linkShare.link_expires_at,
        created_at: linkShare.created_at,
        updated_at: linkShare.updated_at,
      },
      shareableUrl,
    });
  } catch (error) {
    console.error('Get link share error:', error);
    return NextResponse.json({ error: 'Failed to get link share configuration' }, { status: 500 });
  }
}

// POST - Create or update link share configuration
export async function POST(
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
    const {
      visibility = 'private' as ShareVisibility,
      link_permission = 'view' as SharePermission,
      institution_permission = 'view' as SharePermission,
      link_expires_at = null,
    } = body;

    // Validate visibility
    if (!['private', 'institution', 'public'].includes(visibility)) {
      return NextResponse.json({ error: 'Invalid visibility level' }, { status: 400 });
    }

    // Validate permissions
    if (!['view', 'edit'].includes(link_permission)) {
      return NextResponse.json({ error: 'Invalid link permission' }, { status: 400 });
    }

    if (!['view', 'edit'].includes(institution_permission)) {
      return NextResponse.json({ error: 'Invalid institution permission' }, { status: 400 });
    }

    // Verify user owns this analysis
    const { data: analysis } = await admin
      .from('analyses')
      .select('user_id')
      .eq('id', analysisId)
      .single();

    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    if (analysis.user_id !== user.id) {
      return NextResponse.json({ error: 'Only the owner can configure sharing' }, { status: 403 });
    }

    // Get user's email to extract institution domain
    const { data: profile } = await admin
      .from('profiles')
      .select('email')
      .eq('id', user.id)
      .single();

    const userEmail = profile?.email || user.email;
    const institutionDomain = userEmail ? userEmail.split('@')[1]?.toLowerCase() : null;

    // Generate share token if needed (institution or public)
    let shareToken = null;
    if (visibility === 'institution' || visibility === 'public') {
      shareToken = generateShareToken();
    }

    // Check if link share already exists
    const { data: existing } = await admin
      .from('analysis_shares')
      .select('id')
      .eq('analysis_id', analysisId)
      .eq('is_link_share', true)
      .maybeSingle();

    let linkShare;

    if (existing) {
      // Update existing link share
      const { data: updated, error: updateError } = await admin
        .from('analysis_shares')
        .update({
          visibility,
          share_token: shareToken,
          link_permission,
          institution_permission,
          institution_domain: institutionDomain,
          link_expires_at,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (updateError) throw updateError;
      linkShare = updated;
    } else {
      // Create new link share
      const { data: created, error: createError } = await admin
        .from('analysis_shares')
        .insert({
          analysis_id: analysisId,
          email: '', // Empty for link shares
          permission: 'view', // Default, not used for link shares
          status: 'accepted', // Always accepted for link shares
          shared_by: user.id, // Database column is 'shared_by', not 'shared_by_user_id'
          is_link_share: true,
          visibility,
          share_token: shareToken,
          link_permission,
          institution_permission,
          institution_domain: institutionDomain,
          link_expires_at,
        })
        .select()
        .single();

      if (createError) throw createError;
      linkShare = created;
    }

    // Generate shareable URL
    let shareableUrl = null;
    if (shareToken) {
      shareableUrl = getShareableUrl(analysisId, shareToken);
    }

    return NextResponse.json({
      success: true,
      linkShare: {
        id: linkShare.id,
        visibility: linkShare.visibility,
        link_permission: linkShare.link_permission,
        institution_permission: linkShare.institution_permission,
        institution_domain: linkShare.institution_domain,
        link_expires_at: linkShare.link_expires_at,
        created_at: linkShare.created_at,
        updated_at: linkShare.updated_at,
      },
      shareableUrl,
      message: 'Link sharing configured successfully',
    });
  } catch (error) {
    console.error('Configure link share error:', error);
    return NextResponse.json({ error: 'Failed to configure link sharing' }, { status: 500 });
  }
}
