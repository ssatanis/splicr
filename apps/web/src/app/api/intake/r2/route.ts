import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentContext, getOrgRole } from "@/lib/data/org";
import { ROLE_RANK } from "@/lib/data/types";
import {
  abortMultipart,
  bucketName,
  completeMultipart,
  createMultipart,
  listMultipartParts,
  r2Configured,
  r2Uri,
  signedPartUrl,
  signedPutUrl,
  R2_MULTIPART_PART_SIZE,
} from "@/lib/intake/r2.server";
import { MAX_FILE_BYTES, storageKey } from "@/lib/intake/shape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("put"),
    screenId: z.string().uuid(),
    name: z.string().min(1).max(500),
    bytes: z.number().int().positive().max(MAX_FILE_BYTES),
    contentType: z.string().max(200).optional(),
  }),
  z.object({
    action: z.literal("multipart"),
    screenId: z.string().uuid(),
    name: z.string().min(1).max(500),
    bytes: z.number().int().positive().max(MAX_FILE_BYTES),
    contentType: z.string().max(200).optional(),
  }),
  z.object({
    action: z.literal("part"),
    key: z.string().min(1),
    uploadId: z.string().min(1),
    partNumber: z.number().int().positive().max(10000),
  }),
  z.object({
    action: z.literal("list"),
    key: z.string().min(1),
    uploadId: z.string().min(1),
  }),
  z.object({
    action: z.literal("complete"),
    key: z.string().min(1),
    uploadId: z.string().min(1),
    parts: z.array(z.object({ PartNumber: z.number().int().positive(), ETag: z.string().min(1) })).min(1),
  }),
  z.object({
    action: z.literal("abort"),
    key: z.string().min(1),
    uploadId: z.string().min(1),
  }),
]);

async function allowed() {
  const context = await getCurrentContext();
  if (!context.user || !context.org) return { ok: false as const, status: 401, error: "Sign in to upload a screen." };
  const role = await getOrgRole(context.org.id, context.user.id);
  if (!role || ROLE_RANK[role] < ROLE_RANK.member) {
    return { ok: false as const, status: 403, error: "Your workspace role cannot upload analysis files." };
  }
  return { ok: true as const, orgId: context.org.id };
}

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

function ownsKey(orgId: string, key: string): boolean {
  return key.startsWith(`${orgId}/`);
}

export async function POST(request: NextRequest) {
  if (!r2Configured()) return fail(503, "Private uploads are not configured for this environment.");

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "That upload request is malformed.");

  const auth = await allowed();
  if (!auth.ok) return fail(auth.status, auth.error);

  try {
    const body = parsed.data;
    if (body.action === "put" || body.action === "multipart") {
      const key = storageKey(auth.orgId, body.screenId, body.name);
      const contentType = body.contentType || "application/octet-stream";
      if (body.action === "put") {
        return NextResponse.json({
          key,
          storageKey: r2Uri(key),
          bucket: bucketName(),
          url: await signedPutUrl(key, contentType),
        }, { headers: { "Cache-Control": "no-store" } });
      }
      const uploadId = await createMultipart(key, contentType);
      return NextResponse.json({
        key,
        storageKey: r2Uri(key),
        bucket: bucketName(),
        uploadId,
        partSize: R2_MULTIPART_PART_SIZE,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    if (!ownsKey(auth.orgId, body.key)) return fail(403, "That upload key is outside your workspace.");

    if (body.action === "part") {
      return NextResponse.json({ url: await signedPartUrl(body.key, body.uploadId, body.partNumber) });
    }
    if (body.action === "list") {
      return NextResponse.json({ parts: await listMultipartParts(body.key, body.uploadId) });
    }
    if (body.action === "complete") {
      await completeMultipart(body.key, body.uploadId, body.parts);
      return NextResponse.json({ ok: true, storageKey: r2Uri(body.key) });
    }
    await abortMultipart(body.key, body.uploadId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[intake/r2] ${error instanceof Error ? error.message : String(error)}`);
    return fail(502, "The upload service could not prepare this upload. Try again.");
  }
}
