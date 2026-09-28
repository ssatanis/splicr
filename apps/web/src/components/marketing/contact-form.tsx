"use client";

import { ArrowRight } from "lucide-react";
import { useState } from "react";

import { site } from "@/lib/site";

const topics = ["Blinded evaluation", "Research pilot", "Core facility", "REST integration", "Something else"];

export function ContactForm() {
  const [draftOpened, setDraftOpened] = useState(false);
  const [topic, setTopic] = useState(topics[0]);


  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const body = [`Name: ${data.get("name")}`, `Lab or company: ${data.get("company")}`, `Reply email: ${data.get("email")}`, "", String(data.get("message") ?? "")].join("\n");
        window.location.href = `mailto:${site.email}?subject=${encodeURIComponent(`SplicR: ${topic}`)}&body=${encodeURIComponent(body)}`;
        setDraftOpened(true);
      }}
    >
      <p className="text-sm text-body">This opens a draft in your email app. Nothing is submitted by this website; review and send the email yourself. You can also email <a className="underline" href={`mailto:${site.email}`}>{site.email}</a> directly. Do not include private screen data in an initial inquiry.</p>
      {draftOpened && <p role="status" className="text-sm text-ink">Email draft requested. If your email app did not open, use the address above. No delivery confirmation is available here.</p>}
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
        <textarea id="message" name="message" className="underline-input min-h-[80px] resize-y" placeholder="Tell us about the screen" />
      </div>
      <button type="submit" className="btn btn-cyan">
        Open email draft <ArrowRight className="w-4 h-4" />
      </button>
    </form>
  );
}
