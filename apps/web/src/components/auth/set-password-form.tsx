"use client";

import { Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Notice, ProblemNotice } from "@/components/ui/notice";
import { authProblem, type Problem } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/env";
import { safeNext } from "@/lib/supabase/redirect";

/** Long enough to be worth having, short enough that a password manager's
 *  output and a memorable passphrase both pass. No composition rules: they
 *  push people towards `Password1!`, which is worse than a long phrase. */
const MIN_LENGTH = 8;

/**
 * Choosing a password, for a researcher who arrived from an invitation or a
 * reset code.
 *
 * Both fields use the standard password-manager autocomplete value. A single
 * reveal control applies to both, so the pair can be checked without turning
 * either value into permanently visible text.
 */
export function SetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  // Whether Supabase is configured is known at first render, so it is the initial
  // state rather than something an effect corrects. Setting it inside the effect
  // rendered "checking" once on a deployment that can never check, and cost a
  // cascading render to say so.
  const [session, setSession] = useState<"checking" | "ready" | "missing">(
    supabaseConfigured ? "checking" : "missing",
  );

  useEffect(() => {
    if (!supabaseConfigured) return;
    let live = true;
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (live) setSession(data.session ? "ready" : "missing");
      });
    return () => {
      live = false;
    };
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setProblem(null);
    if (password.length < MIN_LENGTH) {
      return setProblem({ message: `Use at least ${MIN_LENGTH} characters.` });
    }
    if (password !== confirmation) {
      return setProblem({ message: "The two passwords do not match." });
    }

    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return setProblem(authProblem(error));

    router.replace(next);
    router.refresh();
  }

  if (session === "missing") {
    return (
      <div className="w-full">
        <p className="eyebrow mb-3">Secure access</p>
        <h1 className="font-serif text-[42px] font-medium leading-[0.98] tracking-[-0.03em] text-ink sm:text-[48px]">
          Verification required
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-muted">
          Enter a new invitation or password-reset code before choosing a password. Your password
          has not changed.
        </p>
        <Link href="/forgot-password" className="btn btn-teal mt-7 w-full">
          Request a new code
        </Link>
        <Link
          href="/login"
          className="mt-4 block text-center text-[13px] text-muted underline decoration-line-strong underline-offset-[3px] hover:text-ink"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full">
      <p className="eyebrow mb-3">Finish account setup</p>
      <h1 className="font-serif text-[42px] font-medium leading-[0.98] tracking-[-0.03em] text-ink sm:text-[48px]">
        Create your password
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-muted">
        This is the password you will use to sign in to SplicR.
      </p>

      <form onSubmit={save} className="mt-8 space-y-4" aria-busy={busy}>
        <div>
          <label htmlFor="new-password" className="block text-[12.5px] font-medium text-ink">
            New password
          </label>
          <div className="relative mt-1.5">
            <input
              id="new-password"
              name="new-password"
              type={reveal ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={MIN_LENGTH}
              required
              aria-describedby="new-password-hint"
              className="h-12 w-full rounded-xl border border-line-strong bg-white pl-3.5 pr-11 text-[14px] text-ink outline-none transition-colors duration-[var(--dur-1)] focus:border-navy motion-reduce:transition-none"
            />
            <button
              type="button"
              onClick={() => setReveal((on) => !on)}
              className="absolute right-1 top-2 flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors duration-[var(--dur-1)] hover:text-ink motion-reduce:transition-none"
              aria-label={reveal ? "Hide password" : "Show password"}
            >
              {reveal ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
          <p id="new-password-hint" className="mt-1.5 text-[12px] text-muted">
            At least {MIN_LENGTH} characters. A password manager is welcome.
          </p>
        </div>

        <div>
          <label htmlFor="confirm-password" className="block text-[12.5px] font-medium text-ink">
            Confirm password
          </label>
          <input
            id="confirm-password"
            name="confirm-password"
            type={reveal ? "text" : "password"}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="new-password"
            minLength={MIN_LENGTH}
            required
            className="mt-1.5 h-12 w-full rounded-xl border border-line-strong bg-white px-3.5 text-[14px] text-ink outline-none transition-colors duration-[var(--dur-1)] focus:border-navy motion-reduce:transition-none"
          />
        </div>

        {problem && <ProblemNotice problem={problem} />}

        <button
          type="submit"
          disabled={busy || session === "checking"}
          className="btn btn-teal w-full"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Save password and continue
        </button>
      </form>

      <Notice
        tone="info"
        className="mt-7"
        title="Signing in again later uses this password."
        action="You can change it at any time from Settings."
      />
    </div>
  );
}
