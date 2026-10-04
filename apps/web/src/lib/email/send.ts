import { Resend } from "resend";

import { site } from "@/lib/site";

import { confirmationEmail, notificationEmail, type DemoRequest } from "./templates";

/**
 * Delivery for the demo request flow.
 *
 * The messages carry no images or attachments, so there is nothing to block or
 * to fail to load.
 */

const FROM_NAME = site.name;
const DEFAULT_FROM = `team@${new URL(site.url).hostname.replace(/^www\./, "")}`;

export const from = () => {
  const address = process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM;
  return `${FROM_NAME} <${address}>`;
};

export const teamInbox = () => process.env.DEMO_REQUEST_INBOX?.trim() || site.email;

export class EmailNotConfigured extends Error {
  constructor() {
    super("RESEND_API_KEY is not set");
    this.name = "EmailNotConfigured";
  }
}

/**
 * True when this deployment can send its own mail.
 *
 * Callers that have a second delivery route check this *before* doing anything
 * irreversible, rather than discovering the missing key from a thrown error
 * half way through. `@/lib/auth/invitations` chooses its whole strategy on it.
 */
export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY?.trim());

export function resendClient() {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new EmailNotConfigured();
  return new Resend(key);
}

export type SendOutcome = {
  confirmationId: string | null;
  notificationId: string | null;
  errors: string[];
};

/**
 * Sends the confirmation to the requester and the notification to the team.
 *
 * The two sends are independent on purpose. A bounced confirmation must not stop
 * the team hearing about a lead, and a failed internal notification must not make
 * the requester think nothing happened.
 */
export async function sendDemoRequest(request: DemoRequest): Promise<SendOutcome> {
  const resend = resendClient();
  const sender = from();
  const errors: string[] = [];

  const confirmation = confirmationEmail(request);
  const notification = notificationEmail(request);

  const [confirmationResult, notificationResult] = await Promise.allSettled([
    resend.emails.send({
      from: sender,
      to: [request.email],
      replyTo: teamInbox(),
      subject: confirmation.subject,
      html: confirmation.html,
      text: confirmation.text,
    }),
    resend.emails.send({
      from: sender,
      to: [teamInbox()],
      replyTo: request.email,
      subject: notification.subject,
      html: notification.html,
      text: notification.text,
    }),
  ]);

  const read = (
    result: PromiseSettledResult<{ data: { id: string } | null; error: unknown }>,
    label: string,
  ) => {
    if (result.status === "rejected") {
      errors.push(`${label}: ${String(result.reason)}`);
      return null;
    }
    const { data, error } = result.value;
    if (error) {
      const message =
        typeof error === "object" && error && "message" in error
          ? String((error as { message: unknown }).message)
          : JSON.stringify(error);
      errors.push(`${label}: ${message}`);
      return null;
    }
    return data?.id ?? null;
  };

  return {
    confirmationId: read(confirmationResult, "confirmation"),
    notificationId: read(notificationResult, "notification"),
    errors,
  };
}

export { confirmationEmail, notificationEmail, type DemoRequest };
