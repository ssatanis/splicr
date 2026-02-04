import { NextRequest, NextResponse } from 'next/server';
import { getApiUser, supabaseAdmin } from '@/lib/supabase/server';
import type { LabMember } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/labs/[id]/members
 * Get all members of a lab (requires lab membership)
 *
 * Returns:
 * - members: LabMember[] with joined profile data
 */
export async function GET(
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

    // ===== VERIFY USER IS MEMBER OF THIS LAB =====

    const { data: userMembership } = await admin
      .from('lab_members')
      .select('role')
      .eq('lab_id', labId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!userMembership) {
      return NextResponse.json(
        { error: 'Access denied. You are not a member of this lab.' },
        { status: 403 }
      );
    }

    // ===== GET ALL LAB MEMBERS WITH PROFILE DATA =====
    // Join with profiles table to get user details in one query (avoid N+1)

    const { data: members, error } = await admin
      .from('lab_members')
      .select(`
        *,
        profiles!inner(email, full_name, display_name, avatar_url)
      `)
      .eq('lab_id', labId)
      .order('joined_at', { ascending: false });

    if (error) {
      console.error('Get lab members error:', error);
      throw error;
    }

    // ===== FLATTEN PROFILE DATA INTO MEMBER OBJECTS =====
    // Transform nested profiles object into flat structure

    const enrichedMembers: LabMember[] = (members || []).map((m: any) => ({
      id: m.id,
      lab_id: m.lab_id,
      user_id: m.user_id,
      role: m.role,
      title: m.title,
      joined_at: m.joined_at,
      guest_expires_at: m.guest_expires_at,
      last_active_at: m.last_active_at,
      // Flattened profile data
      email: m.profiles?.email,
      full_name: m.profiles?.full_name,
      display_name: m.profiles?.display_name,
      avatar_url: m.profiles?.avatar_url,
    }));

    return NextResponse.json({ members: enrichedMembers });
  } catch (error: any) {
    console.error('Get lab members error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get lab members' },
      { status: 500 }
    );
  }
}
