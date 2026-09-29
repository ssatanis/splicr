import { readFile } from "node:fs/promises";
import path from "node:path";

import { Resend } from "resend";

import { site } from "@/lib/site";

import { LOGO_CID, confirmationEmail, notificationEmail, type DemoRequest } from "./templates";

/**
 * Delivery for the demo request flow.
 *
 * The logo travels as an inline attachment rather than a hotlinked image, so it
 * renders in clients that block remote content by default and does not depend on
 * the marketing site being reachable.
 *
 * Note on the sender avatar: the round picture a client shows next to a message
 * comes from that client's own directory or from a BIMI record, not from
 * anything inside the message. Shipping the mark inline puts it at the top of
 * the email, which is the part we control.
 */

const FROM_NAME = site.name;
const DEFAULT_FROM = `team@${new URL(site.url).hostname.replace(/^www\./, "")}`;

export const from = () => {
  const address = process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM;
  return `${FROM_NAME} <${address}>`;
};

export const teamInbox = () => process.env.DEMO_REQUEST_INBOX?.trim() || site.email;

let cachedLogo: string | null = null;

async function logoAttachment() {
  if (cachedLogo === null) {
    const file = path.join(process.cwd(), "src", "lib", "email", "assets", "splicr-logo.png");
    cachedLogo = (await readFile(file)).toString("base64");
  }
  return {
    filename: "splicr.png",
    content: cachedLogo,
    content_id: LOGO_CID,
    content_type: "image/png",
    disposition: "inline" as const,
  };
}

export class EmailNotConfigured extends Error {
  constructor() {
    super("RESEND_API_KEY is not set");
    this.name = "EmailNotConfigured";
  }
}

function client() {
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
  const resend = client();
  const attachments = [await logoAttachment()];
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
      attachments,
    }),
    resend.emails.send({
      from: sender,
      to: [teamInbox()],
      replyTo: request.email,
      subject: notification.subject,
      html: notification.html,
      text: notification.text,
      attachments,
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
