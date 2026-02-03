/**
 * Centralized Resend client initialization with proper error handling
 * This prevents "Invalid API key" errors from crashing the app
 */

import { Resend } from 'resend';

let resendClient: Resend | null = null;
let initializationError: string | null = null;

/**
 * Get or create Resend client instance
 * Returns null if API key is invalid or not configured
 */
export function getResendClient(): Resend | null {
  // Return cached client if already initialized
  if (resendClient) {
    return resendClient;
  }

  // Return null if previous initialization failed
  if (initializationError) {
    return null;
  }

  try {
    const key = process.env.RESEND_API_KEY;

    // Validate API key format
    if (!key || typeof key !== 'string') {
      initializationError = 'RESEND_API_KEY not set';
      console.warn('⚠️ Email service disabled: RESEND_API_KEY not configured');
      return null;
    }

    if (!key.startsWith('re_')) {
      initializationError = 'Invalid RESEND_API_KEY format (must start with re_)';
      console.warn('⚠️ Email service disabled: Invalid RESEND_API_KEY format');
      return null;
    }

    // Initialize Resend client
    resendClient = new Resend(key);
    console.log('✅ Resend email service initialized');
    return resendClient;

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    initializationError = message;
    console.error('❌ Failed to initialize Resend client:', message);
    return null;
  }
}

/**
 * Check if Resend is configured and ready to use
 */
export function isResendConfigured(): boolean {
  return getResendClient() !== null;
}

/**
 * Get initialization error message if any
 */
export function getResendError(): string | null {
  return initializationError;
}

/**
 * Get from address for emails
 */
export function getFromAddress(): string {
  return process.env.RESEND_FROM || 'SplicR <notifications@splicr.org>';
}
