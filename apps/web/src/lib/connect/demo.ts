/**
 * Read-only stand-in rows for the Connect page in demo mode.
 *
 * A demo visitor has no session and therefore no workspace, so `listApiKeys`
 * returns nothing for them. Rather than show an empty table that reads as though
 * keys were missing, the page renders these and labels them as demo data in the
 * card subtitle. Nothing here is a real credential: the prefixes are the visible
 * first twelve characters a real row would carry, and there is no plaintext key
 * and no hash anywhere, because the demo cannot authenticate anything.
 *
 * Timestamps are fixed strings rather than offsets from `Date.now()`, so the
 * server render and the client hydration agree.
 */
import type { ApiKey } from "@/lib/data/types";

export const DEMO_API_KEYS: readonly ApiKey[] = [
  {
    id: "demo-key-notebook",
    name: "Lab notebook agent",
    key_prefix: "spk_live_7f3",
    scopes: ["atlas:read", "hits:read"],
    created_by: null,
    created_at: "2026-09-12T09:20:00.000Z",
    last_used_at: "2026-09-27T06:05:00.000Z",
    expires_at: null,
    revoked_at: null,
    status: "active",
  },
  {
    id: "demo-key-pipeline",
    name: "Nightly outcome sync",
    key_prefix: "spk_live_c91",
    scopes: ["hits:read", "screens:read", "outcomes:write"],
    created_by: null,
    created_at: "2026-08-30T14:02:00.000Z",
    last_used_at: "2026-09-26T23:14:00.000Z",
    expires_at: null,
    revoked_at: null,
    status: "active",
  },
  {
    id: "demo-key-rotated",
    name: "Rotation, old key",
    key_prefix: "spk_live_2ad",
    scopes: ["atlas:read"],
    created_by: null,
    created_at: "2026-06-04T11:45:00.000Z",
    last_used_at: "2026-08-29T08:31:00.000Z",
    expires_at: null,
    revoked_at: "2026-08-30T14:03:00.000Z",
    status: "revoked",
  },
];
