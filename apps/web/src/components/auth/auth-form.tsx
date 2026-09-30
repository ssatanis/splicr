"use client";

import { ArrowRight, Loader2, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/env";

type Mode = "login" | "signup";

/**
 * Whether to offer Google sign-in.
 *
 * Off until the provider is actually enabled on the Supabase project, because a
 * button that returns 400 is worse than no button, and this one sat above the
 * email form as the first thing a new lab would click.
 */
const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH === "1";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [busy, setBusy] = useState<null | "password" | "magic" | "google">(null);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  async function withPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!supabaseConfigured) return setMessage({ tone: "err", text: "Supabase is not configured. Use the demo instead." });
    setBusy("password");
    setMessage(null);
    const supabase = createClient();
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
          data: { full_name: name, organization_name: org },
        },
      });
      setBusy(null);
      if (error) return setMessage({ tone: "err", text: error.message });
      return setMessage({ tone: "ok", text: "Check your inbox to confirm your email, then sign in." });
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(null);
    if (error) return setMessage({ tone: "err", text: error.message });
    router.replace(next);
    router.refresh();
  }

  async function magicLink() {
    if (!email) return setMessage({ tone: "err", text: "Enter your email first." });
    if (!supabaseConfigured) return setMessage({ tone: "err", text: "Supabase is not configured. Use the demo instead." });
    setBusy("magic");
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setBusy(null);
    if (error) return setMessage({ tone: "err", text: error.message });
    setMessage({ tone: "ok", text: "Magic link sent. Open it on this device." });
  }

  async function google() {
    if (!supabaseConfigured) return setMessage({ tone: "err", text: "Supabase is not configured. Use the demo instead." });
    setBusy("google");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      setBusy(null);
      setMessage({ tone: "err", text: error.message });
    }
  }

  return (
    <div>
      <div className="eyebrow">{mode === "login" ? "Welcome back" : "Create your workspace"}</div>
      <h2 className="mt-3 display text-ink text-4xl md:text-5xl">
        {mode === "login" ? "Sign in" : "Get started"}
      </h2>
      <p className="mt-4 text-body">
        {mode === "login" ? (
          <>
            New here?{" "}
            <Link href="/signup" className="text-orange-500 hover:text-orange-600">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have one?{" "}
            <Link href="/login" className="text-orange-500 hover:text-orange-600">
              Sign in
            </Link>
          </>
        )}
      </p>

      {/* The Google provider is disabled on the live Supabase project: its
          /auth/v1/settings reports every external provider false. A visitor
          clicking this got a 400 "Unsupported provider" and Supabase's raw error
          text, on the most prominent control of the page. It is behind a flag
          rather than deleted, so enabling the provider and setting
          NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=1 brings it back without a rewrite. */}
      {GOOGLE_ENABLED ? (
        <>
          <button type="button" onClick={google} disabled={busy !== null} className="btn btn-ghost w-full mt-10">
            {busy === "google" ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleGlyph />}
            Continue with Google
          </button>

          <div className="my-8 flex items-center gap-4 text-xs text-muted">
            <span className="h-px flex-1 bg-line" /> or with email <span className="h-px flex-1 bg-line" />
          </div>
        </>
      ) : (
        <div className="mt-10" />
      )}

      <form onSubmit={withPassword} className="space-y-7">
        {mode === "signup" && (
          <>
            <Field id="name" label="Name" value={name} onChange={setName} placeholder="Jane Doe" required />
            <Field id="org" label="Lab or organization" value={org} onChange={setOrg} placeholder="Englander Institute" />
          </>
        )}
        <Field id="email" label="Email" type="email" value={email} onChange={setEmail} placeholder="you@lab.edu" required />
        <Field
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
          required
          minLength={8}
        />

        {message && (
          <div
            className={`rounded-xl px-4 py-3 text-sm ${
              message.tone === "ok" ? "bg-cyan-50 text-teal-800" : "bg-orange-50 text-orange-700"
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy !== null} className="btn btn-cyan">
            {busy === "password" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {mode === "login" ? "Sign in" : "Create account"} <ArrowRight className="w-4 h-4" />
          </button>
          <button type="button" onClick={magicLink} disabled={busy !== null} className="btn btn-ghost">
            {busy === "magic" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            Email me a link
          </button>
        </div>
      </form>

      <div className="mt-10 rounded-2xl border border-line p-5 text-sm">
        <div className="text-ink font-medium">Just looking?</div>
        <p className="text-body mt-1">Explore the dashboard with a demo screen. No account needed.</p>
        <a href="/api/demo" className="mt-3 inline-flex items-center gap-1 text-orange-500 hover:text-orange-600">
          Open the demo <ArrowRight className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
  minLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <div>
      <label htmlFor={id} className="label-sm">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        className="underline-input"
        autoComplete={type === "password" ? "current-password" : type === "email" ? "email" : "on"}
      />
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  );
}
