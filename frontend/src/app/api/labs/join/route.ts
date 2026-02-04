import { NextResponse } from 'next/server';
import { getApiUser, supabaseAdmin } from '@/lib/supabase/server';
import type { JoinLabRequest, Lab, LabMember } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/labs/join
 * Join a lab using an invite code
 *
 * Request body:
 * - invite_code: string (required, 6 chars alphanumeric)
 * - title?: string (optional job title like "Postdoc", "PhD Student")
 *
 * Returns:
 * - lab: Lab object joined
 * - membership: LabMember object created
 */
export async function POST(request: Request) {
  try {
    const { user, error: authError } = await getApiUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = supabaseAdmin as any;
    const body: JoinLabRequest = await request.json();
    const { invite_code, title } = body;

    // ===== VALIDATION =====

    if (!invite_code?.trim()) {
      return NextResponse.json(
        { error: 'Invite code is required' },
        { status: 400 }
      );
    }

    // Normalize code: uppercase and trim
    const code = invite_code.trim().toUpperCase();

    // Validate format: exactly 6 alphanumeric characters
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      return NextResponse.json(
        { error: 'Invalid invite code format. Code must be 6 characters.' },
        { status: 400 }
      );
    }

    // ===== CHECK IF USER ALREADY IN LAB =====

    const { data: existingMembership } = await admin
      .from('lab_members')
      .select('id, lab_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingMembership) {
      return NextResponse.json(
        {
          error: 'You are already a member of a lab. Leave your current lab before joining another.',
        },
        { status: 400 }
      );
    }

    // ===== FIND LAB BY INVITE CODE =====

    const { data: lab, error: labError } = await admin
      .from('labs')
      .select('*')
      .eq('invite_code', code)
      .maybeSingle();

    if (labError) {
      console.error('Lab lookup error:', labError);
      throw labError;
    }

    if (!lab) {
      return NextResponse.json(
        { error: 'Invalid invite code. Double-check the code or contact your PI.' },
        { status: 404 }
      );
    }

    // ===== ADD USER AS MEMBER =====

    const { data: membership, error: memberError } = await admin
      .from('lab_members')
      .insert({
        lab_id: lab.id,
        user_id: user.id,
        role: 'member',
        title: title?.trim() || null,
        joined_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (memberError) {
      console.error('Join lab error:', memberError);

      // Handle specific error cases
      if (memberError.code === '23505') {
        // Unique constraint violation - already a member
        return NextResponse.json(
          { error: 'You are already a member of this lab' },
          { status: 400 }
        );
      }

      throw new Error(memberError.message || 'Failed to join lab');
    }

    // ===== SUCCESS RESPONSE =====

    return NextResponse.json({
      success: true,
      lab: lab as Lab,
      membership: membership as LabMember,
      message: `Successfully joined ${lab.name}!`,
    });
  } catch (error: any) {
    console.error('Join lab error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to join lab' },
      { status: 500 }
    );
  }
}
