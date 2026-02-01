/**
 * Send emails via Resend using the SplicR template.
 * Set RESEND_API_KEY and RESEND_FROM (e.g. SplicR <notifications@yourdomain.com>) in .env.local.
 */

import { Resend } from 'resend';
import {
  shareInviteEmailContent,
  confirmEmailContent,
  resetPasswordEmailContent,
} from './splicr-template';

const resendApiKey = process.env.RESEND_API_KEY;
const fromAddress = process.env.RESEND_FROM || 'SplicR <onboarding@resend.dev>';

function getResend(): Resend | null {
  if (!resendApiKey?.startsWith('re_')) return null;
  return new Resend(resendApiKey);
}

/**
 * Send share-invite email to a collaborator.
 */
export async function sendShareInviteEmail(options: {
  to: string;
  inviterNameOrEmail: string;
  analysisName: string;
  permission: string;
  resultsUrl: string;
}): Promise<{ success: boolean; error?: string }> {
  const resend = getResend();
  if (!resend) {
    return { success: false, error: 'Resend not configured' };
  }
  const { subject, html } = shareInviteEmailContent({
    inviterNameOrEmail: options.inviterNameOrEmail,
    analysisName: options.analysisName,
    permission: options.permission,
    resultsUrl: options.resultsUrl,
  });
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
  return { success: true };
}

/**
 * Send confirmation email (e.g. for custom auth flow).
 * For Supabase auth confirmation, configure Resend as SMTP in Supabase Dashboard and use the HTML from getConfirmEmailHtml.
 */
export async function sendConfirmEmail(options: {
  to: string;
  confirmUrl: string;
}): Promise<{ success: boolean; error?: string }> {
  const resend = getResend();
  if (!resend) return { success: false, error: 'Resend not configured' };
  const { subject, html } = confirmEmailContent({ confirmUrl: options.confirmUrl });
  const { error } = await resend.emails.send({
    from: fromAddress,
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
  const resend = getResend();
  if (!resend) return { success: false, error: 'Resend not configured' };
  const { subject, html } = resetPasswordEmailContent({ resetUrl: options.resetUrl });
  const { error } = await resend.emails.send({
    from: fromAddress,
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
