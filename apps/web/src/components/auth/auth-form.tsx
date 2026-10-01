"use client";

import { Loader2, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Notice, ProblemNotice } from "@/components/ui/notice";
import { NEUTRAL_EMAIL_RESULT, authProblem, type Problem } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/env";
import { safeNext } from "@/lib/supabase/redirect";

/**
 * Sign in. There is no other mode.
 *
 * SplicR is invitation only, so this form cannot create an account and there is
 * nothing here that leads to one. Two consequences worth stating, because both
 * are easy to undo by accident:
 *
 *  - `shouldCreateUser: false` on the one-time link. Without it, Supabase's
 *    default is to create an account for any address that asks for a link,
 *    which would make this form a public signup with extra steps.
 *  - The response to a link request is the same sentence whether or not the
 *    address has an account. Otherwise anyone could use this field to find out
 *    which researchers are in SplicR.
 */
export function AuthForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "password" | "link">(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [sent, setSent] = useState(false);

  const unconfigured: Problem = {
    message: "SplicR could not reach the sign-in service.",
    action: "Try again in a moment. If this continues, contact your lab administrator.",
  };

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setProblem(null);
    setSent(false);
    if (!supabaseConfigured) return setProblem(unconfigured);

    setBusy("password");
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    setBusy(null);
    if (error) return setProblem(authProblem(error));
    router.replace(next);
    router.refresh();
  }

  async function emailLink() {
    setProblem(null);
    setSent(false);
    if (!email.trim()) {
      return setProblem({ message: "Enter your email address first." });
    }
    if (!supabaseConfigured) return setProblem(unconfigured);

    setBusy("link");
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: {
        // Non-negotiable. This form signs people in; it does not enrol them.
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setBusy(null);

    // A rate limit is worth saying out loud, because the reader can act on it.
    // Everything else, including "this address has no account", gets the same
    // neutral answer.
    if (error && /rate limit|too many requests/i.test(error.message)) {
      return setProblem(authProblem(error));
    }
    setSent(true);
  }

  return (
    <div className="w-full">
      <h1 className="text-[28px] font-medium leading-tight tracking-[-0.02em] text-ink">Sign in</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
        Access to SplicR is by invitation. If you expected an invitation and it has not arrived,
        contact your lab administrator.
      </p>

      <form onSubmit={signIn} className="mt-7 space-y-4">
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
        <Field
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
        />

        {problem && <ProblemNotice problem={problem} />}
        {sent && (
          <Notice tone="success" title="Check your email" action={NEUTRAL_EMAIL_RESULT} />
        )}

        <button type="submit" disabled={busy !== null} className="btn btn-navy w-full">
          {busy === "password" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Sign in
        </button>
      </form>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={emailLink}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 text-[13px] text-navy underline decoration-line-strong underline-offset-[3px] transition-colors duration-[var(--dur-1)] hover:decoration-navy disabled:opacity-60 motion-reduce:transition-none"
        >
          {busy === "link" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Email me a link
        </button>
        <Link
          href="/forgot-password"
          className="text-[13px] text-muted underline decoration-line-strong underline-offset-[3px] transition-colors duration-[var(--dur-1)] hover:text-ink hover:decoration-line-strong motion-reduce:transition-none"
        >
          Forgot password
        </Link>
      </div>
    </div>
  );
}

export function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
  autoComplete,
  hint,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  hint?: string;
  /** Shown directly under the field, where the reader is already looking. */
  error?: string;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-[12.5px] font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="mt-1.5 h-10 w-full rounded-lg border border-line-strong bg-white px-3 text-[14px] text-ink outline-none transition-colors duration-[var(--dur-1)] placeholder:text-muted/70 focus:border-navy motion-reduce:transition-none"
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-[12px] text-red-800">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[12px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
