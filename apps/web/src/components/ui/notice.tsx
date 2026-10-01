import { AlertCircle, CheckCircle2, Info } from "lucide-react";

import type { Problem } from "@/lib/errors";
import { cn } from "@/lib/utils";

/**
 * One way of saying something went wrong, or went right.
 *
 * It is a line of text with a small mark beside it, not a red box. A large
 * coloured panel makes an ordinary, recoverable failure look like a system
 * fault, and a researcher who has seen three of them stops reading the fourth.
 * The tone is carried by the icon and a restrained tint, never by colour alone:
 * the wording says what happened whether or not the reader can see the tint.
 */
export function Notice({
  tone = "error",
  title,
  action,
  reference,
  className,
  children,
}: {
  tone?: "error" | "success" | "info";
  /** One sentence: what happened, and what it did or did not change. */
  title: string;
  /** What to do next, when there is something. */
  action?: string;
  /** A short reference the reader can quote when asking for help. Shown only
   *  when the server produced one, never invented. */
  reference?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertCircle;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-snug",
        tone === "error" && "border-red-200 bg-red-50/60 text-red-900",
        tone === "success" && "border-line bg-navy-tint text-ink",
        tone === "info" && "border-line bg-mist-soft text-body",
        className,
      )}
    >
      <Icon className="mt-px h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {action && <p className="mt-0.5 opacity-80">{action}</p>}
        {children}
        {reference && (
          <p className="num mt-1.5 text-[11px] opacity-60">Reference {reference}</p>
        )}
      </div>
    </div>
  );
}

/** The same thing, given a `Problem` straight from `lib/errors`. */
export function ProblemNotice({ problem, className }: { problem: Problem; className?: string }) {
  return <Notice tone="error" title={problem.message} action={problem.action} className={className} />;
}
