/**
 * Core Access Control Logic
 *
 * Determines if a user can access an analysis and returns their permission level.
 *
 * Access Precedence (checked in order):
 * 1. Owner → Always has edit access
 * 2. Direct collaborator (invited via email) → Uses invitation permission
 * 3. Institution member (same email domain) → Uses institution_permission
 * 4. Public link (valid token) → Uses link_permission
 * 5. Denied → No access granted
 */

import type { AccessCheckResult, AccessMethod, SharePermission } from './types';
import { supabaseAdmin } from './supabase/server';

interface AccessCheckOptions {
  analysisId: string;
  userId?: string | null;
  userEmail?: string | null;
  shareToken?: string | null;
  checkOnly?: boolean; // If true, don't log access
}

/**
 * Get email domain from email address
 */
function getEmailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() || '';
}

/**
 * Check if user can access an analysis and determine their permission level
 */
export async function checkAnalysisAccess(
  options: AccessCheckOptions
): Promise<AccessCheckResult> {
  const { analysisId, userId, userEmail, shareToken, checkOnly = false } = options;

  try {
    const admin = supabaseAdmin as any;

    // 1. Get analysis owner
    const { data: analysis, error: analysisError } = await admin
      .from('analyses')
      .select('user_id, name')
      .eq('id', analysisId)
      .single();

    if (analysisError || !analysis) {
      return {
        hasAccess: false,
        permission: null,
        method: null,
        isOwner: false,
      };
    }

    // Convert user_id to string for comparison
    const ownerId = analysis.user_id?.toString();
    const currentUserId = userId?.toString();

    // 2. Check if user is the owner
    if (currentUserId && ownerId === currentUserId) {
      return {
        hasAccess: true,
        permission: 'edit',
        method: 'owner',
        isOwner: true,
      };
    }

    // 3. Check if user is a direct collaborator (email invitation)
    if (currentUserId || userEmail) {
      const { data: collaborators } = await admin
        .from('analysis_shares')
        .select('permission, status, user_id, email, is_link_share')
        .eq('analysis_id', analysisId)
        .eq('is_link_share', false);

      if (collaborators && collaborators.length > 0) {
        // Try to match by user_id first (accepted invitations)
        let match = collaborators.find(
          (c: any) => c.user_id && c.user_id === currentUserId && c.status === 'accepted'
        );

        // If no user_id match, try email (pending invitations)
        if (!match && userEmail) {
          match = collaborators.find(
            (c: any) => c.email.toLowerCase() === userEmail.toLowerCase()
          );
        }

        if (match) {
          // Map permission (keep 'admin' as 'edit' for access control)
          const permission: SharePermission =
            match.permission === 'admin' ? 'edit' : match.permission;

          return {
            hasAccess: true,
            permission,
            method: 'collaborator',
            isOwner: false,
          };
        }
      }
    }

    // 4. Get link share configuration
    const { data: linkShare } = await admin
      .from('analysis_shares')
      .select('*')
      .eq('analysis_id', analysisId)
      .eq('is_link_share', true)
      .maybeSingle();

    if (!linkShare) {
      // No link share configured, deny access
      return {
        hasAccess: false,
        permission: null,
        method: null,
        isOwner: false,
      };
    }

    // 5. Check if link has expired
    if (linkShare.link_expires_at) {
      const expiresAt = new Date(linkShare.link_expires_at);
      if (expiresAt < new Date()) {
        return {
          hasAccess: false,
          permission: null,
          method: null,
          isOwner: false,
          isExpired: true,
        };
      }
    }

    // 6. Check visibility level and grant access accordingly
    switch (linkShare.visibility) {
      case 'private':
        // Private: No link access (only direct collaborators)
        return {
          hasAccess: false,
          permission: null,
          method: null,
          isOwner: false,
        };

      case 'institution':
        // Institution: Check if user's email domain matches
        if (!userEmail) {
          return {
            hasAccess: false,
            permission: null,
            method: null,
            isOwner: false,
            requiresAuth: true,
          };
        }

        const userDomain = getEmailDomain(userEmail);
        if (
          linkShare.institution_domain &&
          userDomain === linkShare.institution_domain.toLowerCase()
        ) {
          return {
            hasAccess: true,
            permission: linkShare.institution_permission as SharePermission,
            method: 'institution',
            isOwner: false,
          };
        }

        // Check if token is provided for institution access
        if (shareToken && linkShare.share_token === shareToken) {
          return {
            hasAccess: true,
            permission: linkShare.institution_permission as SharePermission,
            method: 'institution',
            isOwner: false,
          };
        }

        return {
          hasAccess: false,
          permission: null,
          method: null,
          isOwner: false,
        };

      case 'public':
        // Public: Anyone with the token can access
        if (!shareToken) {
          return {
            hasAccess: false,
            permission: null,
            method: null,
            isOwner: false,
            requiresAuth: false,
          };
        }

        if (linkShare.share_token === shareToken) {
          return {
            hasAccess: true,
            permission: linkShare.link_permission as SharePermission,
            method: 'public_link',
            isOwner: false,
          };
        }

        return {
          hasAccess: false,
          permission: null,
          method: null,
          isOwner: false,
        };

      default:
        return {
          hasAccess: false,
          permission: null,
          method: null,
          isOwner: false,
        };
    }
  } catch (error) {
    console.error('Access check error:', error);
    return {
      hasAccess: false,
      permission: null,
      method: null,
      isOwner: false,
    };
  }
}

/**
 * Log access to an analysis for audit trail
 */
export async function logAnalysisAccess(options: {
  analysisId: string;
  userId: string | null;
  accessType: string;
  accessMethod: AccessMethod | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    const admin = supabaseAdmin as any;

    await admin.from('analysis_access_log').insert({
      analysis_id: options.analysisId,
      user_id: options.userId,
      access_type: options.accessType,
      access_method: options.accessMethod,
      ip_address: options.ipAddress,
      user_agent: options.userAgent,
    });
  } catch (error) {
    // Don't fail the request if logging fails
    console.error('Access logging error:', error);
  }
}

/**
 * Generate a cryptographically secure share token
 */
export function generateShareToken(): string {
  // Generate 32 random bytes and convert to base64url
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Buffer.from(array)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Get shareable URL for an analysis
 */
export function getShareableUrl(
  analysisId: string,
  shareToken: string,
  baseUrl?: string
): string {
  const base = baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${base}/results/${analysisId}?token=${shareToken}`;
}
