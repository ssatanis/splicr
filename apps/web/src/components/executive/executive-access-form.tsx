"use client";

import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";

import { requestExecutiveCode, verifyExecutiveCode } from "@/app/executive/actions";
import { EXECUTIVES, type ExecutiveEmail } from "@/lib/executive/constants";

export function ExecutiveAccessForm() {
  const [email, setEmail] = useState<ExecutiveEmail>(Object.keys(EXECUTIVES)[0] as ExecutiveEmail);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function request() {
    setNote(null);
    startTransition(async () => {
      const result = await requestExecutiveCode(email);
      setNote({ ok: result.ok, text: result.ok ? result.message : result.error });
      if (result.ok) setSent(true);
    });
  }

  function verify(event: React.FormEvent) {
    event.preventDefault();
    setNote(null);
    startTransition(async () => {
      const result = await verifyExecutiveCode(email, code);
      if (!result.ok) setNote({ ok: false, text: result.error });
    });
  }

  return (
    <div className="w-full">
      <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-800">
        <ShieldCheck className="h-5 w-5" aria-hidden="true" />
      </div>
      <p className="eyebrow mb-3">Restricted operations</p>
      <h1 className="font-serif text-[42px] font-medium leading-[0.98] tracking-[-0.03em] text-ink sm:text-[48px]">
        Executive access
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-muted">
        A fresh one-time code is required for every privileged session. Access closes automatically
        after 15 minutes.
      </p>

      <form onSubmit={verify} className="mt-8 space-y-4">
        <label className="block text-[12.5px] font-medium text-ink">
          Executive identity
          <select
            value={email}
            onChange={(event) => {
              setEmail(event.target.value as ExecutiveEmail);
              setSent(false);
              setCode("");
              setNote(null);
            }}
            className="mt-1.5 h-12 w-full rounded-xl border border-line-strong bg-white px-3.5 text-[14px] text-ink outline-none focus:border-navy"
          >
            {Object.entries(EXECUTIVES).map(([address, executive]) => (
              <option key={address} value={address}>{executive.name} · {address}</option>
            ))}
          </select>
        </label>

        {sent && (
          <label className="block text-[12.5px] font-medium text-ink">
            One-time code
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              autoFocus
              placeholder="000000"
              className="mt-1.5 h-14 w-full rounded-xl border border-line-strong bg-cream px-4 text-center font-mono text-[24px] font-semibold tracking-[0.24em] text-teal-800 outline-none focus:border-teal-700"
            />
          </label>
        )}

        {note && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${note.ok ? "border-teal-100 bg-teal-50 text-teal-900" : "border-red-200 bg-red-50 text-red-800"}`}>
            {note.text}
          </div>
        )}

        {sent ? (
          <div className="flex gap-3">
            <button type="submit" disabled={pending || code.length !== 6} className="btn btn-teal flex-1">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Open console
            </button>
            <button type="button" disabled={pending} onClick={request} className="btn btn-ghost">
              Resend
            </button>
          </div>
        ) : (
          <button type="button" disabled={pending} onClick={request} className="btn btn-teal w-full">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Send one-time code
          </button>
        )}
      </form>
    </div>
  );
}
