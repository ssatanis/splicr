import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Server-side sign-up. Creates user and sets auth cookies.
 */
export async function POST(request: Request) {
  try {
    const { email, password, fullName, institution } = await request.json();

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

    // Email verification is disabled - users can sign in immediately
    return NextResponse.json({
      user: { id: data.user.id, email: data.user.email },
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
