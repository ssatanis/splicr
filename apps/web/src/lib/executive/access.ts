import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { EXECUTIVES, type ExecutiveEmail } from "@/lib/executive/constants";
import { createClient } from "@/lib/supabase/server";

export const EXECUTIVE_SESSION_COOKIE = "splicr_executive_session";
export const EXECUTIVE_SESSION_SECONDS = 15 * 60;

export type ExecutiveIdentity = {
  email: ExecutiveEmail;
  name: string;
  shortName: string;
  userId: string;
  expiresAt: number;
};

export function executiveByEmail(email: string | null | undefined) {
  const normalized = email?.trim().toLowerCase() ?? "";
  if (!(normalized in EXECUTIVES)) return null;
  const executiveEmail = normalized as ExecutiveEmail;
  return { email: executiveEmail, ...EXECUTIVES[executiveEmail] };
}

function signingKey(): string | null {
  return process.env.SUPABASE_SECRET_KEY?.trim() || null;
}

function signature(payload: string): string | null {
  const key = signingKey();
  return key ? createHmac("sha256", key).update(payload).digest("base64url") : null;
}

function equalSignature(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function encode(userId: string, email: ExecutiveEmail, expiresAt: number): string | null {
  const payload = Buffer.from(JSON.stringify({ userId, email, expiresAt }), "utf8").toString("base64url");
  const signed = signature(payload);
  return signed ? `${payload}.${signed}` : null;
}

function decode(value: string | undefined): { userId: string; email: ExecutiveEmail; expiresAt: number } | null {
  if (!value) return null;
  const [payload, actual, extra] = value.split(".");
  if (!payload || !actual || extra) return null;
  const expected = signature(payload);
  if (!expected || !equalSignature(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (
      typeof parsed.userId !== "string" ||
      typeof parsed.email !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now() ||
      !executiveByEmail(parsed.email)
    ) return null;
    return parsed as { userId: string; email: ExecutiveEmail; expiresAt: number };
  } catch {
    return null;
  }
}

export async function markExecutiveVerified(userId: string, email: ExecutiveEmail) {
  const expiresAt = Date.now() + EXECUTIVE_SESSION_SECONDS * 1000;
  const value = encode(userId, email, expiresAt);
  if (!value) throw new Error("Executive session signing is not configured.");
  const store = await cookies();
  store.set(EXECUTIVE_SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/executive",
    maxAge: EXECUTIVE_SESSION_SECONDS,
  });
}

export async function clearExecutiveVerification() {
  const store = await cookies();
  store.delete(EXECUTIVE_SESSION_COOKIE);
}

/**
 * A normal login is deliberately insufficient. Executive access requires a
 * second, short-lived, signed proof created only after a fresh email OTP.
 */
export async function getExecutiveIdentity(): Promise<ExecutiveIdentity | null> {
  const store = await cookies();
  const proof = decode(store.get(EXECUTIVE_SESSION_COOKIE)?.value);
  if (!proof) return null;

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  const email = typeof claims?.email === "string" ? claims.email : null;
  const executive = executiveByEmail(email);
  if (!executive || userId !== proof.userId || executive.email !== proof.email) return null;

  return { ...executive, userId, expiresAt: proof.expiresAt };
}
