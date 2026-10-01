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
 * reset link.
 *
 * The field is a normal password input with `autoComplete="new-password"` and a
 * reveal toggle, so a password manager can fill it and a person typing on a
 * phone can check what they typed. There is no second "confirm" field: with a
 * reveal control it catches nothing a careful reader would not, and it doubles
 * the work for the manager-using majority.
 */
export function SetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  const [password, setPassword] = useState("");
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
        <h1 className="text-[28px] font-medium leading-tight tracking-[-0.02em] text-ink">
          This link is no longer valid
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          The link has expired or has already been used. Your password has not changed.
        </p>
        <Link href="/forgot-password" className="btn btn-navy mt-7 w-full">
          Request a new link
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
      <h1 className="text-[28px] font-medium leading-tight tracking-[-0.02em] text-ink">
        Choose a password
      </h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
        This is the password you will use to sign in to SplicR.
      </p>

      <form onSubmit={save} className="mt-7 space-y-4">
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
              className="h-10 w-full rounded-lg border border-line-strong bg-white pl-3 pr-10 text-[14px] text-ink outline-none transition-colors duration-[var(--dur-1)] focus:border-navy motion-reduce:transition-none"
            />
            <button
              type="button"
              onClick={() => setReveal((on) => !on)}
              className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors duration-[var(--dur-1)] hover:text-ink motion-reduce:transition-none"
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

        {problem && <ProblemNotice problem={problem} />}

        <button
          type="submit"
          disabled={busy || session === "checking"}
          className="btn btn-navy w-full"
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
