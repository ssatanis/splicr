import { NextResponse } from 'next/server';
import { getApiUser, supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/labs/leave
 * Leave current lab (PI cannot leave unless transferring ownership)
 *
 * Returns:
 * - success: boolean
 * - message: string
 */
export async function DELETE() {
  try {
    const { user, error: authError } = await getApiUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = supabaseAdmin as any;

    // ===== GET USER'S CURRENT MEMBERSHIP =====

    const { data: membership, error: memberError } = await admin
      .from('lab_members')
      .select('lab_id, role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (memberError) {
      console.error('Membership lookup error:', memberError);
      throw memberError;
    }

    if (!membership) {
      return NextResponse.json(
        { error: 'You are not in a lab' },
        { status: 400 }
      );
    }

    // ===== PREVENT PI FROM LEAVING =====
    // PI must transfer ownership before leaving

    if (membership.role === 'pi') {
      return NextResponse.json(
        {
          error: 'PI cannot leave lab. Transfer ownership to another member first, or delete the lab.',
        },
        { status: 400 }
      );
    }

    // ===== REMOVE MEMBERSHIP =====

    const { error: deleteError } = await admin
      .from('lab_members')
      .delete()
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('Leave lab error:', deleteError);
      throw deleteError;
    }

    // ===== SUCCESS RESPONSE =====

    return NextResponse.json({
      success: true,
      message: 'Left lab successfully. You can now join or create another lab.',
    });
  } catch (error: any) {
    console.error('Leave lab error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to leave lab' },
      { status: 500 }
    );
  }
}
