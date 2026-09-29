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
  "hits:read",
  "atlas:read",
  "screens:read",
  "screens:write",
  "outcomes:write",
];

/**
 * The scopes an endpoint actually checks today. `hits:read` gates
 * GET /api/v1/hits and nothing else does yet, so a key holding only the other
 * scopes reads nothing. The create dialog says so beside each of them instead of
 * offering a permission that does nothing as though it were one.
 */
export const LIVE_SCOPES: readonly ApiScope[] = ["hits:read"];

export function scopeIsLive(scope: ApiScope): boolean {
  return LIVE_SCOPES.includes(scope);
}

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


// ---------------------------------------------------------------------------
// Other languages
// ---------------------------------------------------------------------------

export type SnippetLanguage = "curl" | "python" | "r" | "javascript";

export const SNIPPET_LANGUAGES: readonly { value: SnippetLanguage; label: string }[] = [
  { value: "curl", label: "curl" },
  { value: "python", label: "Python" },
  { value: "r", label: "R" },
  { value: "javascript", label: "JavaScript" },
];

/** Only characters a screen id can hold, so an id can never break out of a quoted string. */
function safeId(value: string): string {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : SCREEN_PLACEHOLDER;
}

/**
 * A key is read from the environment in every language but curl, so that the
 * snippet a reader saves to a notebook or commits to a repository does not carry
 * a credential. The one line that sets it is shown as a comment, with the key in
 * it only while the reader still has the freshly minted one on screen.
 */
function envLine(inputs: SnippetInputs): string {
  return `export SPLICR_API_KEY="${inputs.apiKey}"`;
}

export function pythonSnippet(inputs: SnippetInputs): string {
  const id = safeId(inputs.screenId);
  return [
    `# In your shell first:  ${envLine(inputs)}`,
    "import os",
    "import requests",
    "",
    `URL = "${inputs.origin}${HITS_PATH}"`,
    'KEY = os.environ["SPLICR_API_KEY"]',
    "",
    "hits, offset = [], 0",
    "while offset is not None:",
    "    response = requests.get(",
    "        URL,",
    '        headers={"Authorization": f"Bearer {KEY}"},',
    `        params={"screen": "${id}", "max_fdr": 0.1, "limit": 500, "offset": offset},`,
    "        timeout=30,",
    "    )",
    "    response.raise_for_status()",
    "    page = response.json()",
    '    hits += page["hits"]',
    '    offset = page["paging"]["next_offset"]  # None on the last page',
    "",
    'print(len(hits), "hits")  # chance_real is a stored model output, not a probability',
  ].join("\n");
}

export function rSnippet(inputs: SnippetInputs): string {
  const id = safeId(inputs.screenId);
  return [
    `# In your shell first:  ${envLine(inputs)}`,
    "library(httr2)",
    "",
    'key <- Sys.getenv("SPLICR_API_KEY")',
    "hits <- list()",
    "offset <- 0",
    "repeat {",
    `  page <- request("${inputs.origin}${HITS_PATH}") |>`,
    '    req_headers(Authorization = paste("Bearer", key)) |>',
    `    req_url_query(screen = "${id}", max_fdr = 0.1, limit = 500, offset = offset) |>`,
    "    req_perform() |>",
    "    resp_body_json()",
    "  hits <- c(hits, page$hits)",
    "  if (is.null(page$paging$next_offset)) break",
    "  offset <- page$paging$next_offset",
    "}",
    "",
    "length(hits)  # chance_real is a stored model output, not a probability",
  ].join("\n");
}

export function javascriptSnippet(inputs: SnippetInputs): string {
  const id = safeId(inputs.screenId);
  return [
    `// In your shell first:  ${envLine(inputs)}   (Node 18 or later)`,
    `const url = new URL("${inputs.origin}${HITS_PATH}");`,
    `url.search = new URLSearchParams({ screen: "${id}", max_fdr: "0.1", limit: "500" });`,
    "",
    "const response = await fetch(url, {",
    "  headers: { Authorization: `Bearer ${process.env.SPLICR_API_KEY}` },",
    "});",
    "if (!response.ok) {",
    "  const { error } = await response.json();",
    "  throw new Error(`${response.status}: ${error.message}`);",
    "}",
    "const { hits, paging } = await response.json();",
    "console.log(hits.length, \"of\", paging.total, \"hits\"); // paging.next_offset is null on the last page",
  ].join("\n");
}

export function snippetFor(language: SnippetLanguage, inputs: SnippetInputs): string {
  switch (language) {
    case "python":
      return pythonSnippet(inputs);
    case "r":
      return rSnippet(inputs);
    case "javascript":
      return javascriptSnippet(inputs);
    default:
      return curlSnippet({ ...inputs, screenId: safeId(inputs.screenId) });
  }
}

// ---------------------------------------------------------------------------
// The reference, written once and checked against the route
// ---------------------------------------------------------------------------

export interface ReferenceRow {
  name: string;
  type: string;
  note: string;
}

/**
 * Query parameters of GET /api/v1/hits. A test reads the route's own schema and
 * fails when this list and that schema disagree, so the page cannot describe a
 * parameter the endpoint does not take or omit one it does.
 */
export const HITS_PARAMS: readonly ReferenceRow[] = [
  { name: "screen", type: "uuid, required", note: "The screen to read. It must belong to the key's workspace." },
  { name: "max_fdr", type: "number 0 to 1", note: "Keep hits with a recorded FDR at or below this." },
  { name: "min_chance", type: "number 0 to 1", note: "Filters the stored model output. It is not a probability." },
  { name: "direction", type: "depleted | enriched", note: "Which arm of the comparison." },
  { name: "verdict", type: "real_new | real_known | real_generic | artifact | uncertain", note: "The engine's stored call, where one was recorded." },
  { name: "limit", type: "whole number 1 to 500", note: "Rows per page. Defaults to 50." },
  { name: "offset", type: "whole number 0 or more", note: "Rows to skip. Use paging.next_offset." },
];

/** Fields of each hit in the response, checked the same way against real output. */
export const HITS_FIELDS: readonly ReferenceRow[] = [
  { name: "id", type: "string", note: "The hit's id." },
  { name: "gene", type: "string", note: "Gene symbol." },
  { name: "direction", type: "string", note: "depleted or enriched." },
  { name: "verdict", type: "string | null", note: "Stored engine call. Null when none was recorded." },
  { name: "comparison", type: "string | null", note: "The comparison the statistics come from." },
  { name: "lfc", type: "number | null", note: "Log fold change." },
  { name: "fdr", type: "number | null", note: "Recorded FDR. Small values keep their exponent." },
  { name: "p_value", type: "number | null", note: "Recorded p-value." },
  { name: "n_guides", type: "integer | null", note: "Guides targeting the gene." },
  { name: "n_good_guides", type: "integer | null", note: "Guides that agreed with the gene-level call." },
  { name: "cn_corrected", type: "boolean | null", note: "Whether a copy-number correction was applied." },
  { name: "chance_real", type: "number | null", note: "Stored model output, uncalibrated. Not a validation probability." },
  { name: "score_interpretation", type: "string", note: "Always stored_uncalibrated_model_output. It says what chance_real is." },
  { name: "chance_interval", type: "[number|null, number|null] | null", note: "Stored bounds on that output. Not a confidence interval." },
  { name: "chance_interval_interpretation", type: "string", note: "Always stored_uncalibrated_bounds." },
  { name: "validation_probability", type: "null", note: "Always null: no calibrated probability exists." },
  { name: "validation_probability_interval", type: "null", note: "Always null, for the same reason." },
  { name: "novelty", type: "number | null", note: "Stored novelty score." },
  { name: "atlas", type: "{ hit_count, screen_count, hit_rate }", note: "How often the Atlas records this gene as a hit, with its denominator." },
  { name: "model_version", type: "string | null", note: "Which model produced the stored output." },
  { name: "reason", type: "string | null", note: "The stored one-line reason." },
  { name: "flags", type: "array", note: "Artifact flags with severity and message." },
];

export const HITS_STATUS: readonly { code: string; meaning: string }[] = [
  { code: "200", meaning: "Hits, with paging." },
  { code: "400", meaning: "A filter is not a number or not in its list. The message names it." },
  { code: "401", meaning: "No key, or a key that is unknown, revoked or expired." },
  { code: "403", meaning: "The key is live but does not carry hits:read." },
  { code: "404", meaning: "The screen belongs to another workspace, or does not exist." },
  { code: "500", meaning: "The database refused the read. Try again." },
  { code: "503", meaning: "This instance has no database configured." },
];
