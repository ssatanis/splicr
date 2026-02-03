/**
 * Send emails via Resend using the SplicR template.
 * Set RESEND_API_KEY and RESEND_FROM in .env.local or Vercel env.
 * To send to collaborators (not just yourself), use a verified domain in Resend and set:
 *   RESEND_FROM=SplicR <notifications@splicr.org>
 * With onboarding@resend.dev, Resend only delivers to your Resend account email.
 */

import {
  shareInviteEmailContent,
  confirmEmailContent,
  resetPasswordEmailContent,
} from './splicr-template';
import { getResendClient, getFromAddress, getResendError } from './resend-client';

function getResendConfigError(): string | null {
  const key = process.env.RESEND_API_KEY;
  if (!key || typeof key !== 'string') {
    return 'RESEND_API_KEY is not set. Add it in frontend/.env.local (local) or Vercel → Project Settings → Environment Variables. Get a key from https://resend.com/api-keys';
  }
  if (!key.startsWith('re_')) {
    return 'RESEND_API_KEY must start with re_. Get a valid key from https://resend.com/api-keys';
  }
  const initError = getResendError();
  if (initError) {
    return `Resend initialization failed: ${initError}`;
  }
  return null;
}

/**
 * Send share-invite email to a collaborator. Uses SplicR-branded, personalized template.
 * Returns success and error so the API can surface "email not sent" to the user.
 */
export async function sendShareInviteEmail(options: {
  to: string;
  inviterNameOrEmail: string;
  inviterDisplayName?: string | null;
  analysisName: string;
  permission: string;
  resultsUrl: string;
  recipientDisplayName?: string | null;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  const configError = getResendConfigError();
  if (configError) {
    return { success: false, error: configError };
  }
  const resend = getResendClient();
  if (!resend) {
    return { success: false, error: 'Resend not configured.' };
  }

  const fromAddress = getFromAddress();
  const { subject, html } = shareInviteEmailContent({
    inviterNameOrEmail: options.inviterNameOrEmail,
    inviterDisplayName: options.inviterDisplayName,
    analysisName: options.analysisName,
    permission: options.permission,
    resultsUrl: options.resultsUrl,
    recipientEmail: options.to,
    recipientDisplayName: options.recipientDisplayName,
  });

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: [options.to],
      subject,
      html,
    });
    if (error) {
      console.error('Resend share invite error:', error);
      return { success: false, error: error.message };
    }
    if (data?.id) {
      console.info('Share invite email sent:', { id: data.id, to: options.to });
    }
    return { success: true, id: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send email';
    console.error('Resend share invite exception:', err);
    return { success: false, error: message };
  }
}

/**
 * Send confirmation email (e.g. for custom auth flow).
 * For Supabase auth confirmation, configure Resend as SMTP in Supabase Dashboard and use the HTML from getConfirmEmailHtml.
 */
export async function sendConfirmEmail(options: {
  to: string;
  confirmUrl: string;
}): Promise<{ success: boolean; error?: string }> {
  const resend = getResendClient();
  if (!resend) return { success: false, error: 'Resend not configured' };
  const { subject, html } = confirmEmailContent({ confirmUrl: options.confirmUrl });
  const { error } = await resend.emails.send({
    from: getFromAddress(),
    to: [options.to],
    subject,
    html,
  });
  if (error) {
    console.error('Resend confirm email error:', error);
    return { success: false, error: error.message };
  }
  return { success: true };
}

/**
 * Send password reset email (e.g. for custom auth flow).
 * For Supabase password reset, configure Resend as SMTP and use the HTML from getResetPasswordEmailHtml.
 */
export async function sendResetPasswordEmail(options: {
  to: string;
  resetUrl: string;
}): Promise<{ success: boolean; error?: string }> {
  const resend = getResendClient();
  if (!resend) return { success: false, error: 'Resend not configured' };
  const { subject, html } = resetPasswordEmailContent({ resetUrl: options.resetUrl });
  const { error } = await resend.emails.send({
    from: getFromAddress(),
    to: [options.to],
    subject,
    html,
  });
  if (error) {
    console.error('Resend reset password error:', error);
    return { success: false, error: error.message };
  }
  return { success: true };
}

/** Export template HTML for use in Supabase Email Templates (paste into custom HTML) */
export {
  confirmEmailContent,
  resetPasswordEmailContent,
  splicrEmailLayout,
} from './splicr-template';
