import { NextResponse } from 'next/server';
import { getApiUser, supabaseAdmin } from '@/lib/supabase/server';
import type { LabMembershipInfo, Lab, LabMember } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/labs/me
 * Get current user's lab membership and lab details
 *
 * Returns:
 * - inLab: boolean (whether user is in a lab)
 * - lab: Lab object | null
 * - membership: LabMember object | null
 * - role: LabRole | null
 */
export async function GET() {
  try {
    const { user, error: authError } = await getApiUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = supabaseAdmin as any;

    // ===== GET USER'S LAB MEMBERSHIP =====

    const { data: membership, error: memberError } = await admin
      .from('lab_members')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (memberError) {
      console.error('Membership lookup error:', memberError);
      throw memberError;
    }

    // User is not in any lab
    if (!membership) {
      const response: LabMembershipInfo = {
        inLab: false,
        lab: null,
        membership: null,
        role: null,
      };
      return NextResponse.json(response);
    }

    // ===== GET LAB DETAILS =====

    const { data: lab, error: labError } = await admin
      .from('labs')
      .select('*')
      .eq('id', membership.lab_id)
      .single();

    if (labError) {
      console.error('Lab lookup error:', labError);
      throw labError;
    }

    // ===== SUCCESS RESPONSE =====

    const response: LabMembershipInfo = {
      inLab: true,
      lab: lab as Lab,
      membership: membership as LabMember,
      role: membership.role,
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Get lab membership error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get lab membership' },
      { status: 500 }
    );
  }
}
