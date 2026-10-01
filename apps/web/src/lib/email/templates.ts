import { site } from "@/lib/site";

/**
 * Email markup for the demo request flow.
 *
 * Email clients are not browsers: layout is tables, every style is inline, and
 * anything clever degrades. There are deliberately no images and no
 * attachments. The message is type on a card, so nothing can fail to load and
 * nothing shows up as a stray attachment in the client.
 *
 * Gmail and Apple Mail render `border-radius`; Outlook on Windows does not, and
 * falls back to square corners on a correct layout rather than a broken one.
 */

/** The SplicR blue, sampled from the ink wordmark on the site. Used for the top
 *  rule, the button and every link, so the message carries one colour. */
const BLUE = "#174f62";
const HEADING = "#000000";
const BODY = "#4b4d52";
const SOFT = "#85878d";
const FAINT = "#b3b6bc";
const LINE = "#e9eaed";
const CANVAS = "#f8f8fa";

/** Single quotes, deliberately: this string is interpolated into `style="..."`
 *  attributes, and a double quote inside the family names would close the
 *  attribute early and silently drop every declaration after it. */
const FONT =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

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
<tr><td align="center" style="padding:56px 16px 48px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
${inner}
</table>
</td></tr></table>
</body></html>`;
}

/** The white card: a flat blue rule clipped by the rounded corners, the message,
 *  a hairline, then the sign-off. */
function card(body: string) {
  return `<tr><td>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid ${LINE};border-radius:8px;border-collapse:separate;overflow:hidden;box-shadow:0 1px 4px rgba(20,30,40,0.06);">
    <tr><td height="5" bgcolor="${BLUE}" style="height:5px;line-height:5px;font-size:0;background:${BLUE};">&nbsp;</td></tr>
    <tr><td style="padding:56px 54px 54px;">
      ${body}
    </td></tr>
    <tr><td style="border-top:1px solid ${LINE};padding:36px 54px 44px;font-family:${FONT};font-size:15px;line-height:24px;color:${SOFT};">
      Having trouble with your account? <a href="mailto:${site.email}" style="color:${BLUE};text-decoration:none;border-bottom:1px dashed ${BLUE};">Contact us</a>
      <div style="margin-top:22px;">Best,<br>~ ${esc(site.name)} team</div>
    </td></tr>
  </table>
</td></tr>`;
}

function footer() {
  const link = (href: string, label: string) =>
    `<a href="${href}" style="color:${FAINT};text-decoration:underline;">${label}</a>`;
  return `<tr><td align="center" style="padding:44px 8px 0;font-family:${FONT};font-size:12px;line-height:20px;color:${FAINT};">
  ${link(`${site.url}/terms`, "Terms &amp; Conditions")}
  &nbsp;&nbsp;<span style="color:${LINE};">|</span>&nbsp;&nbsp;
  ${link(`${site.url}/privacy`, "Privacy Policy")}
  <div style="margin-top:22px;">&copy;${esc(site.name)} 2026. All rights reserved.</div>
  <div style="margin-top:2px;">${esc(site.location)}</div>
</td></tr>`;
}

const strong = (text: string) => `<strong style="color:${HEADING};font-weight:600;">${text}</strong>`;

const wordmark = () =>
  `<div style="font-family:${FONT};font-size:22px;font-weight:700;color:${HEADING};letter-spacing:-0.02em;">${esc(site.name)}</div>`;

const h1 = (text: string) =>
  `<h1 style="margin:0;font-family:${FONT};font-size:32px;line-height:40px;font-weight:600;color:${HEADING};letter-spacing:-0.015em;">${text}</h1>`;

const p = (text: string, top = 28) =>
  `<p style="margin:${top}px 0 0;font-family:${FONT};font-size:15px;line-height:24px;color:${BODY};">${text}</p>`;

const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:40px 0 0;">
    <tr><td bgcolor="${BLUE}" style="background:${BLUE};border-radius:8px;">
      <a href="${href}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${label}</a>
    </td></tr>
  </table>`;

/** A read-only recap of the form, styled as a quiet inset block inside the
 *  card. Row labels are the field names as the form shows them, so it reads
 *  back as an echo rather than a database dump. */
function recap(rows: Array<[string, string]>) {
  const body = rows
    .map(
      ([label, value], index) => `<tr>
    <td style="padding:${index === 0 ? "0" : "14px"} 0 0;font-family:${FONT};font-size:12px;letter-spacing:0.05em;text-transform:uppercase;color:${SOFT};width:130px;vertical-align:top;">${esc(label)}</td>
    <td style="padding:${index === 0 ? "0" : "14px"} 0 0;font-family:${FONT};font-size:15px;line-height:23px;color:${HEADING};vertical-align:top;">${esc(value).replace(/\n/g, "<br>")}</td>
  </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0;background:${CANVAS};border-radius:8px;">
    <tr><td style="padding:22px 24px;">
      <div style="font-family:${FONT};font-size:12px;letter-spacing:0.05em;text-transform:uppercase;color:${SOFT};font-weight:600;padding-bottom:14px;">What you sent</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>
    </td></tr>
  </table>`;
}

/** The message the person who filled in the form receives. */
export function confirmationEmail(request: DemoRequest) {
  const who = esc(firstName(request.name));

  const rows: Array<[string, string]> = [
    ["Name", request.name],
    ["Lab or company", request.company],
    ["Topic", request.topic],
  ];
  if (request.message?.trim()) rows.push(["Message", request.message.trim()]);

  const inner =
    card(
      `${wordmark()}
      <div style="margin-top:36px;">${h1(`Thanks, ${who}!`)}</div>
      ${p(`We have your request. A real person on the ${strong("SplicR team")} is reading it, and you can expect a reply within ${strong("two business days")}, usually sooner.`, 22)}
      ${p("To make the first call useful, reply to this message with the organism, library and phenotype of the screen you have in mind.")}
      ${recap(rows)}
      ${button(`${site.url}/evidence`, "Read the evidence")}`,
    ) + footer();

  return {
    subject: "Your SplicR demo request",
    html: shell(inner, `Thanks ${firstName(request.name)}, we have your request and will reply within two business days.`),
    text: [
      `Thanks, ${firstName(request.name)}!`,
      "",
      "We have your request. A real person on the SplicR team is reading it, and you can expect a reply within two business days, usually sooner.",
      "",
      "To make the first call useful, reply to this message with the organism, library and phenotype of the screen you have in mind.",
      "",
      "What you sent",
      ...rows.map(([label, value]) => `${label}: ${value}`),
      "",
      `Read the evidence: ${site.url}/evidence`,
      "",
      `Having trouble with your account? Contact us: ${site.email}`,
      "",
      "Best,",
      "~ SplicR team",
      "",
      `Terms & conditions: ${site.url}/terms`,
      `Privacy Policy: ${site.url}/privacy`,
      `(c) SplicR 2026. All rights reserved.`,
      site.location,
    ].join("\n"),
  };
}

/** The internal copy, in the same card so the two never look like different products. */
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
    <td style="padding:12px 0;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:${SOFT};width:130px;vertical-align:top;">${esc(label)}</td>
    <td style="padding:12px 0;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:15px;line-height:24px;color:${HEADING};vertical-align:top;">${esc(value).replace(/\n/g, "<br>")}</td>
  </tr>`,
    )
    .join("");

  const inner =
    card(
      `${wordmark()}
      <div style="margin-top:36px;">${h1("New demo request")}</div>
      ${p(`${strong(esc(request.name))} from ${esc(request.company)} filled in the form on splicr.org.`, 22)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;">${table}</table>
      ${button(`mailto:${esc(request.email)}?subject=${encodeURIComponent("Re: your SplicR demo request")}`, `Reply to ${esc(firstName(request.name))}`)}`,
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
  company: "Hudson Genomics",
  topic: "Blinded evaluation",
  message: "We have a genome wide knockout screen in RPE1 and want a second opinion on which twelve hits to validate.",
};
