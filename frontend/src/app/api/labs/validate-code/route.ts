import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import type { InviteCodeValidation } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/labs/validate-code
 * Validate invite code without authentication (for sign-up form)
 *
 * This endpoint is public to allow real-time validation during sign-up.
 * It returns minimal lab info (name, institution) if code is valid.
 *
 * Request body:
 * - invite_code: string (6 chars alphanumeric)
 *
 * Returns:
 * - valid: boolean
 * - lab?: { name, institution } (if valid)
 * - error?: string (if invalid)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { invite_code } = body;

    // ===== VALIDATION =====

    if (!invite_code?.trim()) {
      const response: InviteCodeValidation = {
        valid: false,
        error: 'Invite code is required',
      };
      return NextResponse.json(response, { status: 400 });
    }

    // Normalize code: uppercase and trim
    const code = invite_code.trim().toUpperCase();

    // Validate format: exactly 6 alphanumeric characters
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      const response: InviteCodeValidation = {
        valid: false,
        error: 'Invalid code format',
      };
      return NextResponse.json(response);
    }

    // ===== LOOKUP LAB BY INVITE CODE =====

    const admin = supabaseAdmin as any;

    const { data: lab, error } = await admin
      .from('labs')
      .select('id, name, institution')
      .eq('invite_code', code)
      .maybeSingle();

    if (error) {
      console.error('Validate code lookup error:', error);
      throw error;
    }

    // ===== RETURN RESULT =====

    if (!lab) {
      const response: InviteCodeValidation = {
        valid: false,
        error: 'Invalid invite code',
      };
      return NextResponse.json(response);
    }

    const response: InviteCodeValidation = {
      valid: true,
      lab: {
        name: lab.name,
        institution: lab.institution,
      },
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Validate code error:', error);
    const response: InviteCodeValidation = {
      valid: false,
      error: 'Failed to validate code',
    };
    return NextResponse.json(response, { status: 500 });
  }
}
