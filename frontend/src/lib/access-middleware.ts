/**
 * Security Middleware for Analysis Access Control
 *
 * Provides reusable middleware functions to protect API routes and pages
 * that require analysis access verification.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from './supabase/server';
import { checkAnalysisAccess, logAnalysisAccess } from './access-control';
import type { AccessCheckResult, SharePermission } from './types';

interface AccessMiddlewareOptions {
  analysisId: string;
  requiredPermission?: SharePermission;
  shareToken?: string | null;
  logAccess?: boolean;
  accessType?: string;
}

interface AccessMiddlewareResult {
  authorized: boolean;
  response?: NextResponse;
  accessResult?: AccessCheckResult;
  userId?: string | null;
  userEmail?: string | null;
}

/**
 * Middleware to verify analysis access
 *
 * Usage in API routes:
 * ```
 * const { authorized, response, accessResult } = await requireAnalysisAccess({
 *   analysisId,
 *   requiredPermission: 'edit',
 *   logAccess: true,
 *   accessType: 'edit',
 * });
 *
 * if (!authorized) {
 *   return response; // Returns 401, 403, or 404
 * }
 *
 * // Continue with authorized request
 * ```
 */
export async function requireAnalysisAccess(
  options: AccessMiddlewareOptions
): Promise<AccessMiddlewareResult> {
  const {
    analysisId,
    requiredPermission,
    shareToken,
    logAccess = true,
    accessType = 'view',
  } = options;

  try {
    // Get current user (optional for public links)
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Get user email if authenticated
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
      checkOnly: false,
    });

    // If no access, return 403 or 401
    if (!accessResult.hasAccess) {
      if (accessResult.requiresAuth) {
        return {
          authorized: false,
          response: NextResponse.json(
            { error: 'Authentication required to access this analysis' },
            { status: 401 }
          ),
        };
      }

      if (accessResult.isExpired) {
        return {
          authorized: false,
          response: NextResponse.json(
            { error: 'Share link has expired' },
            { status: 403 }
          ),
        };
      }

      return {
        authorized: false,
        response: NextResponse.json(
          { error: 'You do not have access to this analysis' },
          { status: 403 }
        ),
      };
    }

    // Check permission level if required
    if (requiredPermission === 'edit' && accessResult.permission === 'view') {
      return {
        authorized: false,
        response: NextResponse.json(
          { error: 'You do not have edit permissions for this analysis' },
          { status: 403 }
        ),
      };
    }

    // Log access if enabled
    if (logAccess && accessResult.method) {
      await logAnalysisAccess({
        analysisId,
        userId: user?.id || null,
        accessType,
        accessMethod: accessResult.method,
      }).catch(() => {}); // Don't fail request if logging fails
    }

    return {
      authorized: true,
      accessResult,
      userId: user?.id || null,
      userEmail,
    };
  } catch (error) {
    console.error('Access middleware error:', error);
    return {
      authorized: false,
      response: NextResponse.json(
        { error: 'Failed to verify access' },
        { status: 500 }
      ),
    };
  }
}

/**
 * Extract share token from request URL
 */
export function getShareToken(request: NextRequest): string | null {
  const { searchParams } = new URL(request.url);
  return searchParams.get('token');
}

/**
 * Extract IP address from request headers
 */
export function getIpAddress(request: NextRequest): string | null {
  return (
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    null
  );
}

/**
 * Extract user agent from request headers
 */
export function getUserAgent(request: NextRequest): string | null {
  return request.headers.get('user-agent') || null;
}

/**
 * Verify user is the owner of an analysis
 *
 * Returns true if user owns the analysis, otherwise returns a 403 response
 */
export async function requireAnalysisOwner(
  analysisId: string,
  userId: string
): Promise<{ isOwner: boolean; response?: NextResponse }> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('analyses')
      .select('user_id')
      .eq('id', analysisId)
      .single();

    const analysis = data as { user_id: string } | null;
    if (!analysis) {
      return {
        isOwner: false,
        response: NextResponse.json(
          { error: 'Analysis not found' },
          { status: 404 }
        ),
      };
    }

    if (analysis.user_id !== userId) {
      return {
        isOwner: false,
        response: NextResponse.json(
          { error: 'Only the analysis owner can perform this action' },
          { status: 403 }
        ),
      };
    }

    return { isOwner: true };
  } catch (error) {
    console.error('Owner verification error:', error);
    return {
      isOwner: false,
      response: NextResponse.json(
        { error: 'Failed to verify ownership' },
        { status: 500 }
      ),
    };
  }
}
