import { NextRequest, NextResponse } from 'next/server';
import { sendTestEmail } from '@/lib/email/service';

/**
 * Test endpoint to send a test email
 * Usage: POST /api/notifications/test with { "email": "your@email.com" }
 */
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    const result = await sendTestEmail(email);

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
