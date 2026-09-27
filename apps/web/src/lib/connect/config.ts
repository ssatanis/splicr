/**
 * SplicR Connect: the values the integration snippets are built from.
 *
 * No server-only import here, so the Connect page can render the snippets on
 * the server and the client component can rebuild them the moment a new key is
 * minted. Every builder takes the live origin rather than a hard coded host, so
 * a snippet copied out of the dashboard points at the instance it was copied
 * from.
 */
import type { ApiScope } from "@/lib/data/types";

/** Path of the live REST endpoint. One place, used by the page and the route. */
export const HITS_PATH = "/api/v1/hits";

/** The scope a caller needs for the hits endpoint. */
export const HITS_SCOPE: ApiScope = "hits:read";

/**
 * Scopes offered when minting a key. `API_SCOPES` in lib/data/types holds every
 * value the column accepts; these are the ones that mean something today or in
 * the next endpoint, so the dialog stays short enough to read.
 */
export const CONNECT_SCOPES: readonly ApiScope[] = [
  "atlas:read",
  "hits:read",
  "screens:read",
  "screens:write",
  "outcomes:write",
];

/** Stand-in used until the reader pastes a key of their own. */
export const KEY_PLACEHOLDER = "spk_live_YOUR_KEY";

/** Stand-in used until the workspace has a screen to point at. */
export const SCREEN_PLACEHOLDER = "YOUR_SCREEN_ID";

export interface SnippetInputs {
  /** Scheme and host of this instance, no trailing slash. */
  origin: string;
  /** A real screen id from the workspace, or SCREEN_PLACEHOLDER. */
  screenId: string;
  /** A freshly minted key, or KEY_PLACEHOLDER. */
  apiKey: string;
}

/** The REST URL the curl snippet calls, filters included. */
export function hitsUrl({ origin, screenId }: Pick<SnippetInputs, "origin" | "screenId">): string {
  return `${origin}${HITS_PATH}?screen=${screenId}&max_fdr=0.1&limit=25`;
}

/**
 * A curl that runs as pasted. The FDR filter is there rather than a chance
 * filter because a screen that has been counted and called but not yet scored
 * has an FDR on every row and no chance yet, so this returns rows today.
 */
export function curlSnippet(inputs: SnippetInputs): string {
  return [
    `curl -s "${hitsUrl(inputs)}" \\`,
    `  -H "Authorization: Bearer ${inputs.apiKey}"`,
  ].join("\n");
}
