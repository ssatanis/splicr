/**
 * SplicR email template: Instrument Serif, logo, brand colors (#6ABF36, #FAF8F5, #1A1A1A).
 * Modern, minimal, centered card with slogan and closing.
 */

const ACCENT = '#6ABF36';
const BG_PAGE = '#FAF8F5';
const BG_CARD = '#FFFFFF';
const TEXT_PRIMARY = '#1A1A1A';
const TEXT_SECONDARY = '#6B6B6B';
const TEXT_TERTIARY = '#9B9B9B';
const BORDER = '#E8E6E3';

const BRAND_NAME = 'SplicR';
const SLOGAN = 'CRISPR Screen Analysis';
const CLOSING = '— The SplicR Team';

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://splicr.org';
}

function getLogoUrl(): string {
  const base = getAppUrl();
  return `${base}/logo.png`;
}

/**
 * Wraps content in the SplicR layout: logo, name + slogan, card, CTA, closing, footer.
 */
export function splicrEmailLayout(options: {
  title: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerText?: string;
  closing?: string;
}): string {
  const {
    title,
    bodyHtml,
    ctaLabel,
    ctaUrl,
    footerText,
    closing = CLOSING,
  } = options;
  const logoUrl = getLogoUrl();
  const fontCss =
    'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap';

  const ctaSection =
    ctaLabel && ctaUrl
      ? `
    <tr><td style="padding: 24px 0 8px;"></td></tr>
    <tr>
      <td align="center">
        <a href="${ctaUrl}" style="
          display: inline-block;
          background: ${ACCENT};
          color: ${BG_CARD} !important;
          font-family: 'Instrument Serif', Georgia, serif;
          font-size: 15px;
          font-weight: 600;
          text-decoration: none;
          padding: 14px 28px;
          border-radius: 12px;
          letter-spacing: 0.02em;
        ">${ctaLabel}</a>
      </td>
    </tr>
  `
      : '';

  const footer =
    footerText !== undefined
      ? `
    <tr><td style="padding: 28px 0 0; border-top: 1px solid ${BORDER};"></td></tr>
    <tr>
      <td style="font-family: 'Instrument Serif', Georgia, serif; font-size: 12px; color: ${TEXT_TERTIARY}; line-height: 1.5; text-align: center;">
        ${footerText}
      </td>
    </tr>
  `
      : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${fontCss}" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; background: ${BG_PAGE}; font-family: 'Instrument Serif', Georgia, serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: ${BG_PAGE};">
    <tr>
      <td align="center" style="padding: 48px 24px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 520px; margin: 0 auto;">
          <tr>
            <td align="center" style="padding-bottom: 8px;">
              <img src="${logoUrl}" alt="${BRAND_NAME}" width="112" height="auto" style="display: block; max-width: 112px; height: auto;" />
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <span style="font-family: 'Instrument Serif', Georgia, serif; font-size: 20px; font-weight: 600; color: ${TEXT_PRIMARY}; letter-spacing: 0.02em;">${BRAND_NAME}</span>
              <span style="font-family: 'Instrument Serif', Georgia, serif; font-size: 13px; color: ${TEXT_TERTIARY}; margin-left: 8px;">${SLOGAN}</span>
            </td>
          </tr>
          <tr>
            <td style="
              background: ${BG_CARD};
              border-radius: 16px;
              box-shadow: 0 2px 16px rgba(0,0,0,0.04);
              padding: 36px 40px;
              border: 1px solid ${BORDER};
            ">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="font-family: 'Instrument Serif', Georgia, serif; font-size: 20px; color: ${TEXT_PRIMARY}; font-weight: 600; text-align: center; padding-bottom: 20px; letter-spacing: 0.01em;">
                    ${title}
                  </td>
                </tr>
                <tr>
                  <td style="font-family: 'Instrument Serif', Georgia, serif; font-size: 16px; line-height: 1.65; color: ${TEXT_SECONDARY}; text-align: center;">
                    ${bodyHtml}
                  </td>
                </tr>
                ${ctaSection}
                <tr><td style="padding-top: 24px;"></td></tr>
                <tr>
                  <td style="font-family: 'Instrument Serif', Georgia, serif; font-size: 14px; color: ${TEXT_SECONDARY}; text-align: center;">
                    ${closing}
                  </td>
                </tr>
                ${footer}
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top: 28px; font-family: 'Instrument Serif', Georgia, serif; font-size: 11px; color: ${TEXT_TERTIARY};">
              ${BRAND_NAME} · ${SLOGAN}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/** Derive a friendly first name from an email (e.g. john.doe@uni.edu → John) for personalization. */
function firstNameFromEmail(email: string): string {
  const local = email.split('@')[0] || '';
  const name = local.replace(/[._0-9]+/g, ' ').trim() || local;
  const first = name.split(/\s+/)[0] || name;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/** Share invitation email — personalized, SplicR-branded, Resend-ready */
export function shareInviteEmailContent(options: {
  inviterNameOrEmail: string;
  inviterDisplayName?: string | null;
  analysisName: string;
  permission: string;
  resultsUrl: string;
  recipientEmail: string;
  recipientDisplayName?: string | null;
}): { subject: string; html: string } {
  const {
    inviterNameOrEmail,
    inviterDisplayName,
    analysisName,
    permission,
    resultsUrl,
    recipientEmail,
    recipientDisplayName,
  } = options;

  const inviterName = inviterDisplayName?.trim() || inviterNameOrEmail;
  const recipientName = recipientDisplayName?.trim() || firstNameFromEmail(recipientEmail);
  const greeting = recipientName ? `Hi ${recipientName},` : 'Hi there,';

  const isEdit = permission === 'edit' || permission === 'admin';
  const permissionLabel = isEdit ? 'Can edit' : 'View only';
  const permissionSubtext = isEdit
    ? 'You can view, comment, and edit this analysis.'
    : 'You can view and comment on this analysis.';

  const subject = `${inviterName} shared "${analysisName}" with you on SplicR`;

  const bodyHtml = `
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_PRIMARY};">
      ${greeting}
    </p>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.65; color: ${TEXT_SECONDARY};">
      <span style="color: ${ACCENT}; font-weight: 600;">${escapeHtml(inviterName)}</span> has invited you to collaborate on their CRISPR screen analysis.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto 24px; max-width: 100%;">
      <tr>
        <td style="
          background: ${BG_CARD};
          border: 1px solid ${BORDER};
          border-radius: 12px;
          padding: 20px 24px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        ">
          <p style="margin: 0 0 8px; font-size: 15px; font-weight: 600; color: ${TEXT_PRIMARY};">
            ${escapeHtml(analysisName)}
          </p>
          <span style="
            display: inline-block;
            background: ${ACCENT};
            color: ${BG_CARD};
            font-size: 12px;
            font-weight: 600;
            padding: 6px 12px;
            border-radius: 8px;
            letter-spacing: 0.02em;
          ">${permissionLabel}</span>
          <p style="margin: 12px 0 0; font-size: 14px; color: ${TEXT_SECONDARY}; line-height: 1.5;">
            ${permissionSubtext}
          </p>
        </td>
      </tr>
    </table>
    <p style="margin: 0 0 8px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      Click the button below to open the analysis in SplicR.
    </p>
  `;

  const html = splicrEmailLayout({
    title: 'You\'re invited to collaborate',
    bodyHtml,
    ctaLabel: 'Open analysis',
    ctaUrl: resultsUrl,
    footerText: `You received this invite because ${escapeHtml(inviterName)} shared an analysis with you on SplicR. If you weren't expecting this, you can ignore this email.`,
  });
  return { subject, html };
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return text.replace(/[&<>"']/g, (ch) => map[ch] ?? ch);
}

/** Email confirmation (e.g. signup) — for use with Resend or Supabase custom templates */
export function confirmEmailContent(options: { confirmUrl: string }): { subject: string; html: string } {
  const subject = 'Confirm your SplicR account';
  const bodyHtml = `
    Please confirm your email address by clicking the button below.
  `;
  const html = splicrEmailLayout({
    title: 'Confirm your email',
    bodyHtml,
    ctaLabel: 'Confirm email',
    ctaUrl: options.confirmUrl,
    footerText: "If you didn't create a SplicR account, you can ignore this email.",
  });
  return { subject, html };
}

/** Password reset — for use with Resend or Supabase custom templates */
export function resetPasswordEmailContent(options: { resetUrl: string }): { subject: string; html: string } {
  const subject = 'Reset your SplicR password';
  const bodyHtml = `
    We received a request to reset your password. Click the button below to choose a new password.
  `;
  const html = splicrEmailLayout({
    title: 'Reset your password',
    bodyHtml,
    ctaLabel: 'Reset password',
    ctaUrl: options.resetUrl,
    footerText: "If you didn't request a reset, you can ignore this email. The link expires in 1 hour.",
  });
  return { subject, html };
}

/**
 * Resend template HTML with variables for use with Resend Templates API.
 * Variables: TITLE, BODY, CTA_LABEL, CTA_URL, FOOTER_TEXT, CLOSING.
 * Create via: resend.templates.create({ name: 'splicr-default', html: getResendTemplateHtml(), variables: [...] })
 */
export function getResendTemplateHtml(): string {
  const fontCss =
    'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap';
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{{TITLE}}}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${fontCss}" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; background: ${BG_PAGE}; font-family: 'Instrument Serif', Georgia, serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: ${BG_PAGE};">
    <tr>
      <td align="center" style="padding: 48px 24px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 520px; margin: 0 auto;">
          <tr>
            <td align="center" style="padding-bottom: 8px;">
              <img src="{{{LOGO_URL}}}" alt="SplicR" width="112" height="auto" style="display: block; max-width: 112px; height: auto;" />
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <span style="font-family: 'Instrument Serif', Georgia, serif; font-size: 20px; font-weight: 600; color: ${TEXT_PRIMARY}; letter-spacing: 0.02em;">SplicR</span>
              <span style="font-family: 'Instrument Serif', Georgia, serif; font-size: 13px; color: ${TEXT_TERTIARY}; margin-left: 8px;">CRISPR Screen Analysis</span>
            </td>
          </tr>
          <tr>
            <td style="background: ${BG_CARD}; border-radius: 16px; box-shadow: 0 2px 16px rgba(0,0,0,0.04); padding: 36px 40px; border: 1px solid ${BORDER};">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="font-family: 'Instrument Serif', Georgia, serif; font-size: 20px; color: ${TEXT_PRIMARY}; font-weight: 600; text-align: center; padding-bottom: 20px; letter-spacing: 0.01em;">{{{TITLE}}}</td>
                </tr>
                <tr>
                  <td style="font-family: 'Instrument Serif', Georgia, serif; font-size: 16px; line-height: 1.65; color: ${TEXT_SECONDARY}; text-align: center;">{{{BODY}}}</td>
                </tr>
                <tr><td style="padding: 24px 0 8px;"></td></tr>
                <tr>
                  <td align="center">
                    <a href="{{{CTA_URL}}}" style="display: inline-block; background: ${ACCENT}; color: ${BG_CARD} !important; font-family: 'Instrument Serif', Georgia, serif; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 28px; border-radius: 12px; letter-spacing: 0.02em;">{{{CTA_LABEL}}}</a>
                  </td>
                </tr>
                <tr><td style="padding-top: 24px;"></td></tr>
                <tr>
                  <td style="font-family: 'Instrument Serif', Georgia, serif; font-size: 14px; color: ${TEXT_SECONDARY}; text-align: center;">{{{CLOSING}}}</td>
                </tr>
                <tr><td style="padding: 28px 0 0; border-top: 1px solid ${BORDER};"></td></tr>
                <tr>
                  <td style="font-family: 'Instrument Serif', Georgia, serif; font-size: 12px; color: ${TEXT_TERTIARY}; line-height: 1.5; text-align: center;">{{{FOOTER_TEXT}}}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top: 28px; font-family: 'Instrument Serif', Georgia, serif; font-size: 11px; color: ${TEXT_TERTIARY};">SplicR · CRISPR Screen Analysis</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
