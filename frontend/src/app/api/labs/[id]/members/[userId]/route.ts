import { NextRequest, NextResponse } from 'next/server';
import { getApiUser, supabaseAdmin } from '@/lib/supabase/server';
import type { UpdateLabMemberRequest, LabMember } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/labs/[id]/members/[userId]
 * Update member role or title (PI/Admin only)
 *
 * Request body:
 * - role?: 'admin' | 'member' | 'guest'
 * - title?: string | null
 *
 * Returns:
 * - member: Updated LabMember object
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { user, error: authError } = await getApiUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const params = await context.params;
    const { id: labId, userId: targetUserId } = params;
    const admin = supabaseAdmin as any;
    const body: UpdateLabMemberRequest = await request.json();
    const { role, title } = body;

    // ===== VERIFY REQUESTER IS PI OR ADMIN =====

    const { data: requesterMembership } = await admin
      .from('lab_members')
      .select('role')
      .eq('lab_id', labId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!requesterMembership || !['pi', 'admin'].includes(requesterMembership.role)) {
      return NextResponse.json(
        { error: 'Only PI and Admins can update member roles' },
        { status: 403 }
      );
    }

    // ===== GET TARGET MEMBER'S CURRENT ROLE =====

    const { data: targetMembership } = await admin
      .from('lab_members')
      .select('role')
      .eq('lab_id', labId)
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (!targetMembership) {
      return NextResponse.json(
        { error: 'Member not found in this lab' },
        { status: 404 }
      );
    }

    // ===== VALIDATION =====

    // Prevent changing PI role (PI is permanent)
    if (role === 'pi' || targetMembership.role === 'pi') {
      return NextResponse.json(
        { error: 'Cannot change or assign PI role. PI is permanent.' },
        { status: 400 }
      );
    }

    // Only PI can promote to admin (admins cannot promote others to admin)
    if (role === 'admin' && requesterMembership.role !== 'pi') {
      return NextResponse.json(
        { error: 'Only PI can promote members to admin' },
        { status: 403 }
      );
    }

    // Validate role value
    if (role && !['admin', 'member', 'guest'].includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be: admin, member, or guest' },
        { status: 400 }
      );
    }

    // ===== UPDATE MEMBER =====

    const updates: any = {};
    if (role) updates.role = role;
    if (title !== undefined) updates.title = title?.trim() || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No updates provided' },
        { status: 400 }
      );
    }

    const { data: updated, error } = await admin
      .from('lab_members')
      .update(updates)
      .eq('lab_id', labId)
      .eq('user_id', targetUserId)
      .select()
      .single();

    if (error) {
      console.error('Update member error:', error);
      throw error;
    }

    // ===== SUCCESS RESPONSE =====

    return NextResponse.json({
      success: true,
      member: updated as LabMember,
      message: 'Member updated successfully',
    });
  } catch (error: any) {
    console.error('Update member error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update member' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/labs/[id]/members/[userId]
 * Remove member from lab (PI/Admin only, cannot remove PI)
 *
 * Returns:
 * - success: boolean
 * - message: string
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { user, error: authError } = await getApiUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const params = await context.params;
    const { id: labId, userId: targetUserId } = params;
    const admin = supabaseAdmin as any;

    // ===== VERIFY REQUESTER IS PI OR ADMIN =====

    const { data: requesterMembership } = await admin
      .from('lab_members')
      .select('role')
      .eq('lab_id', labId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!requesterMembership || !['pi', 'admin'].includes(requesterMembership.role)) {
      return NextResponse.json(
        { error: 'Only PI and Admins can remove members' },
        { status: 403 }
      );
    }

    // ===== CHECK TARGET MEMBER ROLE =====

    const { data: targetMembership } = await admin
      .from('lab_members')
      .select('role')
      .eq('lab_id', labId)
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (!targetMembership) {
      return NextResponse.json(
        { error: 'Member not found in this lab' },
        { status: 404 }
      );
    }

    // Prevent removing PI
    if (targetMembership.role === 'pi') {
      return NextResponse.json(
        { error: 'Cannot remove PI from lab. Transfer ownership first.' },
        { status: 400 }
      );
    }

    // ===== REMOVE MEMBER =====

    const { error } = await admin
      .from('lab_members')
      .delete()
      .eq('lab_id', labId)
      .eq('user_id', targetUserId);

    if (error) {
      console.error('Remove member error:', error);
      throw error;
    }

    // ===== SUCCESS RESPONSE =====

    return NextResponse.json({
      success: true,
      message: 'Member removed from lab',
    });
  } catch (error: any) {
    console.error('Remove member error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to remove member' },
      { status: 500 }
    );
  }
}
