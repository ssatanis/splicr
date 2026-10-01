"use client";

import { KeyRound, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { ProblemNotice } from "@/components/ui/notice";
import { authProblem, type Problem } from "@/lib/errors";
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
 * Invitation codes are issued only by a SplicR administrator. This form never
 * requests a code and never creates an identity.
 */
export function AuthForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const unconfigured: Problem = {
    message: "SplicR could not reach the sign-in service.",
    action: "Try again in a moment. If this continues, contact your lab administrator.",
  };

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setProblem(null);
    if (!supabaseConfigured) return setProblem(unconfigured);

    setBusy(true);
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setProblem(authProblem(error));
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="w-full">
      <p className="eyebrow mb-3">Welcome back</p>
      <h1 className="font-serif text-[42px] font-medium leading-[0.98] tracking-[-0.03em] text-ink sm:text-[48px]">
        Sign in
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-muted">
        Access to SplicR is by invitation. If you expected an invitation and it has not arrived,
        contact your lab administrator.
      </p>

      <form onSubmit={signIn} className="mt-8 space-y-4" aria-busy={busy}>
        <Field
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@institution.edu"
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

        <div aria-live="polite">
          {problem && <ProblemNotice problem={problem} />}
        </div>

        <button type="submit" disabled={busy} className="btn btn-teal w-full">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Sign in
        </button>
      </form>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/verify?flow=invite"
          className="inline-flex items-center gap-1.5 text-[13px] text-navy underline decoration-line-strong underline-offset-[3px] transition-colors duration-[var(--dur-1)] hover:decoration-navy disabled:opacity-60 motion-reduce:transition-none"
        >
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
          I have an invitation code
        </Link>
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
        className="mt-1.5 h-12 w-full rounded-xl border border-line-strong bg-white px-3.5 text-[14px] text-ink outline-none transition-colors duration-[var(--dur-1)] placeholder:text-muted/70 focus:border-navy motion-reduce:transition-none"
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
