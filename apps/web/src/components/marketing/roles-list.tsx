"use client";

import { ArrowUpRight, ChevronDown } from "lucide-react";
import { useState } from "react";

import { openRoles } from "@/lib/content";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

export function RolesList() {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="divide-y divide-line border-t border-line">
      {openRoles.map((r) => {
        const expanded = open === r.id;
        return (
          <article key={r.id} className="py-8">
            <div className="eyebrow">Areas of interest</div>
            <div className="mt-3 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <h2 className="text-3xl md:text-4xl text-ink font-medium tracking-tight">{r.title}</h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : r.id)}
                  className="icon-btn"
                  aria-label={expanded ? "Collapse role" : "Expand role"}
                >
                  <ChevronDown className={cn("w-4 h-4 transition-transform", expanded && "rotate-180")} />
                </button>
                <a
                  href={`mailto:${site.email}?subject=${encodeURIComponent(`Interest: ${r.title}`)}`}
                  className="btn btn-orange"
                >
                  Discuss opportunities <ArrowUpRight className="w-4 h-4" />
                </a>
              </div>
            </div>
            {expanded && (
              <div className="mt-6 grid md:grid-cols-2 gap-8 text-body">
                <p className="leading-relaxed">{r.summary}</p>
                <ul className="space-y-2">
                  {r.asks.map((a) => (
                    <li key={a} className="flex gap-3">
                      <span className="mt-2 w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
