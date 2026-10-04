/**
 * Prediction receipts, in the console.
 *
 * A receipt frozen here and verified by the engine is one hash or it is
 * nothing, so this file's only real job is to serialise a payload to exactly
 * the bytes `engine/splicr/validation/receipts.py::canonical_bytes` produces.
 * That is Python's `json.dumps(sort_keys=True, indent=2, ensure_ascii=False)`
 * plus a trailing newline, which `JSON.stringify` does not reproduce on its
 * own: it differs on key order, on which characters it escapes, and on how it
 * renders some numbers.
 *
 * `apps/web/tests/receipt-canonical.test.mjs` replays the engine's own bytes
 * for eleven payloads chosen for exactly those differences. A divergence is a
 * failing test, not a receipt nobody can verify.
 */

import { sha256Hex } from "@/lib/intake/sha256-core";

/**
 * Python's string escaping, which is not JavaScript's.
 *
 * `json.dumps(ensure_ascii=False)` escapes only the two mandatory characters,
 * the five short forms, and anything below U+0020 as `\uXXXX`. It leaves the
 * solidus alone (so a DOI stays readable) and passes every other code point
 * through as UTF-8. `JSON.stringify` agrees on most of this but not on lone
 * surrogates, so those are escaped explicitly.
 */
function pythonString(value: string): string {
  let out = '"';
  for (const char of value) {
    const code = char.codePointAt(0) as number;
    switch (char) {
      case '"':
        out += '\\"';
        continue;
      case "\\":
        out += "\\\\";
        continue;
      case "\n":
        out += "\\n";
        continue;
      case "\r":
        out += "\\r";
        continue;
      case "\t":
        out += "\\t";
        continue;
      case "\b":
        out += "\\b";
        continue;
      case "\f":
        out += "\\f";
        continue;
      default:
        break;
    }
    if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else if (code >= 0xd800 && code <= 0xdfff) {
      // A lone surrogate is not valid UTF-8. Python writes it escaped; so do we.
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      out += char;
    }
  }
  return `${out}"`;
}

/**
 * Python's number rendering.
 *
 * `repr` for a float, which is the shortest string that round-trips — the same
 * rule JavaScript's `Number.prototype.toString` uses — except that Python
 * always writes a float with a decimal point or an exponent, so `1.0` does not
 * become `1`. Integers are written as integers.
 *
 * NaN and the infinities are refused rather than rendered. Python's
 * `allow_nan=False` refuses them too, and a receipt containing one could not be
 * re-read by the engine.
 */
/** JavaScript integers are exact to 2**53; so is the engine's receipt limit. */
const EXACT_INTEGER_LIMIT = 2 ** 53;

function pythonNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new ReceiptError(
      `a receipt cannot carry ${String(value)}: the engine refuses it on read`,
    );
  }
  if (Number.isInteger(value)) {
    if (Math.abs(value) > EXACT_INTEGER_LIMIT) {
      throw new ReceiptError(
        "a receipt cannot carry a whole number larger than 2**53: the two " +
          "languages would not agree on its bytes",
      );
    }
    // The engine normalises a whole-valued float to an integer before
    // serialising, so 1.0 and 1 are one quantity and hash alike. -0 is the
    // same quantity as 0 and is written the same way.
    return String(value === 0 ? 0 : value);
  }
  const text = String(value);
  // JavaScript writes exponents as 1e-9; Python as 1e-09.
  return text.replace(/e([+-])(\d)$/, "e$10$2");
}

export class ReceiptError extends Error {}

/** Keys that look like an outcome, refused at any depth. See receipts.py. */
const FORBIDDEN = new Set([
  "result",
  "results",
  "outcome",
  "outcomes",
  "validated",
  "failed",
  "label",
  "labels",
  "truth",
  "ground_truth",
  "observed",
  "answer",
  "answers",
]);

function assertNoOutcomes(node: unknown, where = "payload"): void {
  if (Array.isArray(node)) {
    node.forEach((value, index) => assertNoOutcomes(value, `${where}[${index}]`));
    return;
  }
  if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (FORBIDDEN.has(key.trim().toLowerCase())) {
        throw new ReceiptError(
          `${where}.${key} looks like an outcome. A prediction receipt is written before the answer exists and cannot carry one.`,
        );
      }
      assertNoOutcomes(value, `${where}.${key}`);
    }
  }
}

function render(node: unknown, indent: number): string {
  const pad = " ".repeat(indent);
  const inner = " ".repeat(indent + 2);
  if (node === null || node === undefined) return "null";
  if (typeof node === "boolean") return node ? "true" : "false";
  if (typeof node === "number") return pythonNumber(node);
  if (typeof node === "string") return pythonString(node);
  if (Array.isArray(node)) {
    if (node.length === 0) return "[]";
    const items = node.map((item) => `${inner}${render(item, indent + 2)}`);
    return `[\n${items.join(",\n")}\n${pad}]`;
  }
  if (typeof node === "object") {
    // Python sorts keys by code point, which is what Array#sort does for
    // strings. "10" sorts before "2", in both.
    const keys = Object.keys(node as Record<string, unknown>).sort();
    if (keys.length === 0) return "{}";
    const items = keys.map(
      (key) =>
        `${inner}${pythonString(key)}: ${render((node as Record<string, unknown>)[key], indent + 2)}`,
    );
    return `{\n${items.join(",\n")}\n${pad}}`;
  }
  throw new ReceiptError(`a receipt cannot carry a ${typeof node}`);
}

/**
 * One byte string for one payload, for ever, identical to the engine's.
 *
 * A hash nobody can re-derive is not a commitment, which is why this is pinned
 * by a test against the engine's own output rather than assumed to agree.
 */
export function canonicalBytes(payload: unknown): string {
  return `${render(payload, 0)}\n`;
}

export function receiptHash(payload: unknown): string {
  assertNoOutcomes(payload);
  return sha256Hex(new TextEncoder().encode(canonicalBytes(payload)));
}

export const RECEIPT_SCHEMA = "splicr.validation-receipt.v1";

export interface ReceiptCandidate {
  gene: string;
  rank: number | null;
  score: number | null;
  probability: number | null;
  question: string | null;
  evidence: Record<string, unknown>;
}

export interface ReceiptInput {
  roundId: string;
  createdUtc: string;
  screen: Record<string, unknown>;
  /** The whole universe the prediction ranked, never just the picks. */
  candidates: ReceiptCandidate[];
  validationSet: Record<string, unknown>;
  rankings: Record<string, unknown>;
  model: Record<string, unknown>;
  calibration: Record<string, unknown> | null;
  coverage: Record<string, unknown>;
  endpoint: string | null;
  laboratoryThreshold: number | null;
  provenance: Record<string, unknown>;
}

/**
 * Assemble a receipt payload. There is no outcome argument, and none is
 * accepted: the payload is searched for one at any depth before it is hashed.
 */
export function buildReceipt(input: ReceiptInput): {
  payload: Record<string, unknown>;
  sha256: string;
  bytes: string;
} {
  if (!input.roundId) throw new ReceiptError("a receipt needs a round id");
  if (input.candidates.length === 0) {
    throw new ReceiptError("a receipt needs the candidate universe it ranked");
  }
  const genes = input.candidates.map((c) => c.gene);
  if (genes.some((gene) => !gene)) {
    throw new ReceiptError("every candidate in the universe needs a gene symbol");
  }
  if (new Set(genes).size !== genes.length) {
    throw new ReceiptError("the candidate universe contains the same gene twice");
  }

  const payload: Record<string, unknown> = {
    schema: RECEIPT_SCHEMA,
    round_id: input.roundId,
    created_utc: input.createdUtc,
    screen: input.screen,
    candidates: input.candidates.map((c) => ({
      gene: c.gene,
      rank: c.rank,
      score: c.score,
      probability: c.probability,
      question: c.question,
      evidence: c.evidence,
    })),
    validation_set: input.validationSet,
    rankings: input.rankings,
    model: input.model,
    calibration: input.calibration,
    coverage: input.coverage,
    endpoint: input.endpoint,
    laboratory_threshold: input.laboratoryThreshold,
    provenance: input.provenance,
    timestamp_trust:
      "local content commitment; an independent custodian must retain the hash for this to evidence timing",
  };
  assertNoOutcomes(payload);
  const bytes = canonicalBytes(payload);
  return { payload, sha256: sha256Hex(new TextEncoder().encode(bytes)), bytes };
}
