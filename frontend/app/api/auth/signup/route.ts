import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Server-side sign-up endpoint to bypass CORS issues
 * This handles user registration on the server
 */
export async function POST(request: Request) {
  try {
    const { email, password, fullName, institution } = await request.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    if (!institution?.trim()) {
      return NextResponse.json(
        { error: 'Institution is required' },
        { status: 400 }
      )
    }

    // Create server-side Supabase client
    const supabase = await createClient()

    // Sign up with email and password
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          institution: institution.trim(),
        },
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/callback`,
      },
    })

    if (error) {
      console.error('Sign-up error:', error)

      // Return user-friendly error messages
      const message = error.message.toLowerCase()
      if (message.includes('already registered') || message.includes('already exists')) {
        return NextResponse.json(
          { error: 'An account with this email already exists' },
          { status: 400 }
        )
      } else if (message.includes('signup_disabled')) {
        return NextResponse.json(
          { error: 'New sign-ups are currently disabled' },
          { status: 400 }
        )
      }

      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    if (!data.user) {
      return NextResponse.json(
        { error: 'Failed to create account' },
        { status: 400 }
      )
    }

    // Check if email confirmation is required
    if (data.user.identities?.length === 0) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 400 }
      )
    }

    // Save profile to database
    await (supabase.from('profiles') as any).upsert(
      {
        id: data.user.id,
        email: data.user.email ?? email,
        full_name: fullName?.trim() || null,
        institution: institution.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )

    // Return success
    return NextResponse.json({
      user: {
        id: data.user.id,
        email: data.user.email,
      },
      requiresEmailConfirmation: data.user.email_confirmed_at === null,
    })
  } catch (error) {
    console.error('Server error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
