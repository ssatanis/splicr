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
import { FlaskConical, Globe } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

type Mode = "own" | "published";

const CHOICES: { key: Mode; label: string; hint: string; icon: typeof FlaskConical }[] = [
  {
    key: "own",
    label: "My experiment",
    hint: "Your reads or counts. Stays private to this workspace.",
    icon: FlaskConical,
  },
  {
    key: "published",
    label: "Published study",
    hint: "SplicR reanalyses the deposit. Result is shared evidence.",
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
                "flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left outline-none transition-colors duration-[var(--dur-2)] focus-visible:ring-2 focus-visible:ring-cyan-500 motion-reduce:transition-none",
                active
                  ? "border-cyan-500 bg-cyan-50/60"
                  : "border-line bg-white hover:border-line-strong hover:bg-mist-soft/50",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                  active ? "bg-cyan-500 text-white" : "bg-mist-soft text-muted",
                )}
                aria-hidden="true"
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{choice.label}</span>
                <span className="block text-[11.5px] leading-snug text-muted">{choice.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div>{mode === "own" ? own : published}</div>
    </div>
  );
}
