"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Field } from "@/components/auth/auth-form";
import { Notice, ProblemNotice } from "@/components/ui/notice";
import { NEUTRAL_EMAIL_RESULT, authProblem, type Problem } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/env";

/**
 * Request a password reset.
 *
 * The answer is the same sentence whether or not the address has an account.
 * Saying "no account exists for this email" turns this form into a way of
 * checking which researchers are in SplicR, one address at a time, and the
 * person who genuinely mistyped their address is helped just as well by being
 * told to check their inbox and finding nothing.
 *
 * Supabase's reset does not create accounts, so there is no equivalent of the
 * one-time link's `shouldCreateUser` to set here.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [sent, setSent] = useState(false);

  async function request(event: React.FormEvent) {
    event.preventDefault();
    setProblem(null);
    if (!supabaseConfigured) {
      return setProblem({
        message: "SplicR could not reach the sign-in service.",
        action: "Try again in a moment.",
      });
    }

    setBusy(true);
    const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
    });
    setBusy(false);

    if (error && /rate limit|too many requests/i.test(error.message)) {
      return setProblem(authProblem(error));
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="w-full">
        <h1 className="text-[28px] font-medium leading-tight tracking-[-0.02em] text-ink">Check your email</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{NEUTRAL_EMAIL_RESULT}</p>
        <p className="mt-4 text-[13px] leading-relaxed text-muted">
          The link can be used once. If it has expired by the time you open it, request another.
        </p>
        <Link href="/login" className="btn btn-ghost mt-7 w-full">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full">
      <h1 className="text-[28px] font-medium leading-tight tracking-[-0.02em] text-ink">Reset your password</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
        Enter the address on your SplicR account and we will send a secure link for choosing a new
        password.
      </p>

      <form onSubmit={request} className="mt-7 space-y-4">
        <Field
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@lab.edu"
          autoComplete="username"
          required
        />
        {problem && <ProblemNotice problem={problem} />}
        <button type="submit" disabled={busy} className="btn btn-navy w-full">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Send reset link
        </button>
      </form>

      <Link
        href="/login"
        className="mt-5 inline-flex items-center gap-1.5 text-[13px] text-muted underline decoration-line-strong underline-offset-[3px] transition-colors duration-[var(--dur-1)] hover:text-ink motion-reduce:transition-none"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to sign in
      </Link>
      <Notice
        tone="info"
        className="mt-7"
        title="Access to SplicR is by invitation."
        action="Resetting a password does not create an account."
      />
    </div>
  );
}
