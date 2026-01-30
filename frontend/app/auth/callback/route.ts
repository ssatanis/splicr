import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = requestUrl.searchParams.get('next') ?? '/app/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Redirect to the intended destination after successful auth
      return NextResponse.redirect(new URL(next, request.url))
    }
  }

  // Auth code exchange failed, redirect to sign-in with error
  return NextResponse.redirect(
    new URL('/auth/sign-in?error=auth_callback_error', request.url)
  )
}
