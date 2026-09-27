import type { Citation } from "@/lib/content";
import { cn } from "@/lib/utils";

/**
 * A source line that keeps the surrounding font, size and color. Only the
 * reference itself is underlined, so it reads as text first and a link second.
 */
export function Cite({
  cite,
  className,
  prefix,
}: {
  cite: Citation;
  className?: string;
  prefix?: string;
}) {
  return (
    <span className={cn("text-inherit", className)}>
      {prefix ? `${prefix} ` : ""}
      <a
        href={cite.href}
        target="_blank"
        rel="noreferrer"
        title={cite.note}
        className="text-inherit underline decoration-current/35 underline-offset-2 hover:decoration-current transition-[text-decoration-color]"
      >
        {cite.text}
      </a>
    </span>
  );
}
