# Supabase Auth email templates

Six messages, one theme. These are the only things a researcher sees before they
are inside the console, so they are built from a shared source rather than typed
into the dashboard one at a time.

- Source: `apps/web/src/lib/email/auth-templates.ts`
- Build: `npm run emails:auth` (and `npm run emails:auth:check` in CI)
- Tests: `node --test apps/web/tests/auth-emails.test.mjs`
- Review: open `supabase/templates/preview.html` in a browser for all six with
  placeholder values filled in

**Do not edit the `.html` files in this directory.** They are generated. Edit the
TypeScript and rebuild, or the next build silently reverts the change and the
`check` run fails.

## Where each file goes

Supabase dashboard, Authentication, Emails, Templates. Paste the file contents
into the Message body and set the Subject heading to match.

| File | Template in the dashboard | Subject |
| --- | --- | --- |
| `confirm-signup.html` | Confirm signup | Confirm your SplicR email |
| `invite-user.html` | Invite user | Your SplicR invitation code |
| `magic-link.html` | Magic Link | Your SplicR sign-in code |
| `change-email.html` | Change Email Address | Confirm your new SplicR email |
| `reset-password.html` | Reset Password | Your SplicR password reset code |
| `reauthentication.html` | Reauthentication | Verify your SplicR identity |

For the local stack, point `supabase/config.toml` at the files instead of
pasting them:

```toml
[auth.email.template.invite]
subject = "Your SplicR invitation code"
content_path = "./supabase/templates/invite-user.html"
```

`confirm_signup`, `magic_link`, `email_change`, `recovery` and `reauthentication`
take the same two keys.

## The theme

White, near black `#111111`, dark navy `#24334B`. Greys are near black over white
at 82%, 58%, 12%, 6% and 3.5%, resolved to hex because older Outlook drops
`rgb()` with an alpha channel. Navy appears on the button, the rule under the
masthead and the numerals in the invitation, and nowhere else.

The wordmark is set as type, so there is no logo file to block, no broken alt box
and no image-loading prompt on a message a researcher needs to act on. There is
no illustration, no social row, no marketing, no unsubscribe link and no tracking
pixel. The layout is tables, every style that matters is inline, and the single
`<style>` block only holds a small-screen refinement the message does not depend
on: a client that strips it still renders a correct 600px email.

Every message carries a hidden preheader, a masthead naming the class of message,
one heading, one instruction, one one-time code, and a footer saying what to do
if it was not expected. No message contains a token-bearing link or an
infrastructure hostname. Researchers enter codes only on a first-party SplicR
screen.

## Two things these templates deliberately do not say

**No expiry in hours.** Supabase exposes no lifetime variable to a template, so a
number here would drift the moment Auth's OTP expiry is changed. Each message
says the code works once, which stays true. If the product needs to show a real
expiry, it has to come from the verification page, not from the email.

**No plain-text part.** Supabase Auth sends the template as the HTML body and has
no field for a text alternative. Every message is readable with styles stripped,
which is the available mitigation. A text/plain part would need delivery to move
to a Send Email hook, where SplicR builds the whole message.

## Before production

1. Paste all six, then trigger each one against a real inbox through the
   configured SMTP sender, not the Supabase built-in.
2. Check Gmail desktop, Gmail mobile, Apple Mail, Outlook, and a dark-mode client.
3. Confirm each code can be entered at `www.splicr.org/verify` and never exposes
   the underlying authentication provider.
4. Confirm `{{ .Email }}`, `{{ .NewEmail }}` and `{{ .Token }}` render, and that
   no `{{` survives in a delivered message.
