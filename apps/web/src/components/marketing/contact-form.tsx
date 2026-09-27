"use client";

import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";

const topics = ["Blind test", "Pharma pilot", "Core facility", "Connect / MCP", "Something else"];

export function ContactForm() {
  const [sent, setSent] = useState(false);
  const [topic, setTopic] = useState(topics[0]);

  if (sent) {
    return (
      <div className="rounded-2xl bg-cyan-50 border border-cyan-100 p-6 text-ink">
        <div className="inline-flex items-center gap-2 font-medium">
          <Check className="w-4 h-4 text-cyan-600" /> Request received
        </div>
        <p className="mt-2 text-body text-sm">
          Thanks. We reply within two working days. Until the backend is connected this form
          only confirms locally.
        </p>
      </div>
    );
  }

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        setSent(true);
      }}
    >
      <div>
        <label className="label-sm" htmlFor="name">
          Name
        </label>
        <input id="name" name="name" className="underline-input" placeholder="Jane Doe" required />
      </div>
      <div>
        <label className="label-sm" htmlFor="company">
          Lab or company
        </label>
        <input id="company" name="company" className="underline-input" placeholder="Institute, core or company" required />
      </div>
      <div>
        <label className="label-sm" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" className="underline-input" placeholder="you@lab.edu" required />
      </div>
      <div>
        <div className="label-sm mb-3">Topic</div>
        <div className="flex flex-wrap gap-2">
          {topics.map((t) => (
            <button
              key={t}
              type="button"
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
        <textarea id="message" name="message" className="underline-input min-h-[80px] resize-y" placeholder="Tell us about the screen" />
      </div>
      <button type="submit" className="btn btn-cyan">
        Send <ArrowRight className="w-4 h-4" />
      </button>
    </form>
  );
}
