import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = requestUrl.searchParams.get('next') ?? '/app/dashboard'

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      const meta = data.user.user_metadata || {}
      await (supabase.from('profiles') as any).upsert(
        {
          id: data.user.id,
          email: data.user.email ?? '',
          full_name: (meta.full_name as string) || null,
          institution: (meta.institution as string)?.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )
      return NextResponse.redirect(new URL(next, request.url))
    }
  }

  // Auth code exchange failed, redirect to sign-in with error
  return NextResponse.redirect(
    new URL('/auth/sign-in?error=auth_callback_error', request.url)
  )
}
