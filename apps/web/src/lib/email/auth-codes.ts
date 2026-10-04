import "server-only";

import { site } from "@/lib/site";

import { authEmail, type AuthEmailKey } from "./auth-templates";
import { from, resendClient } from "./send";

/**
 * One-time codes, delivered by SplicR rather than by the authentication service.
 *
 * Supabase Auth will mail an invitation or a sign-in code itself, but only
 * through the SMTP sender configured on the project, and only inside its own
 * per-hour email allowance. When that send fails there is nothing to inspect
 * from here: the admin API answers with a single opaque error, no message is
 * queued anywhere, and the invited researcher is simply never written to.
 * That is what a lab administrator sees as "delivery failed".
 *
 * So the product mints the code with `auth.admin.generateLink()`, which returns
 * the six digits and sends nothing, and posts the message itself. The body is
 * the same template Supabase would have rendered — one source, in
 * `./auth-templates` — with the Go variables substituted here instead of there.
 *
 * Two things improve by owning the send:
 *
 *  - A failure has a reason. Resend answers with a message id or with a
 *    sentence, and that sentence is what the members page shows and what
 *    `org_invites.delivery_error` keeps.
 *  - The message carries a text/plain alternative. Supabase Auth has no field
 *    for one, which `supabase/templates/README.md` records as a known gap; a
 *    message sent from here is multipart and readable in a client that refuses
 *    HTML.
 *
 * Nothing in these messages is a token-bearing link, here as in the templates:
 * a code is typed into a first-party SplicR screen, so a mail scanner that
 * follows every URL it is sent cannot consume an invitation.
 */

const TOKEN_VAR = "{{ .Token }}";
const EMAIL_VAR = "{{ .Email }}";
const NEW_EMAIL_VAR = "{{ .NewEmail }}";
const ORG_VAR = "{{ .Data.organization_name }}";

/** Values the authentication service would have substituted for us. */
export interface AuthCodeValues {
  /** The six-digit one-time code. */
  token: string;
  /** The address the code was issued to. */
  email: string;
  /** The laboratory an invitation names. Required by the invite template. */
  orgName?: string;
  /** Only for an email change, where the template names both addresses. */
  newEmail?: string;
}

export interface AuthCodeMessage {
  subject: string;
  html: string;
  text: string;
}

/** The substituted values land in text nodes, never in an attribute. */
const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const verifyLine = (flow: string) =>
  `Open ${new URL(site.url).hostname}/verify?flow=${flow} and enter the code above.`;

/**
 * The text/plain alternative.
 *
 * It says the same things in the same order as the HTML: what the message is,
 * the code, where to type it, and what to do if it was not expected. A reader
 * who sees only this must not be worse informed than one who sees the card.
 */
function plainText(key: AuthEmailKey, values: AuthCodeValues): string {
  const lines = (...parts: string[]) => parts.join("\n");
  const sign = lines(
    "",
    "If you were not expecting this message you can ignore it. Nobody can use the code without this email.",
    "",
    site.name,
    site.location,
    new URL(site.url).hostname,
  );

  switch (key) {
    case "invite":
      return lines(
        `Your ${site.name} access is ready.`,
        "",
        `You have been invited to create a ${site.name} researcher account for ${values.orgName ?? site.name}. Use the one-time code below to verify ${values.email}, choose a password and complete your laboratory profile.`,
        "",
        values.token,
        "",
        verifyLine("invite"),
        "",
        `Access to ${site.name} is invitation only, and this code can be accepted once.`,
        sign,
      );
    case "magic_link":
      return lines(
        `Sign in to ${site.name}.`,
        "",
        "Enter this one-time code in the SplicR Portal. The code works once.",
        "",
        values.token,
        "",
        verifyLine("magiclink"),
        sign,
      );
    case "confirm_signup":
      return lines(
        "Confirm your email address.",
        "",
        `Confirm ${values.email} to continue setting up your ${site.name} account. The code works once.`,
        "",
        values.token,
        "",
        verifyLine("signup"),
        sign,
      );
    case "reset_password":
      return lines(
        "Reset your password.",
        "",
        `Enter the code below to choose a new password for ${values.email}. The code works once.`,
        "",
        values.token,
        "",
        verifyLine("recovery"),
        sign,
      );
    case "change_email":
      return lines(
        "Confirm your new email address.",
        "",
        `A request was made to change the address on your ${site.name} account from ${values.email} to ${values.newEmail ?? ""}. The change takes effect only after it is confirmed.`,
        "",
        values.token,
        "",
        verifyLine("email_change"),
        sign,
      );
    case "reauthentication":
      return lines(
        "Verify your identity.",
        "",
        `Enter this verification code in ${site.name} to continue with the account action you requested. It can be used once.`,
        "",
        values.token,
        "",
        "Do not share this code with anyone.",
        sign,
      );
  }
}

/**
 * The finished message for one template, with the code and the address in it.
 *
 * Throws rather than delivering a message that still says `{{ .Token }}`: a
 * researcher who is sent the literal template has been told nothing, and a
 * silent substitution miss would otherwise reach an inbox.
 */
export function renderAuthCode(key: AuthEmailKey, values: AuthCodeValues): AuthCodeMessage {
  const template = authEmail(key);
  const html = template.html
    .split(TOKEN_VAR)
    .join(esc(values.token))
    .split(EMAIL_VAR)
    .join(esc(values.email))
    .split(NEW_EMAIL_VAR)
    .join(esc(values.newEmail ?? values.email))
    .split(ORG_VAR)
    .join(esc(values.orgName ?? site.name));

  if (html.includes("{{")) {
    throw new Error(`[email/auth-codes] ${key} still holds an unsubstituted template variable`);
  }

  return { subject: template.subject, html, text: plainText(key, values) };
}

export interface AuthCodeDelivery {
  /** The provider's message id, which is what proves the send happened. */
  id: string | null;
  /** A sentence to show and to store, or null when the message went out. */
  error: string | null;
}

/** Whatever the provider said, as one line short enough to store and show. */
function reason(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return typeof error === "string" ? error : JSON.stringify(error);
}

/**
 * Post a one-time code to one address.
 *
 * Resolves either way: a caller in a Server Action needs an outcome it can put
 * on the screen, not an exception to translate. The deployment is expected to
 * have `RESEND_API_KEY`; without it this reports that rather than throwing,
 * and the invitation path falls back to asking Supabase to send.
 */
export async function sendAuthCode(input: {
  to: string;
  key: AuthEmailKey;
  values: AuthCodeValues;
  /** Overrides the subject, for a message that names the laboratory. */
  subject?: string;
}): Promise<AuthCodeDelivery> {
  let message: AuthCodeMessage;
  try {
    message = renderAuthCode(input.key, input.values);
  } catch (error) {
    console.error(`[email/auth-codes] render: ${reason(error)}`);
    return { id: null, error: "The invitation message could not be prepared." };
  }

  try {
    const { data, error } = await resendClient().emails.send({
      from: from(),
      to: [input.to],
      replyTo: site.email,
      subject: input.subject ?? message.subject,
      html: message.html,
      text: message.text,
      // An account code is not a mailing. Asking for no tracking keeps the
      // message free of a rewritten URL and a pixel, and keeps it out of the
      // bucket that scanners treat as marketing.
      headers: { "X-Entity-Ref-ID": `${input.key}:${input.to}:${Date.now()}` },
    });
    if (error) {
      console.error(`[email/auth-codes] send ${input.key}: ${reason(error)}`);
      return { id: null, error: reason(error) };
    }
    return { id: data?.id ?? null, error: null };
  } catch (error) {
    console.error(`[email/auth-codes] send ${input.key} threw: ${reason(error)}`);
    return { id: null, error: reason(error) };
  }
}
