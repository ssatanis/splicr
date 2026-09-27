import Link from "next/link";

import { cn } from "@/lib/utils";

const WORDMARK = "/brand/splicr-wordmark.png";

const sizes = {
  sm: "h-5",
  md: "h-6",
  lg: "h-9",
} as const;

/**
 * The SplicR wordmark. The source asset is a transparent mask, tinted with
 * CSS so it takes the exact brand color on any background.
 */
export function Wordmark({
  tone = "ink",
  size = "md",
  className,
}: {
  tone?: "ink" | "white" | "orange";
  size?: keyof typeof sizes;
  className?: string;
}) {
  const color =
    tone === "white" ? "var(--color-white)" : tone === "orange" ? "var(--color-orange-500)" : "var(--color-ink)";
  return (
    <span
      role="img"
      aria-label="SplicR"
      className={cn("inline-block w-auto", sizes[size], className)}
      style={{
        aspectRatio: "478 / 162",
        backgroundColor: color,
        WebkitMaskImage: `url(${WORDMARK})`,
        maskImage: `url(${WORDMARK})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}

export function Logo({
  tone = "dark",
  className,
  href = "/",
  size = "md",
}: {
  tone?: "dark" | "light";
  className?: string;
  href?: string;
  size?: keyof typeof sizes;
}) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center select-none", className)}
      aria-label="SplicR home"
    >
      <Wordmark tone={tone === "light" ? "white" : "ink"} size={size} />
    </Link>
  );
}

/** Small square glyph for the marquee and list bullets. */
export function LogoMark({ className, tone = "orange" }: { className?: string; tone?: "orange" | "white" }) {
  const fill = tone === "white" ? "#ffffff" : "#f87315";
  return (
    <svg viewBox="0 0 24 24" className={cn("h-4 w-4", className)} aria-hidden>
      <rect x="2" y="10" width="8" height="4" rx="1" fill={fill} />
      <rect x="14" y="10" width="8" height="4" rx="1" fill={fill} opacity="0.55" />
      <rect x="10.5" y="4" width="3" height="3" rx="0.6" fill={fill} />
      <rect x="10.5" y="17" width="3" height="3" rx="0.6" fill={fill} opacity="0.7" />
    </svg>
  );
}
