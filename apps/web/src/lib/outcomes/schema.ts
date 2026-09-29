/**
 * What an outcome form may submit, and what a person is told when it is wrong.
 *
 * One schema, used by the browser to show the message next to the field and by
 * the server action to refuse the write. The browser's copy is a courtesy; the
 * server's is the rule. Both read the same code so they cannot disagree about
 * what a valid gene symbol is.
 *
 * Everything arrives as text from a form, so numbers are parsed here rather than
 * coerced by the framework, and an empty box is a missing value, never a zero.
 * A recorded effect size of 0 is a measurement; a blank one is not.
 */
import { z } from "zod";

import { OUTCOME_RESULTS, type OutcomeResult } from "./model";

/** Human, mouse, rat and construct symbols: letters, digits and . _ - @, starting with one. */
export const GENE_SYMBOL = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,39}$/;

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} can be at most ${max} characters.`)
    .transform((value) => (value === "" ? null : value));

export const outcomeFormSchema = z.object({
  screenId: z.string().trim().min(1, "Choose the screen this gene came from.").max(64, "That screen id is too long."),
  gene: z
    .string()
    .trim()
    .min(1, "Enter the gene symbol.")
    .regex(GENE_SYMBOL, "A gene symbol uses letters and digits, and may include . _ - or @."),
  result: z.enum(OUTCOME_RESULTS, "Choose what the assay found."),
  assay: optionalText(120, "The assay name"),
  nGuides: z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === "") return null;
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        ctx.addIssue({ code: "custom", message: "Guides used must be a whole number from 1 to 100." });
        return z.NEVER;
      }
      return n;
    }),
  effectSize: z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === "") return null;
      const n = Number(value);
      if (!Number.isFinite(n) || Math.abs(n) > 1e6) {
        ctx.addIssue({ code: "custom", message: "Effect size must be a number." });
        return z.NEVER;
      }
      return n;
    }),
  notes: optionalText(2000, "Notes"),
  evidenceUrl: z
    .string()
    .trim()
    .max(500, "The link can be at most 500 characters.")
    .transform((value, ctx) => {
      if (value === "") return null;
      try {
        const url = new URL(value);
        // Only web links: a stored javascript: or data: URL would be rendered as
        // a link in the table and clicked by a teammate.
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("scheme");
        return url.toString();
      } catch {
        ctx.addIssue({ code: "custom", message: "Enter a full web address, for example https://example.org/notebook/12." });
        return z.NEVER;
      }
    }),
});

export type OutcomeFormValues = z.output<typeof outcomeFormSchema>;
export type OutcomeFormField = keyof OutcomeFormValues;

/** The same fields as the form holds them: all text. */
export interface OutcomeDraft {
  screenId: string;
  gene: string;
  result: OutcomeResult | "";
  assay: string;
  nGuides: string;
  effectSize: string;
  notes: string;
  evidenceUrl: string;
}

export const EMPTY_DRAFT: OutcomeDraft = {
  screenId: "",
  gene: "",
  result: "",
  assay: "",
  nGuides: "",
  effectSize: "",
  notes: "",
  evidenceUrl: "",
};

export type ParseOutcome =
  | { ok: true; value: OutcomeFormValues }
  | { ok: false; errors: Partial<Record<OutcomeFormField, string>> };

/** Anything in, a value or a per-field message out. Never throws. */
export function parseOutcomeDraft(raw: unknown): ParseOutcome {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const text = (key: string) => (typeof source[key] === "string" ? (source[key] as string) : "");
  const parsed = outcomeFormSchema.safeParse({
    screenId: text("screenId"),
    gene: text("gene"),
    result: text("result"),
    assay: text("assay"),
    nGuides: text("nGuides"),
    effectSize: text("effectSize"),
    notes: text("notes"),
    evidenceUrl: text("evidenceUrl"),
  });
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: Partial<Record<OutcomeFormField, string>> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as OutcomeFormField | undefined;
    if (key && errors[key] === undefined) errors[key] = issue.message;
  }
  return { ok: false, errors };
}
