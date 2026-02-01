/**
 * Access Check API
 * Public endpoint to verify if user can access an analysis
 * Returns: { hasAccess: boolean, permission: 'view'|'edit'|null, method: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkAnalysisAccess, logAnalysisAccess } from '@/lib/access-control';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const analysisId = params.id;
    const { searchParams } = new URL(request.url);
    const shareToken = searchParams.get('token');

    // Get user if authenticated (optional for public links)
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Get user email from profile if user is authenticated
    let userEmail = user?.email || null;
    if (user && !userEmail) {
      const { data } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', user.id)
        .single();
      const profile = data as { email?: string | null } | null;
      userEmail = profile?.email || null;
    }

    // Check access
    const accessResult = await checkAnalysisAccess({
      analysisId,
      userId: user?.id || null,
      userEmail,
      shareToken,
      checkOnly: true, // Don't log access from this endpoint
    });

    // Get IP and user agent for response (optional metadata)
    const ipAddress = request.headers.get('x-forwarded-for') ||
                      request.headers.get('x-real-ip') ||
                      null;
    const userAgent = request.headers.get('user-agent') || null;

    // Log the access check (for audit trail)
    if (accessResult.hasAccess && accessResult.method) {
      await logAnalysisAccess({
        analysisId,
        userId: user?.id || null,
        accessType: 'view',
        accessMethod: accessResult.method,
        ipAddress,
        userAgent,
      }).catch(() => {}); // Don't fail if logging fails
    }

    return NextResponse.json({
      hasAccess: accessResult.hasAccess,
      permission: accessResult.permission,
      method: accessResult.method,
      isOwner: accessResult.isOwner,
      isExpired: accessResult.isExpired || false,
      requiresAuth: accessResult.requiresAuth || false,
    });
  } catch (error) {
    console.error('Access check error:', error);
    return NextResponse.json(
      {
        hasAccess: false,
        permission: null,
        method: null,
        isOwner: false,
        error: 'Failed to check access',
      },
      { status: 500 }
    );
  }
}
