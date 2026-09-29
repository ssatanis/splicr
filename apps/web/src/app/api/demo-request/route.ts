import { NextResponse } from "next/server";

import { EmailNotConfigured, sendDemoRequest, type DemoRequest } from "@/lib/email/send";

/**
 * Receives the Request a Demo form and sends two emails: a confirmation to the
 * person who filled it in, and a notification to the team inbox.
 *
 * The route validates before it sends. Length caps exist because an unbounded
 * string goes straight into an email body, and the honeypot catches the simplest
 * bots without putting a captcha in front of a scientist.
 */

export const runtime = "nodejs";

const LIMITS = { name: 120, email: 200, company: 160, topic: 80, message: 4000 } as const;
const TOPICS = new Set([
  "Blinded evaluation",
  "Research pilot",
  "Core facility",
  "REST integration",
  "Something else",
]);

/** One submission per address per window, held in memory. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 3;
const recent = new Map<string, number[]>();

function rateLimited(key: string) {
  const now = Date.now();
  const hits = (recent.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  recent.set(key, hits);
  if (recent.size > 5000) {
    for (const [k, v] of recent) if (!v.some((t) => now - t < RATE_WINDOW_MS)) recent.delete(k);
  }
  return hits.length > RATE_MAX;
}

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Deliberately permissive: the real check is whether the confirmation lands. */
const looksLikeEmail = (value: string) =>
  /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value) && value.length <= LIMITS.email;

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const body = (payload ?? {}) as Record<string, unknown>;

  // A hidden field a person never sees and never fills in.
  if (str(body.website)) return NextResponse.json({ ok: true }, { status: 202 });

  const name = str(body.name).slice(0, LIMITS.name);
  const email = str(body.email).slice(0, LIMITS.email);
  const company = str(body.company).slice(0, LIMITS.company);
  const topicRaw = str(body.topic).slice(0, LIMITS.topic);
  const message = str(body.message).slice(0, LIMITS.message);

  const missing = [
    !name && "name",
    !email && "email",
    !company && "company",
  ].filter(Boolean) as string[];
  if (missing.length) {
    return NextResponse.json(
      { error: `Please fill in your ${missing.join(", ")}.` },
      { status: 400 },
    );
  }
  if (!looksLikeEmail(email)) {
    return NextResponse.json({ error: "That email address does not look right." }, { status: 400 });
  }

  const topic = TOPICS.has(topicRaw) ? topicRaw : "Something else";

  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  if (rateLimited(`${ip}:${email.toLowerCase()}`)) {
    return NextResponse.json(
      { error: "That went through already. Give it a minute before trying again." },
      { status: 429 },
    );
  }

  const demo: DemoRequest = { name, email, company, topic, message };

  try {
    const outcome = await sendDemoRequest(demo);
    if (!outcome.confirmationId && !outcome.notificationId) {
      console.error("demo-request: both sends failed", outcome.errors);
      return NextResponse.json(
        { error: "We could not send that just now. Please email us directly." },
        { status: 502 },
      );
    }
    if (outcome.errors.length) console.warn("demo-request: partial failure", outcome.errors);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (error instanceof EmailNotConfigured) {
      console.error("demo-request: RESEND_API_KEY missing");
      return NextResponse.json(
        { error: "Email is not configured on this deployment. Please email us directly." },
        { status: 503 },
      );
    }
    console.error("demo-request: unexpected failure", error);
    return NextResponse.json(
      { error: "Something went wrong. Please email us directly." },
      { status: 500 },
    );
  }
}
