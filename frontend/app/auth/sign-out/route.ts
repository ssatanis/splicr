import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()

  const requestUrl = new URL(request.url)
  return NextResponse.redirect(new URL('/auth/sign-in', requestUrl.origin))
}

// Also support GET for simple link-based logout
export async function GET(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()

  const requestUrl = new URL(request.url)
  return NextResponse.redirect(new URL('/auth/sign-in', requestUrl.origin))
}
