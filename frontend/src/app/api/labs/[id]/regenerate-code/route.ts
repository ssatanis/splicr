import { NextRequest, NextResponse } from 'next/server';
import { getApiUser, supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/labs/[id]/regenerate-code
 * Regenerate lab invite code (PI/Admin only)
 *
 * This invalidates the old code and generates a new one.
 * Use when code has been compromised or needs to be changed.
 *
 * Returns:
 * - invite_code: string (new 6-character code)
 * - message: string
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error: authError } = await getApiUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const params = await context.params;
    const labId = params.id;
    const admin = supabaseAdmin as any;

    // ===== VERIFY USER IS PI OR ADMIN =====

    const { data: membership } = await admin
      .from('lab_members')
      .select('role')
      .eq('lab_id', labId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership || !['pi', 'admin'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Only PI and Admins can regenerate invite code' },
        { status: 403 }
      );
    }

    // ===== REGENERATE CODE USING SQL FUNCTION =====
    // The SQL function handles uniqueness checking and returns the new code

    const { data: newCode, error: rpcError } = await admin.rpc(
      'regenerate_lab_invite_code',
      { lab_id_param: labId }
    );

    if (rpcError) {
      console.error('Regenerate code RPC error:', rpcError);
      throw new Error(rpcError.message || 'Failed to regenerate code');
    }

    // ===== VERIFY NEW CODE WAS SET =====
    // Fetch the updated lab to confirm and get the new code

    const { data: lab, error: labError } = await admin
      .from('labs')
      .select('invite_code')
      .eq('id', labId)
      .single();

    if (labError) {
      console.error('Lab lookup error:', labError);
      throw labError;
    }

    // ===== SUCCESS RESPONSE =====

    return NextResponse.json({
      success: true,
      invite_code: lab.invite_code,
      message: `Invite code regenerated successfully. New code: ${lab.invite_code}`,
    });
  } catch (error: any) {
    console.error('Regenerate code error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to regenerate invite code' },
      { status: 500 }
    );
  }
}
