import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Server-side sign-up. Creates user and sets auth cookies.
 */
export async function POST(request: Request) {
  try {
    const { email, password, fullName, institution, lab_invite_code } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    if (!institution?.trim()) {
      return NextResponse.json(
        { error: 'Institution is required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const { data, error } = await supabase.auth.signUp({
      email: String(email).trim(),
      password: String(password),
      options: {
        data: {
          full_name: fullName,
          institution: institution.trim(),
        },
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/callback`,
      },
    });

    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes('already registered') || message.includes('already exists')) {
        return NextResponse.json(
          { error: 'An account with this email already exists' },
          { status: 400 }
        );
      }
      if (message.includes('signup_disabled')) {
        return NextResponse.json(
          { error: 'New sign-ups are currently disabled' },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    if (!data.user) {
      return NextResponse.json(
        { error: 'Failed to create account' },
        { status: 400 }
      );
    }

    if (data.user.identities?.length === 0) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 400 }
      );
    }

    await (supabase.from('profiles') as any).upsert(
      {
        id: data.user.id,
        email: data.user.email ?? email,
        full_name: fullName?.trim() || null,
        institution: institution.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

    // ===== JOIN LAB IF INVITE CODE PROVIDED =====
    let labInfo = null;
    if (lab_invite_code?.trim()) {
      const code = lab_invite_code.trim().toUpperCase();

      // Validate and find lab by invite code
      const { data: lab } = await (supabase.from('labs') as any)
        .select('id, name, institution')
        .eq('invite_code', code)
        .maybeSingle();

      if (lab) {
        // Join lab as member
        const joinResult = await (supabase.from('lab_members') as any).insert({
          lab_id: lab.id,
          user_id: data.user.id,
          role: 'member',
          joined_at: new Date().toISOString(),
        });

        // If join successful, include lab info in response
        if (!joinResult.error) {
          labInfo = { id: lab.id, name: lab.name };
        }
      }
      // Note: We don't error out if lab code is invalid during sign-up
      // This ensures the user account is still created even if code is wrong
    }

    // Email verification is disabled - users can sign in immediately
    return NextResponse.json({
      user: { id: data.user.id, email: data.user.email },
      lab: labInfo, // Include lab info if joined
      requiresEmailConfirmation: false, // Always false - email verification disabled
    });
  } catch (error) {
    console.error('Sign-up error:', error);
    return NextResponse.json(
      { error: 'We couldn’t reach the server. Please check your connection and try again.' },
      { status: 503 }
    );
  }
}
