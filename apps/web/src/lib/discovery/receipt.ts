import { createHash } from "node:crypto";
import type { BatchPlan } from "./model";
import type { DiscoveryDocument } from "./schema";

/** Canonical JSON is shared by imports, export integrity checks and frozen batches. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("A receipt cannot contain a nonfinite measurement.");
  if (["string", "number", "boolean"].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  throw new Error("Unsupported value in a receipt.");
}
export const sha256 = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");

export interface DiscoveryReceipt {
  screen_id: string;
  run_id: string;
  comparison_id: string;
  input_id: string;
  input_sha256: string;
  evidence: DiscoveryDocument;
  endpoint: Record<string, unknown>;
  plan: BatchPlan;
  // Cryptographic blind IDs, generated server side. Frozen before outcomes.
  blind_ids: Record<string, string>;
}
