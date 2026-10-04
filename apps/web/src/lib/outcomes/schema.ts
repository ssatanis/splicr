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

import {
  VALIDATION_TYPES,
  type ValidationType,
} from "@/lib/validation/model";

import { OUTCOME_RESULTS, type OutcomeResult } from "./model";

/**
 * Three states, and the third one is the whole reason this type exists.
 *
 * "Was the perturbation independent of the screen's own construct?" has three
 * honest answers: yes, no, and nobody wrote it down. A checkbox has two, and
 * an unchecked checkbox would record "no" for every outcome whose form was
 * filled in a hurry — which is a measurement claim nobody made.
 *
 * The engine's endpoints treat an unrecorded criterion as
 * `insufficient_record`, which keeps the outcome out of a rate's numerator and
 * its denominator. That only works if the form can express "not recorded", so
 * it can.
 */
export const TRISTATE = ["", "yes", "no"] as const;
export type Tristate = (typeof TRISTATE)[number];

const tristate = (label: string) =>
  z
    .string()
    .trim()
    .transform((value, ctx): boolean | null => {
      if (value === "") return null;
      if (value === "yes") return true;
      if (value === "no") return false;
      ctx.addIssue({ code: "custom", message: `${label} must be yes, no or left blank.` });
      return z.NEVER;
    });

const wholeNumber = (label: string, max: number) =>
  z
    .string()
    .trim()
    .transform((value, ctx): number | null => {
      if (value === "") return null;
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > max) {
        ctx.addIssue({
          code: "custom",
          message: `${label} must be a whole number from 1 to ${max}.`,
        });
        return z.NEVER;
      }
      return n;
    });

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
  /**
   * Which experiment this was. Required on a new outcome, because an outcome
   * that does not name its experiment cannot be learned from: a genetic
   * reproduction and a pharmacologic test are different questions with
   * different answers, and a row that says only "validated" belongs to
   * neither. Rows recorded before the Validation Network existed have no type
   * and are kept, shown and exported exactly as they are.
   */
  validationType: z.enum(VALIDATION_TYPES, "Choose which experiment this was."),
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
  /** The laboratory that ran it. The unit of the cluster bootstrap. */
  labId: optionalText(64, "The laboratory identifier"),
  /**
   * Whether the perturbation was independent of the one the screen used, and
   * whether the constructs differed from the screening library's. Blank means
   * not recorded, which is not the same as no.
   */
  independentPerturbation: tristate("Independent perturbation"),
  distinctConstructs: tristate("Different constructs from the screen"),
  /** Biological replicates. An endpoint with a replicate floor reads this. */
  nReplicates: wholeNumber("Biological replicates", 1000),
  /** For a small-molecule outcome: which compound, and at what concentration. */
  compound: optionalText(120, "The compound name"),
  concentrationUm: z
    .string()
    .trim()
    .transform((value, ctx): number | null => {
      if (value === "") return null;
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 1e6) {
        ctx.addIssue({
          code: "custom",
          message: "Concentration must be a number in micromolar.",
        });
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
  validationType: ValidationType | "";
  result: OutcomeResult | "";
  assay: string;
  nGuides: string;
  effectSize: string;
  labId: string;
  independentPerturbation: Tristate;
  distinctConstructs: Tristate;
  nReplicates: string;
  compound: string;
  concentrationUm: string;
  notes: string;
  evidenceUrl: string;
}

export const EMPTY_DRAFT: OutcomeDraft = {
  screenId: "",
  gene: "",
  validationType: "",
  result: "",
  assay: "",
  nGuides: "",
  effectSize: "",
  labId: "",
  independentPerturbation: "",
  distinctConstructs: "",
  nReplicates: "",
  compound: "",
  concentrationUm: "",
  notes: "",
  evidenceUrl: "",
};

/**
 * The measurement, as the engine's endpoints read it.
 *
 * Built here rather than in the server action, so the browser and the server
 * produce byte-identical measurement objects from the same draft, and so the
 * shape has exactly one definition. A null stays null: an endpoint that
 * requires a criterion and finds null returns `insufficient_record`, and that
 * is the correct outcome for a record nobody completed.
 */
export function measurementFromValues(
  values: OutcomeFormValues,
): Record<string, unknown> {
  const measurement: Record<string, unknown> = {
    independent_perturbation: values.independentPerturbation,
    distinct_from_screen_constructs: values.distinctConstructs,
    n_perturbations: values.nGuides,
    n_replicates: values.nReplicates,
    effect_size: values.effectSize,
  };
  if (values.compound !== null) measurement.compound = values.compound;
  if (values.concentrationUm !== null) {
    measurement.concentration_um = values.concentrationUm;
  }
  return measurement;
}

/** Which fields the chosen experiment actually makes sense to ask about. */
export function fieldsFor(type: ValidationType | ""): {
  compound: boolean;
  constructs: boolean;
} {
  return {
    // A compound and a concentration are meaningless for a guide experiment,
    // and a pharmacologic outcome without them cannot be interpreted or
    // reused by anybody else.
    compound: type === "small_molecule",
    // "Not one of the original screen constructs" only has meaning where the
    // screen had constructs to reuse.
    constructs:
      type === "independent_guide" ||
      type === "independent_guide_set" ||
      type === "crispri" ||
      type === "crispra",
  };
}

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
    validationType: text("validationType"),
    result: text("result"),
    assay: text("assay"),
    nGuides: text("nGuides"),
    effectSize: text("effectSize"),
    labId: text("labId"),
    independentPerturbation: text("independentPerturbation"),
    distinctConstructs: text("distinctConstructs"),
    nReplicates: text("nReplicates"),
    compound: text("compound"),
    concentrationUm: text("concentrationUm"),
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
