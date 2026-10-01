import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * What a surface shows when a real workspace genuinely has nothing in it yet.
 *
 * A new laboratory used to meet a dashboard of dashes: empty tables, zero
 * counts, "no data" three times a page. Each of those is accurate and none of
 * them is useful, and together they read as a product that is broken rather
 * than a workspace that is new.
 *
 * So an empty surface says what belongs there and offers the one action that
 * puts it there. Two rules keep that honest:
 *
 *  - It is guidance, never data. Nothing here invents a screen, a count or a
 *    hit to make the page look populated.
 *  - The action is only offered when it works. A suggestion that leads to a
 *    control that is not built yet is worse than an empty table, because the
 *    reader has now been sent somewhere for nothing.
 *
 * This is for an empty workspace. A read that failed is a different thing and
 * says so: see the error states, which never claim a workspace is empty.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon?: LucideIcon;
  /** What belongs here, as a thing to do. "Run your first screen". */
  title: string;
  /** One sentence on how. */
  body: string;
  action?: { label: string; href: string };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-1 rounded-xl border border-line bg-white px-5 py-6",
        className,
      )}
    >
      {Icon && (
        <span
          className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-navy-tint text-navy"
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" strokeWidth={1.8} />
        </span>
      )}
      <p className="text-[14px] font-medium text-ink">{title}</p>
      <p className="max-w-[60ch] text-[13px] leading-snug text-muted">{body}</p>
      {action && (
        <Link href={action.href} className="btn btn-navy btn-sm mt-3">
          {action.label}
        </Link>
      )}
    </div>
  );
}
