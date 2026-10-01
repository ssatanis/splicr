/**
 * Where an auth flow is allowed to send somebody afterwards.
 *
 * Every auth route takes a `next` from the query string, and every one of them
 * is a place an attacker can put their own URL: a link to
 * `/login?next=https://elsewhere.example` that lands on a convincing copy of
 * SplicR is a working credential-harvesting page that started on the real
 * domain. So `next` is a path inside this application or it is nothing.
 *
 * Protocol-relative URLs are the case that catches people out: `//elsewhere`
 * starts with a slash and is still another origin.
 */
const DEFAULT = "/dashboard";

export function safeNext(next: string | null | undefined, fallback = DEFAULT): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  if (next.startsWith("/\\")) return fallback;
  return next;
}
