import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { sendResetPasswordEmail } from '@/lib/email/send';

const RESET_REDIRECT_PATH = '/auth/reset-password';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body?.email === 'string' ? body.email.trim() : '';

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (typeof request.nextUrl?.origin === 'string' ? request.nextUrl.origin : '');
    const redirectTo = baseUrl ? `${baseUrl}${RESET_REDIRECT_PATH}` : undefined;

    const { data, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: redirectTo ? { redirectTo } : undefined,
    });

    if (linkError) {
      console.error('Forgot password generateLink error:', linkError);
      return NextResponse.json({ success: true });
    }

    const actionLink = data?.properties?.action_link;
    if (!actionLink || typeof actionLink !== 'string') {
      console.error('Forgot password: no action_link in generateLink response');
      return NextResponse.json({ success: true });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') || '';
    const resetUrl =
      actionLink.startsWith('http')
        ? actionLink
        : supabaseUrl
          ? `${supabaseUrl}/${actionLink}`
          : actionLink;

    const { success, error: sendError } = await sendResetPasswordEmail({
      to: email,
      resetUrl,
    });

    if (!success) {
      console.error('Forgot password send email error:', sendError);
      return NextResponse.json(
        { error: sendError || 'Failed to send reset email' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Forgot password API error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
