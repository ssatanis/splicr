import { site } from "@/lib/site";

/**
 * Email markup for the demo request flow.
 *
 * Two rules shaped everything here. Email clients are not browsers: layout is
 * tables, every style is inline, and anything clever degrades. And a stranger's
 * first message from a company should read like a person wrote it, so the copy
 * stays plain and the design does the work.
 *
 * Gmail and Apple Mail render `border-radius`; Outlook on Windows does not, and
 * falls back to square corners on a correct layout rather than a broken one.
 */

/** Sampled from the brand: the site's ink wordmark is exactly #174f62, and the
 *  orange is the brand orange from the design tokens. */
const BLUE = "#174f62";
const ORANGE = "#f87315";
const HEADING = "#0d0d0d";
const BODY = "#4a4f55";
const MUTED = "#8b9199";
const LINE = "#e8eaed";
const CANVAS = "#f8f8fa";

/** Single quotes, deliberately: this string is interpolated into `style="..."`
 *  attributes, and a double quote inside the family names would close the
 *  attribute early and silently drop every declaration after it. */
const FONT =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** Referenced from the inline attachment so the mark shows without hotlinking. */
export const LOGO_CID = "splicr-logo";

export type DemoRequest = {
  name: string;
  email: string;
  company: string;
  topic: string;
  message?: string;
};

const esc = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** "Jane Doe" -> "Jane". Falls back to the whole string when there is no space. */
export const firstName = (name: string) => {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first.length > 1 ? first : name.trim();
};

function shell(inner: string, preheader: string) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(site.name)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${CANVAS};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS};">
<tr><td align="center" style="padding:48px 16px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%;">
${inner}
</table>
</td></tr></table>
</body></html>`;
}

function logo() {
  return `<img src="cid:${LOGO_CID}" width="132" height="45" alt="${esc(site.name)}"
    style="display:block;width:132px;height:45px;border:0;outline:none;">`;
}

/** White card with the blue rule across the top, as in the reference. The card
 *  is one <td> so the rule and the rounded corners survive Gmail's rewriting. */
function card(body: string, sign: string) {
  return `<tr><td>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid ${LINE};border-radius:12px;border-collapse:separate;overflow:hidden;">
    <tr><td height="6" bgcolor="${BLUE}" style="height:6px;line-height:6px;font-size:0;background:${BLUE};">&nbsp;</td></tr>
    <tr><td style="padding:44px 44px 48px;">
      ${logo()}
      ${body}
    </td></tr>
    <tr><td style="border-top:1px solid ${LINE};padding:32px 44px 40px;font-family:${FONT};font-size:15px;line-height:24px;color:${MUTED};">
      ${sign}
    </td></tr>
  </table>
</td></tr>`;
}

const contactLine = () =>
  `Having trouble with your account? <a href="mailto:${site.email}" style="color:${BLUE};text-decoration:none;border-bottom:1px dashed ${BLUE};">Contact us</a>
      <div style="margin-top:26px;">Best,<br>~ ${esc(site.name)} team</div>`;

function footer() {
  const link = (href: string, label: string) =>
    `<a href="${href}" style="color:${MUTED};text-decoration:underline;">${label}</a>`;
  return `<tr><td align="center" style="padding:36px 8px 0;font-family:${FONT};font-size:12px;line-height:20px;color:${MUTED};">
  ${link(`${site.url}/contact`, "Help")}
  &nbsp;&nbsp;&middot;&nbsp;&nbsp;
  ${link(`${site.url}/evidence`, "Evidence")}
  &nbsp;&nbsp;&middot;&nbsp;&nbsp;
  ${link(site.url, "splicr.org")}
  <div style="margin-top:14px;">&copy; 2026 ${esc(site.name)}. All rights reserved.</div>
  <div>${esc(site.founded)}, New York, NY, United States</div>
</td></tr>`;
}

const h1 = (text: string) =>
  `<h1 style="margin:44px 0 0;font-family:${FONT};font-size:34px;line-height:42px;font-weight:500;color:${HEADING};letter-spacing:-0.02em;">${text}</h1>`;
const p = (text: string, top = 26) =>
  `<p style="margin:${top}px 0 0;font-family:${FONT};font-size:17px;line-height:27px;color:${BODY};">${text}</p>`;
const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:40px 0 0;">
    <tr><td bgcolor="${ORANGE}" style="background:${ORANGE};border-radius:8px;">
      <a href="${href}" style="display:inline-block;padding:15px 26px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${label}</a>
    </td></tr>
  </table>`;

/** The message the person who filled in the form receives. */
export function confirmationEmail(request: DemoRequest) {
  const who = esc(firstName(request.name));
  const rows: Array<[string, string]> = [
    ["Name", request.name],
    ["Lab or company", request.company],
    ["Topic", request.topic],
  ];
  if (request.message?.trim()) rows.push(["Message", request.message.trim()]);

  const summary = rows
    .map(
      ([label, value], index) => `<tr>
    <td style="padding:${index === 0 ? "0" : "12px"} 0 0;font-family:${FONT};font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:${MUTED};width:132px;vertical-align:top;">${esc(label)}</td>
    <td style="padding:${index === 0 ? "0" : "12px"} 0 0;font-family:${FONT};font-size:14px;line-height:22px;color:${HEADING};vertical-align:top;">${esc(value).replace(/\n/g, "<br>")}</td>
  </tr>`,
    )
    .join("");

  const recap = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0;background:${CANVAS};border-radius:10px;">
    <tr><td style="padding:20px 22px;">
      <div style="font-family:${FONT};font-size:12px;letter-spacing:0.05em;text-transform:uppercase;color:${MUTED};font-weight:600;padding-bottom:14px;">What you sent</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${summary}</table>
    </td></tr>
  </table>`;

  const inner = card(
    `${h1(`Thanks, ${who}. We have your request.`)}
      ${p(`Your request reached the <strong style="color:${HEADING};font-weight:600;">SplicR team</strong> and a real person is reading it. You can expect a reply within <strong style="color:${HEADING};font-weight:600;">two business days</strong>, usually sooner.`)}
      ${p("To make the first call useful, reply to this message with the organism, library and phenotype of the screen you have in mind.")}
      ${recap}
      ${button(`${site.url}/evidence`, "Read the evidence")}`,
    contactLine(),
  ) + footer();

  return {
    subject: "Your SplicR demo request",
    html: shell(inner, `Thanks ${firstName(request.name)}, we have your request and will reply within two business days.`),
    text: [
      `Thanks, ${firstName(request.name)}.`,
      "",
      "Your request reached the SplicR team and a real person is reading it. You can expect a reply within two business days, usually sooner.",
      "",
      "If it helps, reply to this message with the organism, library and phenotype of the screen you have in mind.",
      "",
      "What you sent",
      ...rows.map(([label, value]) => `${label}: ${value}`),
      "",
      `Read the evidence: ${site.url}/evidence`,
      "",
      `splicr.org | ${site.email}`,
      "All rights reserved. Copyright (c) 2026 SplicR. New York, NY.",
    ].join("\n"),
  };
}

/** The internal copy, built for scanning rather than for looks. */
export function notificationEmail(request: DemoRequest) {
  const rows: Array<[string, string]> = [
    ["Name", request.name],
    ["Email", request.email],
    ["Lab or company", request.company],
    ["Topic", request.topic],
    ["Message", request.message?.trim() || "(none)"],
  ];

  const table = rows
    .map(
      ([label, value]) => `<tr>
    <td style="padding:10px 0;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:${MUTED};width:140px;vertical-align:top;">${esc(label)}</td>
    <td style="padding:10px 0;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:14px;line-height:22px;color:${HEADING};vertical-align:top;">${esc(value).replace(/\n/g, "<br>")}</td>
  </tr>`,
    )
    .join("");

  const inner = card(
    `${h1("New demo request")}
      ${p(`<strong style="color:${HEADING};font-weight:600;">${esc(request.name)}</strong> from ${esc(request.company)} filled in the form on splicr.org.`, 22)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;">${table}</table>
      ${button(`mailto:${esc(request.email)}?subject=${encodeURIComponent("Re: your SplicR demo request")}`, `Reply to ${esc(firstName(request.name))}`)}`,
    `Replying to this email also reaches ${esc(request.name)} directly.
      <div style="margin-top:26px;">Best,<br>~ ${esc(site.name)} team</div>`,
  ) + footer();

  return {
    subject: `Demo request: ${request.name}, ${request.company}`,
    html: shell(inner, `${request.topic} from ${request.company}`),
    text: rows.map(([label, value]) => `${label}: ${value}`).join("\n"),
  };
}

/** A standalone preview used by the visual check and the test send. */
export const PREVIEW_REQUEST: DemoRequest = {
  name: "Jane Doe",
  email: "jane@lab.edu",
  company: "Weill Cornell Medicine",
  topic: "Blinded evaluation",
  message: "We have a genome wide knockout screen in RPE1 and want a second opinion on which twelve hits to validate.",
};
