import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getApiUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest) {
    try {
        const { user, error } = await getApiUser();
        if (error || !user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        // Safety check: ensure we have admin client
        if (!supabaseAdmin) {
            console.error('Missing Supabase Admin client');
            return NextResponse.json({ message: 'Server configuration error' }, { status: 500 });
        }

        // 1. Delete user's analysis data
        // (Cascade delete on user_id should handle this if configured in DB, but explicit delete is safer)
        const { error: deleteAnalysesError } = await supabaseAdmin
            .from('analyses')
            .delete()
            .eq('user_id', user.id);

        if (deleteAnalysesError) {
            console.error('Failed to delete user analyses:', deleteAnalysesError);
            return NextResponse.json({ message: 'Failed to clean up user data' }, { status: 500 });
        }

        // 2. Delete user account from Auth (requires Service Role)
        const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(user.id);

        if (deleteUserError) {
            console.error('Failed to delete user account:', deleteUserError);
            return NextResponse.json({ message: 'Failed to delete account' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Delete account error:', error);
        return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
    }
}
