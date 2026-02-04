import { NextRequest, NextResponse } from 'next/server';
import { getApiUser, supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/labs/[id]/analyses
 * Get all analyses created by lab members (requires lab membership)
 *
 * Returns:
 * - analyses: Array of analysis objects with owner info
 *   Each analysis includes:
 *   - isOwner: boolean (true if current user is owner)
 *   - ownerEmail: string (owner's email)
 *   - ownerName: string (owner's display name or full name)
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

    const { data: membership } = await admin
      .from('lab_members')
      .select('role')
      .eq('lab_id', labId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json(
        { error: 'Access denied. You are not a member of this lab.' },
        { status: 403 }
      );
    }

    // ===== GET ALL LAB MEMBER USER IDS =====

    const { data: members, error: membersError } = await admin
      .from('lab_members')
      .select('user_id')
      .eq('lab_id', labId);

    if (membersError) {
      console.error('Get lab members error:', membersError);
      throw membersError;
    }

    if (!members || members.length === 0) {
      return NextResponse.json({ analyses: [] });
    }

    const memberIds = members.map((m: any) => m.user_id);

    // ===== GET ANALYSES CREATED BY ANY LAB MEMBER =====
    // Join with profiles to get owner info in one query (avoid N+1)

    const { data: analyses, error: analysesError } = await admin
      .from('analyses')
      .select(`
        *,
        profiles!inner(email, full_name, display_name)
      `)
      .in('user_id', memberIds)
      .order('created_at', { ascending: false })
      .limit(100); // Limit to recent 100 analyses (can add pagination later)

    if (analysesError) {
      console.error('Get lab analyses error:', analysesError);
      throw analysesError;
    }

    // ===== ENRICH WITH OWNER INFO AND OWNERSHIP FLAG =====

    const enrichedAnalyses = (analyses || []).map((a: any) => ({
      ...a,
      isOwner: a.user_id === user.id,
      ownerEmail: a.profiles?.email,
      ownerName: a.profiles?.display_name || a.profiles?.full_name || 'Unknown',
      profiles: undefined, // Remove nested profiles object
    }));

    return NextResponse.json({ analyses: enrichedAnalyses });
  } catch (error: any) {
    console.error('Get lab analyses error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get lab analyses' },
      { status: 500 }
    );
  }
}
