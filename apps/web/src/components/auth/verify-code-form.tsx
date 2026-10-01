"use client";

import type { EmailOtpType } from "@supabase/supabase-js";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { ProblemNotice } from "@/components/ui/notice";
import { authProblem, type Problem } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/env";
import { safeNext } from "@/lib/supabase/redirect";

export type CodePurpose = "signup" | "invite" | "magiclink" | "recovery" | "email_change";

const COPY: Record<CodePurpose, { eyebrow: string; heading: string; description: string }> = {
  signup: {
    eyebrow: "Email verification",
    heading: "Confirm your email",
    description: "Enter the one-time code from your SplicR confirmation email.",
  },
  invite: {
    eyebrow: "Invitation",
    heading: "Accept your invitation",
    description: "Enter the one-time code from your SplicR invitation to create your password.",
  },
  magiclink: {
    eyebrow: "Secure sign in",
    heading: "Enter your sign-in code",
    description: "Enter the one-time code we sent to your email address.",
  },
  recovery: {
    eyebrow: "Password reset",
    heading: "Verify your reset code",
    description: "Enter the one-time code from your SplicR password reset email.",
  },
  email_change: {
    eyebrow: "Account security",
    heading: "Confirm your new email",
    description: "Enter the one-time code sent to your new email address.",
  },
};

export function codeDestination(purpose: CodePurpose, requested: string): string {
  if (purpose === "invite") {
    return `/reset-password?next=${encodeURIComponent("/dashboard/onboarding")}`;
  }
  if (purpose === "recovery") {
    return `/reset-password?next=${encodeURIComponent(requested)}`;
  }
  if (purpose === "signup") return "/dashboard/onboarding";
  if (purpose === "email_change") return "/dashboard/settings";
  return requested;
}

export function VerifyCodeForm({
  purpose,
  initialEmail = "",
  onCancel,
}: {
  purpose: CodePurpose;
  initialEmail?: string;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const requested = safeNext(params.get("next"));
  const copy = COPY[purpose];
  const [email, setEmail] = useState(initialEmail);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setProblem(null);
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedToken = token.replace(/\D/g, "");
    if (!normalizedEmail) return setProblem({ message: "Enter the email address that received the code." });
    if (normalizedToken.length !== 6) return setProblem({ message: "Enter the six-digit code from your email." });
    if (!supabaseConfigured) {
      return setProblem({
        message: "SplicR could not reach the sign-in service.",
        action: "Reload the page and try again.",
      });
    }

    setBusy(true);
    const type: EmailOtpType = purpose === "magiclink" ? "email" : purpose;
    const { error } = await createClient().auth.verifyOtp({
      email: normalizedEmail,
      token: normalizedToken,
      type,
    });
    setBusy(false);
    if (error) return setProblem(authProblem(error));

    router.replace(codeDestination(purpose, requested));
    router.refresh();
  }

  return (
    <div className="w-full">
      <p className="eyebrow mb-3">{copy.eyebrow}</p>
      <h1 className="font-serif text-[42px] font-medium leading-[0.98] tracking-[-0.03em] text-ink sm:text-[48px]">
        {copy.heading}
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-muted">{copy.description}</p>

      <form onSubmit={verify} className="mt-8 space-y-4" aria-busy={busy}>
        <div>
          <label htmlFor="verification-email" className="block text-[12.5px] font-medium text-ink">
            Email
          </label>
          <input
            id="verification-email"
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@institution.edu"
            autoComplete="username"
            required
            className="mt-1.5 h-12 w-full rounded-xl border border-line-strong bg-white px-3.5 text-[14px] text-ink outline-none transition-colors duration-[var(--dur-1)] placeholder:text-muted/70 focus:border-navy motion-reduce:transition-none"
          />
        </div>

        <div>
          <label htmlFor="verification-code" className="block text-[12.5px] font-medium text-ink">
            One-time code
          </label>
          <input
            id="verification-code"
            name="code"
            type="text"
            value={token}
            onChange={(event) => setToken(event.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
            className="mt-1.5 h-14 w-full rounded-xl border border-line-strong bg-cream px-4 text-center font-mono text-[24px] font-semibold tracking-[0.24em] text-teal-800 outline-none transition-colors duration-[var(--dur-1)] placeholder:text-muted/45 focus:border-teal-700 motion-reduce:transition-none"
          />
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
            Codes work once. Request a new code if the most recent one has expired.
          </p>
        </div>

        {problem && <ProblemNotice problem={problem} />}

        <button type="submit" disabled={busy} className="btn btn-teal w-full">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Verify code
        </button>
      </form>

      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="mt-5 inline-flex items-center gap-1.5 text-[13px] text-muted underline decoration-line-strong underline-offset-[3px] transition-colors duration-[var(--dur-1)] hover:text-ink motion-reduce:transition-none"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Request another code
        </button>
      ) : (
        <Link
          href="/login"
          className="mt-5 inline-flex items-center gap-1.5 text-[13px] text-muted underline decoration-line-strong underline-offset-[3px] transition-colors duration-[var(--dur-1)] hover:text-ink motion-reduce:transition-none"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to sign in
        </Link>
      )}
    </div>
  );
}

export function PublicVerifyCodeForm() {
  const params = useSearchParams();
  const raw = params.get("flow");
  const purpose: CodePurpose =
    raw === "signup" || raw === "invite" || raw === "recovery" || raw === "email_change"
      ? raw
      : "magiclink";
  return <VerifyCodeForm purpose={purpose} />;
}
