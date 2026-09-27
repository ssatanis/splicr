/**
 * SplicR Connect: the values the integration snippets are built from, and the
 * catalogue of what an agent can call.
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

/** Where the MCP bridge will answer. Not serving yet, said plainly in the UI. */
export const MCP_PATH = "/api/mcp";

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

export type ToolStatus = "live" | "planned";

export interface ConnectTool {
  name: string;
  summary: string;
  scope: ApiScope;
  status: ToolStatus;
  /** Arguments an agent passes, written the way the tool schema reads. */
  args: string;
  /** The HTTP call behind the tool, once it is serving. */
  endpoint: string;
}

/**
 * What an agent can call. `status` is the honest part: only the hits tool has an
 * endpoint behind it today, and the table says so rather than implying a
 * finished surface.
 */
export const CONNECT_TOOLS: readonly ConnectTool[] = [
  {
    name: "splicr_screen_hits",
    summary:
      "Scored hits for one of your screens, with artifact flags. Filter by FDR, by calibrated chance and by direction.",
    scope: "hits:read",
    status: "live",
    args: "screen, max_fdr, min_chance, direction, verdict, limit, offset",
    endpoint: `GET ${HITS_PATH}`,
  },
  {
    name: "splicr_screen_summary",
    summary:
      "One screen's design, library call, QC verdict and run state, without pulling the hit table.",
    scope: "screens:read",
    status: "planned",
    args: "screen",
    endpoint: "GET /api/v1/screens/{id}",
  },
  {
    name: "splicr_gene_history",
    summary:
      "A gene's hit and validation record across the Atlas, so an agent can tell a new finding from a frequent hitter.",
    scope: "atlas:read",
    status: "planned",
    args: "symbol",
    endpoint: "GET /api/v1/genes/{symbol}",
  },
  {
    name: "splicr_similar_screens",
    summary:
      "Public screens closest to a described experiment, ranked by similarity, for context before a screen is run.",
    scope: "atlas:read",
    status: "planned",
    args: "description, limit",
    endpoint: "POST /api/v1/atlas/similar",
  },
  {
    name: "splicr_log_outcome",
    summary:
      "Write a validation result back against a hit, which is what recalibrates the score for everybody.",
    scope: "outcomes:write",
    status: "planned",
    args: "screen, gene, result, assay, effect_size, notes",
    endpoint: "POST /api/v1/outcomes",
  },
];

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

/** The one-liner that registers the bridge with Claude Code. */
export function claudeMcpSnippet({ origin, apiKey }: SnippetInputs): string {
  return [
    `claude mcp add --transport http splicr ${origin}${MCP_PATH} \\`,
    `  --header "Authorization: Bearer ${apiKey}"`,
  ].join("\n");
}

/** The same registration as a checked-in .mcp.json block. */
export function mcpJsonSnippet({ origin, apiKey }: SnippetInputs): string {
  return JSON.stringify(
    {
      mcpServers: {
        splicr: {
          type: "http",
          url: `${origin}${MCP_PATH}`,
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      },
    },
    null,
    2,
  );
}
