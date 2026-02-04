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

    // Validate environment configuration
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.error('❌ Missing Supabase environment variables');
      return NextResponse.json(
        { error: 'Server configuration error. Please contact support.' },
        { status: 500 }
      );
    }

    const supabase = await createClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(email).trim(),
      password: String(password),
    });

    if (error) {
      const msg = String(error.message ?? '');

      // Check for API key errors
      if (msg.toLowerCase().includes('api key') || msg.toLowerCase().includes('invalid key')) {
        console.error('❌ SUPABASE API KEY ERROR:', msg);
        console.error('→ Check your .env.local file and run: npm run validate-env');
        return NextResponse.json(
          { error: 'Server configuration error. Please check server logs.' },
          { status: 500 }
        );
      }

      if (msg.includes('521') || msg.includes('Web server is down') || msg.includes('<!DOCTYPE') || msg.includes('fetch')) {
        return NextResponse.json(
          { error: 'We could not reach the server. Please check your connection and try again.' },
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

      // Log unexpected errors for debugging
      console.error('Sign-in error:', error.message);

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
      { error: 'We could not reach the server. Please check your connection and try again.' },
      { status: 503 }
    );
  }
}
