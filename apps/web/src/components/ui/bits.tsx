import { ArrowRight, ArrowUpRight, ChevronDown, Play } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export function PlayButton({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/40 backdrop-blur border border-white/60 text-white shadow-float",
        className,
      )}
      aria-hidden
    >
      <Play className="w-5 h-5 fill-white" />
    </span>
  );
}

export function MarkerPill({
  value,
  tone = "teal",
  className,
  flip = false,
}: {
  value: string;
  tone?: "teal" | "cyan";
  className?: string;
  flip?: boolean;
}) {
  const bg = tone === "cyan" ? "bg-cyan-500" : "bg-teal-800";
  return (
    <div className={cn("absolute flex flex-col items-center", flip && "flex-col-reverse", className)} aria-hidden>
      <span className={cn("rounded-xl px-3.5 py-2 text-white text-sm font-medium shadow-float", bg)}>
        {value}
      </span>
      <span className={cn("w-0.5 h-3", bg)} />
      <span className={cn("w-4 h-4 rounded-full border-[3px] border-white", bg)} />
    </div>
  );
}

export function LinkButton({
  href,
  children,
  tone = "orange",
  size,
  icon = "arrow",
  className,
}: {
  href: string;
  children: React.ReactNode;
  tone?: "orange" | "cyan" | "teal" | "white" | "ghost";
  size?: "sm" | "lg";
  icon?: "arrow" | "up" | "none" | "play";
  className?: string;
}) {
  const Icon = icon === "arrow" ? ArrowRight : icon === "up" ? ArrowUpRight : icon === "play" ? Play : null;
  return (
    <Link
      href={href}
      className={cn("btn", `btn-${tone}`, size === "sm" && "btn-sm", size === "lg" && "btn-lg", className)}
    >
      {icon === "play" && Icon && <Icon className="w-4 h-4 fill-current" />}
      {children}
      {icon !== "play" && Icon && <Icon className="w-4 h-4" strokeWidth={2} />}
    </Link>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  body,
  align = "left",
  tone = "light",
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  body?: React.ReactNode;
  align?: "left" | "center";
  tone?: "light" | "dark";
  className?: string;
}) {
  return (
    <div className={cn(align === "center" && "text-center mx-auto", "max-w-3xl", className)}>
      {eyebrow && <div className={cn("eyebrow mb-4", tone === "dark" && "text-cyan-400")}>{eyebrow}</div>}
      <h2 className={cn("display text-4xl md:text-5xl lg:text-6xl", tone === "dark" && "text-white")}>{title}</h2>
      {body && (
        <p className={cn("mt-6 text-lg leading-relaxed", tone === "dark" ? "text-white/90" : "text-body")}>{body}</p>
      )}
    </div>
  );
}

export function Chevron({ className }: { className?: string }) {
  return <ChevronDown className={cn("w-4 h-4", className)} strokeWidth={1.8} />;
}
