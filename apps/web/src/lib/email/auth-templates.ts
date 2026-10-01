import { site } from "@/lib/site";

/**
 * The six Supabase Auth email templates, built from one theme.
 *
 * These are the only messages a researcher sees before they are inside the
 * console, so they are the first impression of the product. They are built here
 * rather than typed into the Supabase dashboard so that the theme is shared, the
 * copy is reviewable, and the tests can hold the whole set to one standard.
 * `npm run emails:auth` renders them to `supabase/templates/*.html`, which is
 * what gets published to Authentication, Email Templates.
 *
 * Constraints that shape every decision below:
 *
 * - Email clients are not browsers. Layout is tables, every style that matters
 *   is inline, and the one `<style>` block only holds a small-screen refinement
 *   that the message does not depend on.
 * - No images, no logo file, no web fonts, no tracking pixel, no script. There
 *   is nothing to block, nothing to fail to load, and nothing that leaks a read.
 * - The palette is the same teal, orange, peach and white system as splicr.org,
 *   with resolved hex values because older Outlook drops `rgb()` alpha colors.
 * - The body text is the message. A client that strips the `<style>` block, the
 *   border radius and the background colours still renders a correct,
 *   readable, actionable email.
 *
 * Go template variables are left untouched for the authentication service to
 * substitute: `{{ .Token }}`, `{{ .Email }}`, `{{ .NewEmail }}`.
 * Supabase Auth does not expose the configured OTP lifetime to a template, so
 * no message here states a number of hours it cannot verify. Each one says the
 * code works once, which is true regardless of how expiry is configured.
 */

/* ------------------------------------------------------------------ theme */

const INK = "#174F62";
const TEAL = "#174F62";
const TEAL_DARK = "#113D4C";
const TEAL_LIGHT = "#BFD8DE";
const ORANGE = "#C2560A";
const PEACH = "#FEE8C9";
const CREAM = "#FFF6EA";
const PROSE = "#4F6470";
const MUTED = "#626B78";
const LINE = "#D3DBE1";
const HAIR = "#E6EBEF";
const TINT = "#EEF5F7";

/** Single quotes throughout: these strings are interpolated into `style="..."`
 *  attributes, and a double quote inside a family name would close the
 *  attribute early and silently drop every declaration after it. */
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

/** Outlook on Windows computes line height from the font metrics unless it is
 *  told not to, which collapses generous leading into cramped leading. */
const EXACT = "mso-line-height-rule:exactly;";

const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ------------------------------------------------------------- primitives */

/** The masthead: the wordmark set as type, and the class of message on the
 *  right. No logo file, so there is no image to block and no broken alt box. */
function masthead(eyebrow: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${TEAL}" style="background:${TEAL};border-radius:999px;">
        <tr>
          <td style="padding:15px 22px;font-family:${FONT};font-size:18px;line-height:22px;${EXACT}font-weight:700;letter-spacing:-0.02em;color:#FFFFFF;">${esc(site.name)}</td>
          <td align="right" style="padding:15px 22px;font-family:${FONT};font-size:10px;line-height:20px;${EXACT}font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${TEAL_LIGHT};">${esc(eyebrow)}</td>
        </tr>
      </table>
      <div style="height:3px;line-height:3px;font-size:0;background:${ORANGE};margin:18px 22px 0;width:44px;">&nbsp;</div>`;
}

const h1 = (text: string) =>
  `<h1 class="sp-h1" style="margin:32px 0 0;font-family:${FONT};font-size:30px;line-height:36px;${EXACT}font-weight:600;letter-spacing:-0.025em;color:${INK};">${text}</h1>`;

const p = (text: string, top = 18) =>
  `<p style="margin:${top}px 0 0;font-family:${FONT};font-size:15px;line-height:25px;${EXACT}color:${PROSE};">${text}</p>`;

const strong = (text: string) => `<strong style="color:${INK};font-weight:600;">${text}</strong>`;

/** A quiet inset for the facts the message turns on: which address was invited,
 *  which address is being changed to. Label above value, so a narrow client
 *  never has to reflow a two-column row. */
function facts(rows: Array<[string, string]>) {
  const body = rows
    .map(
      ([label, value], index) => `<tr>
            <td style="padding:${index === 0 ? "0" : "16px"} 0 0;font-family:${FONT};font-size:10px;line-height:14px;${EXACT}font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};">${esc(label)}</td>
          </tr>
          <tr>
            <td style="padding:5px 0 0;font-family:${FONT};font-size:15px;line-height:22px;${EXACT}color:${INK};word-break:break-word;">${value}</td>
          </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;background:${TINT};border:1px solid ${LINE};border-radius:12px;">
        <tr><td style="padding:18px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>
        </td></tr>
      </table>`;
}

/** The numbered sequence in the invitation. Orange numerals, hairline between
 *  steps, no icons. It tells an invited researcher what code verification leads
 *  to, which is the one thing the invitation cannot show them in advance. */
function steps(items: string[]) {
  const body = items
    .map(
      (item, index) => `<tr>
            <td width="26" valign="top" style="padding:${index === 0 ? "0" : "13px"} 0 0;font-family:${FONT};font-size:12px;line-height:22px;${EXACT}font-weight:700;color:${ORANGE};">${index + 1}</td>
            <td valign="top" style="padding:${index === 0 ? "0" : "13px"} 0 0;font-family:${FONT};font-size:14px;line-height:22px;${EXACT}color:${PROSE};">${item}</td>
          </tr>`,
    )
    .join(`<tr><td colspan="2" style="padding:13px 0 0;"><div style="height:1px;line-height:1px;font-size:0;background:${HAIR};">&nbsp;</div></td></tr>`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;">${body}</table>`;
}

/** The one-time code, large enough to read off a screen and transcribe. */
const code = (token: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;background:${CREAM};border:1px solid ${LINE};border-radius:12px;">
        <tr><td align="center" style="padding:24px 20px;font-family:${MONO};font-size:31px;line-height:38px;${EXACT}font-weight:600;letter-spacing:0.16em;color:${TEAL_DARK};">${token}</td></tr>
      </table>`;

/** Every message sends the reader to the same first-party code screen. It is
 *  deliberately plain text rather than a token-bearing link: mail scanners
 *  cannot consume it, and no infrastructure hostname appears in the email. */
const verificationRoute = (flow: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;background:${TINT};border:1px solid ${LINE};border-radius:12px;">
        <tr><td style="padding:17px 20px;font-family:${FONT};font-size:13px;line-height:21px;${EXACT}color:${PROSE};">
          Open <strong style="color:${INK};font-weight:600;">www.splicr.org/verify?flow=${flow}</strong> and enter the code above.
        </td></tr>
      </table>`;

/** The safety note, then the sender, set quietly. No links, no social, no
 *  unsubscribe: these are account security messages, not mail a researcher
 *  should be able to opt out of and then be locked out by. */
function footer(note: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:34px 0 0;">
        <tr><td style="border-top:1px solid ${LINE};padding:22px 0 0;font-family:${FONT};font-size:12px;line-height:20px;${EXACT}color:${MUTED};">
          ${note}
          <div style="margin:22px 0 0;font-family:${FONT};font-size:11px;line-height:18px;${EXACT}color:${MUTED};">
            <span style="font-weight:600;color:${INK};letter-spacing:0.01em;">${esc(site.name)}</span><br>
            ${esc(site.location)}<br>
            ${esc(new URL(site.url).hostname)}
          </div>
        </td></tr>
      </table>`;
}

/**
 * The document around a message.
 *
 * `width="600"` is for Outlook, which ignores `max-width`; the inline
 * `width:100%;max-width:600px` is for everything else, so the same table is a
 * fixed 600 on the desktop client and fluid on a phone. The colour-scheme metas
 * ask Apple Mail and Outlook not to invert the palette; Gmail inverts regardless,
 * and dark text on white inverts to light text on dark, which stays legible.
 */
function shell({ preheader, inner }: { preheader: string; inner: string }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="x-ua-compatible" content="ie=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(site.name)}</title>
<!--[if mso]>
<style>body,table,td,a,div,p,h1{font-family:Arial,Helvetica,sans-serif !important;}</style>
<![endif]-->
<style>
  @media only screen and (max-width:620px) {
    .sp-shell { padding:24px 14px 40px !important; }
    .sp-card { padding:28px 22px 30px !important; }
    .sp-h1 { font-size:23px !important; line-height:30px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;width:100%;background:${PEACH};color:${INK};-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PEACH}" style="background:${PEACH};">
  <tr><td class="sp-shell" align="center" style="padding:44px 20px 56px;">
    <table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;">
      <tr><td class="sp-card" style="padding:18px 20px 36px;border:1px solid ${LINE};border-radius:24px;background:#FFFFFF;">
      ${inner}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/* --------------------------------------------------------------- messages */

export type AuthEmailKey =
  | "confirm_signup"
  | "invite"
  | "magic_link"
  | "change_email"
  | "reset_password"
  | "reauthentication";

export type AuthEmail = {
  key: AuthEmailKey;
  /** The template's name in Supabase, Authentication, Email Templates. */
  dashboard: string;
  /** File name under `supabase/templates`. */
  file: string;
  subject: string;
  /** The line a client shows next to the subject before the message is opened. */
  preheader: string;
  /** Go template variables this body depends on Supabase substituting. */
  variables: string[];
  html: string;
};

const TOKEN_VAR = "{{ .Token }}";
const EMAIL_VAR = "{{ .Email }}";
const NEW_EMAIL_VAR = "{{ .NewEmail }}";

/** Public signup is disabled, so this template exists as defence in depth: if a
 *  confirmation is ever issued, administratively or by mistake, it is branded
 *  and truthful rather than a Supabase default. */
const confirmSignup: AuthEmail = {
  key: "confirm_signup",
  dashboard: "Confirm signup",
  file: "confirm-signup.html",
  subject: `Confirm your ${site.name} email`,
  preheader: `Confirm this address to continue setting up your ${site.name} account.`,
  variables: [TOKEN_VAR, EMAIL_VAR],
  html: shell({
    preheader: `Confirm this address to continue setting up your ${site.name} account.`,
    inner: `${masthead("Email verification")}
      ${h1("Confirm your email address")}
      ${p(`Confirm this address to continue setting up your ${strong(site.name)} account. The code works once.`)}
      ${facts([["Address to confirm", EMAIL_VAR]])}
      ${code(TOKEN_VAR)}
      ${verificationRoute("signup")}
      ${footer(
        `If you did not expect this message, you can ignore it. No account will be activated without this confirmation.`,
      )}`,
  }),
};

const INVITE_PREHEADER = `Use your invitation code to set a password and finish your ${site.name} account.`;

const invite: AuthEmail = {
  key: "invite",
  dashboard: "Invite user",
  file: "invite-user.html",
  subject: `Your ${site.name} invitation code`,
  preheader: INVITE_PREHEADER,
  variables: [TOKEN_VAR, EMAIL_VAR],
  html: shell({
    preheader: INVITE_PREHEADER,
    inner: `${masthead("Invitation")}
      ${h1(`Your ${esc(site.name)} access is ready`)}
      ${p(
        `You have been invited to create a ${strong(site.name)} researcher account. Use the one-time code below to verify your email address and finish setting up access.`,
      )}
      ${steps([
        "Verify this email address",
        "Choose a password",
        "Complete your laboratory profile",
      ])}
      ${facts([["Invitation issued to", EMAIL_VAR]])}
      ${code(TOKEN_VAR)}
      ${verificationRoute("invite")}
      ${footer(
        `Access to ${esc(site.name)} is invitation only. This code was issued for ${EMAIL_VAR} and can be accepted once. If you were not expecting access, you can ignore this message.`,
      )}`,
  }),
};

/** Passwordless sign-in is code-only. No token-bearing link reaches an inbox. */
const magicLink: AuthEmail = {
  key: "magic_link",
  dashboard: "Magic Link",
  file: "magic-link.html",
  subject: `Your ${site.name} sign-in code`,
  preheader: `Use this one-time code to sign in to ${site.name}.`,
  variables: [TOKEN_VAR],
  html: shell({
    preheader: `Use this one-time code to sign in to ${site.name}.`,
    inner: `${masthead("Secure sign in")}
      ${h1(`Sign in to ${esc(site.name)}`)}
      ${p(`Enter this one-time code in the ${strong(site.name)} Portal. The code works once.`)}
      ${code(TOKEN_VAR)}
      ${verificationRoute("magiclink")}
      ${footer(
        "If you did not request this sign-in code, you can ignore this email. Nobody can sign in without the code.",
      )}`,
  }),
};

const changeEmail: AuthEmail = {
  key: "change_email",
  dashboard: "Change Email Address",
  file: "change-email.html",
  subject: `Confirm your new ${site.name} email`,
  preheader: `Confirm the new email address for your ${site.name} account.`,
  variables: [TOKEN_VAR, EMAIL_VAR, NEW_EMAIL_VAR],
  html: shell({
    preheader: `Confirm the new email address for your ${site.name} account.`,
    inner: `${masthead("Account security")}
      ${h1("Confirm your new email address")}
      ${p(
        `A request was made to change the email address on your ${strong(site.name)} account. The change takes effect only after it is confirmed.`,
      )}
      ${facts([
        ["Current address", EMAIL_VAR],
        ["New address", NEW_EMAIL_VAR],
      ])}
      ${code(TOKEN_VAR)}
      ${verificationRoute("email_change")}
      ${footer(
        `If you did not request this change, do not confirm it. Sign in to ${esc(site.name)} and review your account security.`,
      )}`,
  }),
};

const resetPassword: AuthEmail = {
  key: "reset_password",
  dashboard: "Reset Password",
  file: "reset-password.html",
  subject: `Your ${site.name} password reset code`,
  preheader: `Use this one-time code to choose a new ${site.name} password.`,
  variables: [TOKEN_VAR, EMAIL_VAR],
  html: shell({
    preheader: `Use this one-time code to choose a new ${site.name} password.`,
    inner: `${masthead("Password reset")}
      ${h1("Reset your password")}
      ${p(
        `We received a request to reset the password for the ${strong(site.name)} account registered to this address. Enter the code below to choose a new one. The code works once.`,
      )}
      ${facts([["Account", EMAIL_VAR]])}
      ${code(TOKEN_VAR)}
      ${verificationRoute("recovery")}
      ${footer(
        "If you did not request a password reset, you can ignore this email. Your current password remains unchanged.",
      )}`,
  }),
};

const reauthentication: AuthEmail = {
  key: "reauthentication",
  dashboard: "Reauthentication",
  file: "reauthentication.html",
  subject: `Verify your ${site.name} identity`,
  preheader: `Your verification code for a sensitive ${site.name} account action.`,
  variables: [TOKEN_VAR],
  html: shell({
    preheader: `Your verification code for a sensitive ${site.name} account action.`,
    inner: `${masthead("Identity verification")}
      ${h1("Verify your identity")}
      ${p(
        `Enter this verification code in ${strong(site.name)} to continue with the account action you requested. It can be used once.`,
      )}
      ${code(TOKEN_VAR)}
      ${footer(
        `Do not share this code with anyone. If you did not start this action, sign in to ${esc(site.name)} and review your account security.`,
      )}`,
  }),
};

/** Every template, in the order they appear in the Supabase dashboard. */
export const AUTH_EMAILS: AuthEmail[] = [
  confirmSignup,
  invite,
  magicLink,
  changeEmail,
  resetPassword,
  reauthentication,
];

export const authEmail = (key: AuthEmailKey): AuthEmail => {
  const found = AUTH_EMAILS.find((email) => email.key === key);
  if (!found) throw new Error(`Unknown auth email template: ${key}`);
  return found;
};

/** Placeholder values for previewing a template outside Supabase. Deliberately
 *  obvious: nothing here should ever be mistaken for a live code. */
export const PREVIEW_VALUES: Record<string, string> = {
  [TOKEN_VAR]: "418902",
  [EMAIL_VAR]: "researcher@example.edu",
  [NEW_EMAIL_VAR]: "new.address@example.edu",
};

/** Substitutes the preview values so a template can be looked at in a browser. */
export function renderPreview(email: AuthEmail): string {
  return Object.entries(PREVIEW_VALUES).reduce(
    (html, [variable, value]) => html.split(variable).join(value),
    email.html,
  );
}
