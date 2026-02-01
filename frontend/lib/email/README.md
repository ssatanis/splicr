# SplicR Email (Resend)

All SplicR emails use the same template: **Instrument Serif**, SplicR logo, brand colors (#6ABF36, #FAF8F5, #1A1A1A), name + slogan, centered card, and closing (“— The SplicR team”).

## Env

- `RESEND_API_KEY` – from [Resend API Keys](https://resend.com/api-keys); must start with `re_`
- `RESEND_FROM` – e.g. `SplicR <notifications@yourdomain.com>` (use a verified domain in Resend)

**Making sure emails actually send**

1. **Local:** Set both in `frontend/.env.local`.
2. **Vercel:** Add `RESEND_API_KEY` and `RESEND_FROM` in Project → Settings → Environment Variables (for Production/Preview/Development as needed).
3. **Sender:** If you omit `RESEND_FROM`, the app uses `SplicR <onboarding@resend.dev>`. Resend only delivers from that address to the email you signed up with. To deliver to collaborators, add and verify a domain in Resend, then set `RESEND_FROM=SplicR <notifications@yourdomain.com>`.

If the share API returns success but the invitee doesn’t get the email, the UI shows a warning and you’ll see the error in the API response (`emailSent: false`, `emailError`). Check Resend Dashboard → Logs for delivery status.

## What uses it

- **Share invite** – When you invite someone via email from Share Analysis, the API sends the invite email via Resend using this template.

## Auth (confirm / reset password)

Supabase sends confirmation and reset emails itself. To use the SplicR look for those:

1. **Resend as SMTP in Supabase**  
   Supabase Dashboard → Authentication → Email Templates → Customize, or use [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) and set Resend’s SMTP.

2. **Custom HTML in Supabase**  
   In Supabase Email Templates you can paste custom HTML. Use the same layout as our template (Instrument Serif, logo, 6ABF36, rounded card, centered) and Supabase variables:
   - Confirm: `{{ .ConfirmationURL }}`
   - Reset: `{{ .ConfirmationURL }}` (or the reset link variable your Supabase version uses)

The layout and helpers are in `splicr-template.ts`; `confirmEmailContent` and `resetPasswordEmailContent` return `{ subject, html }` for confirm and reset. For Supabase you’d pass the URL Supabase provides (e.g. from a hook or by building the same URL) into these helpers if you send those emails from your app instead of Supabase.

## Logo in emails

Logo URL is `NEXT_PUBLIC_APP_URL + '/logo.png'`. Ensure `public/logo.png` exists and is served so the image loads in inboxes.

## Resend Templates API

To create the SplicR template in Resend (dashboard or API), use `getResendTemplateHtml()` from `splicr-template.ts`. Variables:

| Variable       | Type   | Description |
|----------------|--------|-------------|
| `TITLE`        | string | Email title (e.g. “Confirm your email”) |
| `BODY`         | string | Main body HTML |
| `CTA_LABEL`    | string | Button text (e.g. “Confirm email”) |
| `CTA_URL`      | string | Button link |
| `CLOSING`      | string | Sign-off (e.g. “— The SplicR team”) |
| `FOOTER_TEXT`  | string | Small print below closing |
| `LOGO_URL`     | string | Full logo URL (fallback: `https://splicr.org/logo.png`) |

Create with `resend.templates.create({ name: 'splicr-default', html: getResendTemplateHtml(), variables: [...] })` and publish before sending.
