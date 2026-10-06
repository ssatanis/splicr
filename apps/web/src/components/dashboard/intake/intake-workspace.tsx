"use client";

/**
 * The two things "new analysis" can mean, told apart before anything else.
 *
 * They are genuinely different workflows with different outcomes, and the old
 * page put them in two panels of unequal size with no statement of the
 * difference, so a researcher could reasonably have thought an accession would
 * land in their screen list. It does not: a reanalysed public study is shared
 * evidence and goes to the Atlas, and a lab's own screen is private to the
 * workspace. The choice is made first, in one control, and each side says where
 * its result goes.
 */
import { Check, FlaskConical, Globe } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

type Mode = "own" | "published";

const CHOICES: { key: Mode; label: string; hint: string; icon: typeof FlaskConical }[] = [
  {
    key: "own",
    label: "My experiment",
    hint: "Upload files for a private workspace analysis.",
    icon: FlaskConical,
  },
  {
    key: "published",
    label: "Published study",
    hint: "Reanalyse a public deposit and share the evidence.",
    icon: Globe,
  },
];

export function IntakeWorkspace({
  own,
  published,
  initial = "own",
}: {
  own: React.ReactNode;
  published: React.ReactNode;
  initial?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initial);

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="What kind of analysis" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {CHOICES.map((choice) => {
          const active = mode === choice.key;
          const Icon = choice.icon;
          return (
            <button
              key={choice.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setMode(choice.key)}
              className={cn(
                "flex items-center gap-3 rounded-sm border px-4 py-4 text-left outline-none transition-colors duration-[var(--dur-2)] focus-visible:ring-2 focus-visible:ring-cyan-500 motion-reduce:transition-none",
                active
                  ? "border-navy/40 bg-navy-tint shadow-sm"
                  : "border-stone-200 bg-white hover:border-stone-200-strong hover:bg-mist-soft/50",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm",
                  active ? "bg-navy text-white" : "bg-mist-soft text-muted",
                )}
                aria-hidden="true"
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{choice.label}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-muted">{choice.hint}</span>
              </span>
              {active && <Check className="h-4 w-4 shrink-0 text-navy" aria-hidden="true"/>}
            </button>
          );
        })}
      </div>

      <div hidden={mode !== "own"}>{own}</div>
      <div hidden={mode !== "published"}>{published}</div>
    </div>
  );
}
