/**
 * Email Notification System - Easy Integration
 * 
 * This module provides simple helper functions to integrate
 * email notifications into your analysis workflow.
 * 
 * NOTE: This is separate from the existing share invite email system (send.ts)
 * - send.ts: Share invites, auth emails (existing)
 * - service.ts: Analysis completion emails (new)
 */

// Analysis completion emails (new system)
export { sendAnalysisCompleteEmail, sendTestEmail } from './service';
export type { AnalysisCompleteEmailProps } from './types';

// Keep existing share invite system exports
export { sendShareInviteEmail, sendConfirmEmail, sendResetPasswordEmail } from './send';

/**
 * Helper function to trigger completion email from client-side
 * Use this when an analysis completes
 */
export async function notifyAnalysisComplete(
  analysisId: string,
  userId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch('/api/notifications/send-completion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysisId, userId }),
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.error || 'Failed to send email' };
    }

    const result = await response.json();
    return { success: true };
  } catch (error: any) {
    console.error('Failed to send completion notification:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Helper function to send test email from client-side
 * Use this for testing the email system
 */
export async function sendTestNotification(
  email: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch('/api/notifications/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.error || 'Failed to send test email' };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Failed to send test notification:', error);
    return { success: false, error: error.message };
  }
}
