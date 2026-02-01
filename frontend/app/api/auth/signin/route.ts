import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Server-side sign-in. Sets auth cookies and returns user/session.
 */
export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(email).trim(),
      password: String(password),
    });

    if (error) {
      const msg = String(error.message ?? '');
      if (msg.includes('521') || msg.includes('Web server is down') || msg.includes('<!DOCTYPE') || msg.includes('fetch')) {
        return NextResponse.json(
          { error: 'We couldn’t reach the server. Please check your connection and try again.' },
          { status: 503 }
        );
      }
      if (error.message.includes('Invalid login credentials')) {
        return NextResponse.json(
          { error: 'Invalid email or password' },
          { status: 401 }
        );
      }
      if (error.message.includes('Email not confirmed')) {
        return NextResponse.json(
          { error: 'Please verify your email before signing in' },
          { status: 401 }
        );
      }
      return NextResponse.json(
        { error: error.message },
        { status: 401 }
      );
    }

    if (!data.user) {
      return NextResponse.json(
        { error: 'Authentication failed' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      user: { id: data.user.id, email: data.user.email },
      session: { access_token: data.session?.access_token },
    });
  } catch (error) {
    console.error('Sign-in error:', error);
    return NextResponse.json(
      { error: 'We couldn’t reach the server. Please check your connection and try again.' },
      { status: 503 }
    );
  }
}
