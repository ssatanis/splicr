import { AnalysisCompleteEmail } from './templates/analysis-complete';
import { AnalysisCompleteEmailProps } from './types';
import { getResendClient, getFromAddress } from './resend-client';

/**
 * Send analysis completion email to user
 */
export async function sendAnalysisCompleteEmail(
  props: AnalysisCompleteEmailProps
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  try {
    // Validate email
    if (!props.userEmail || !props.userEmail.includes('@')) {
      throw new Error('Invalid email address');
    }

    // Validate API key
    if (!process.env.RESEND_API_KEY) {
      console.error('❌ RESEND_API_KEY not configured');
      throw new Error('Email service not configured');
    }

    const resendClient = getResendClient();
    if (!resendClient) {
      console.warn('⚠️ Email service not configured, skipping email');
      throw new Error('Email service not configured');
    }

    console.log(`📧 Sending analysis complete email to ${props.userEmail}...`);

    const { data, error } = await resendClient.emails.send({
      from: getFromAddress(),
      to: [props.userEmail],
      subject: `Your Analysis "${props.screenName}" is Complete`,
      react: AnalysisCompleteEmail(props),
      // Optional: Add tags for tracking
      tags: [
        { name: 'category', value: 'analysis-complete' },
        { name: 'screen', value: props.screenName },
      ],
    });

    if (error) {
      console.error('❌ Email send failed:', error);
      return { success: false, error: error.message };
    }

    console.log('✅ Email sent successfully:', data?.id);
    return { success: true, messageId: data?.id };
  } catch (error: any) {
    console.error('❌ Email service error:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Send test email (for testing the email template)
 */
export async function sendTestEmail(toEmail: string) {
  return sendAnalysisCompleteEmail({
    userName: 'Test User',
    userEmail: toEmail,
    screenName: 'Test Screen - Drug Resistance',
    completedAt: new Date().toLocaleString(),
    duration: '15m 32s',
    significantHits: 127,
    topGene: 'BRCA1',
    enrichmentScore: 3.45,
    resultsUrl: 'https://splicr.io/analysis/test-123',
  });
}
