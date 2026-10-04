import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number, opts: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat("en-US", opts).format(n);
}

export function formatCompact(n: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

export function formatPercent(p: number, digits = 0) {
  return `${(p * 100).toFixed(digits)}%`;
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * How a workspace is greeted on the overview.
 *
 * Most workspaces are named for the group that runs them, and most of those
 * names already carry the word: "Franklin Lab" greeted as "Franklin Lab Lab"
 * reads like a bug. So the noun is only appended when the name does not already
 * end in one of its own.
 *
 * The signup trigger also creates personal workspaces called "<name>'s
 * workspace", which must not become a lab either; "workspace" is in the list for
 * that reason rather than because anyone types it.
 */
const WORKSPACE_NOUN = /\b(lab|labs|laboratory|laboratories|group|centre|center|institute|institution|consortium|core|facility|unit|workspace|team|collective|foundation|society|network)\s*$/i;

export function labGreeting(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Welcome back";
  return WORKSPACE_NOUN.test(trimmed)
    ? `Welcome to ${trimmed}`
    : `Welcome to ${trimmed} Lab`;
}
