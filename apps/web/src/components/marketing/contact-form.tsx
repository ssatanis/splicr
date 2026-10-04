"use client";

import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";

import { site } from "@/lib/site";

const topics = ["Blinded evaluation", "Research pilot", "Core facility", "REST integration", "Something else"];

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  /** `confirmed` is what the server said it sent, not what the form hoped for. */
  | { kind: "sent"; name: string; confirmed: boolean }
  | { kind: "error"; message: string };

export function ContactForm() {
  const [topic, setTopic] = useState(topics[0]);
  const [state, setState] = useState<State>({ kind: "idle" });

  if (state.kind === "sent") {
    return (
      <div className="rounded-[1.25rem] border border-line bg-white/90 p-7">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-teal-800 text-white">
            <Check className="h-5 w-5" aria-hidden />
          </span>
          <h3 className="text-xl text-ink">Thanks, {state.name}.</h3>
        </div>
        <p role="status" className="mt-4 text-body leading-relaxed">
          Your request is with us. {state.confirmed
            ? "A confirmation is on its way to your inbox; if nothing arrives, check your spam folder."
            : "We could not send you a confirmation email, so there is nothing to look for in your inbox — your request still reached us."}{" "}
          We reply within two business days, usually sooner. You can also email{" "}
          <a className="underline" href={`mailto:${site.email}`}>
            {site.email}
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <form
      className="space-y-8"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        const name = String(data.get("name") ?? "").trim();
        setState({ kind: "sending" });
        try {
          const response = await fetch("/api/demo-request", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name,
              email: String(data.get("email") ?? "").trim(),
              company: String(data.get("company") ?? "").trim(),
              message: String(data.get("message") ?? "").trim(),
              website: String(data.get("website") ?? ""),
              topic,
            }),
          });
          const result = (await response.json().catch(() => ({}))) as {
            error?: string;
            confirmed?: boolean;
          };
          if (!response.ok) {
            setState({ kind: "error", message: result.error ?? "Something went wrong. Please try again." });
            return;
          }
          form.reset();
          setState({
            kind: "sent",
            name: name.split(/\s+/)[0] || name,
            confirmed: result.confirmed === true,
          });
        } catch {
          setState({ kind: "error", message: "We could not reach the server. Please check your connection." });
        }
      }}
    >
      <p className="text-sm text-body">
        Tell us about the screen and we will get back to you. You can also email{" "}
        <a className="underline" href={`mailto:${site.email}`}>
          {site.email}
        </a>{" "}
        directly. Do not include private screen data in a first message.
      </p>

      {state.kind === "error" && (
        <p role="alert" className="rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-700">
          {state.message}
        </p>
      )}

      <div>
        <label className="label-sm" htmlFor="name">
          Name
        </label>
        <input id="name" name="name" className="underline-input" placeholder="Jane Doe" required maxLength={120} />
      </div>
      <div>
        <label className="label-sm" htmlFor="company">
          Lab or company
        </label>
        <input
          id="company"
          name="company"
          className="underline-input"
          placeholder="Institute, core or company"
          required
          maxLength={160}
        />
      </div>
      <div>
        <label className="label-sm" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          className="underline-input"
          placeholder="you@lab.edu"
          required
          maxLength={200}
        />
      </div>

      {/* Not shown to people. A bot that fills every field gives itself away. */}
      <div aria-hidden className="hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div>
        <div className="label-sm mb-3">Topic</div>
        <div className="flex flex-wrap gap-2">
          {topics.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={topic === t}
              onClick={() => setTopic(t)}
              className={`chip ${topic === t ? "bg-teal-800 text-white" : ""}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="label-sm" htmlFor="message">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          className="underline-input min-h-[80px] resize-y"
          placeholder="Tell us about the screen"
          maxLength={4000}
        />
      </div>
      <button type="submit" className="btn btn-cyan" disabled={state.kind === "sending"}>
        {state.kind === "sending" ? "Sending" : "Request access"}
        {state.kind !== "sending" && <ArrowRight className="w-4 h-4" />}
      </button>
    </form>
  );
}
