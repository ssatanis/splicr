import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { getResendClient, getFromAddress } from '@/lib/email/resend-client';

/**
 * POST /api/access-request
 * Body: { pi_email: string, message?: string, resource_type?: string }
 * Creates an in-app notification for the PI and optionally sends an email.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const pi_email = (body.pi_email || body.piEmail || '').trim().toLowerCase();
    const message = (body.message || '').trim() || 'I would like to request access to your team or shared resources.';
    const resource_type = body.resource_type || body.resourceType || 'team';

    if (!pi_email || !pi_email.includes('@')) {
      return NextResponse.json({ error: 'Valid PI email is required' }, { status: 400 });
    }

    const requesterName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'A researcher';

    const { data: piProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', pi_email)
      .limit(1)
      .maybeSingle();

    const piUserId = (piProfile as any)?.id ?? null;

    if (piUserId) {
      const { error: notifError } = await (supabaseAdmin.from('notifications') as any).insert({
        user_id: piUserId,
        type: 'access_request',
        title: 'Access request',
        message: `${requesterName} (${user.email}) requested access: ${message}`,
        metadata: {
          requester_id: user.id,
          requester_email: user.email,
          requester_name: requesterName,
          resource_type,
          message,
        },
        read: false,
      });

      if (notifError) {
        console.error('Access request notification insert error:', notifError);
      }
    }

    const resendClient = getResendClient();
    if (resendClient && process.env.RESEND_API_KEY) {
      await resendClient.emails.send({
        from: getFromAddress(),
        to: [pi_email],
        subject: `SplicR: Access request from ${requesterName}`,
        html: `
          <p>${requesterName} (${user.email}) has requested access via SplicR.</p>
          <p><strong>Message:</strong> ${message}</p>
          <p>You can manage access in SplicR under Settings → Collaboration.</p>
        `,
      });
    }

    return NextResponse.json({
      success: true,
      notification_sent: !!piUserId,
      email_sent: !!resendClient,
    });
  } catch (e: any) {
    console.error('Access request error:', e);
    return NextResponse.json(
      { error: e.message || 'Failed to send access request' },
      { status: 500 }
    );
  }
}
