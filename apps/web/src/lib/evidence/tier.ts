/**
 * The evidence tier.
 *
 * `chance_real` is null on every real workspace: engine/splicr/pipeline.py calls
 * db.write_hits without a `scores` argument, so the score stage never writes one.
 * The console showed the column anyway, as a bare decimal — 0.960, 0.950 — which
 * a scientist reads as "96% chance this is real". It is not a probability, it is
 * not calibrated, and on a real screen it is not even present.
 *
 * So the console ranks by a tier instead: a stated rule over stated components,
 * every one of which the reader can see. A tier is a claim about the evidence on
 * file, never about the gene, and it cannot be mistaken for a probability because
 * it is not a number.
 *
 * WHAT THIS MUST NEVER DO
 *
 *  - render as, next to, or convert into a percentage, a probability, a
 *    confidence level, a score out of 100 or a progress bar
 *  - combine its components into a displayed number; there is no composite score
 *    and none is computed
 *  - let a null satisfy a condition; every rule tests presence before value
 *  - collapse "not enough evidence recorded" into Weak, in any view, filter,
 *    sort, count or export. A gene we did not measure and a gene we measured and
 *    found wanting are different claims, and confusing them is the failure this
 *    product exists to prevent.
 *
 * When a calibrated model lands, `calibrated` flips to true and the chip changes.
 * Nothing else about the UI moves. That is the whole point of shipping a tier.
 */
import type { CandidateRow } from "@/components/dashboard/overview/types";

export type Tier = "Strong" | "Moderate" | "Weak" | "Not enough evidence recorded";

export interface TierComponent {
  /** What the reader sees this component called. */
  label: string;
  /** The field it reads, named so the reader can go and check it. */
  field: string;
  /** The value as text, or null when the field was never recorded. */
  value: string | null;
  /** How this component bore on the tier. */
  bearing: "supports" | "against" | "caps" | "missing" | "context";
  note?: string;
}

export interface TierResult {
  tier: Tier;
  components: TierComponent[];
  /** False until a fitted model exists. Drives the "not yet calibrated" chip. */
  calibrated: boolean;
  /** Order-only key. A position, never a displayed value. */
  rankKey: number | null;
  /** The single condition that decided the tier, in the reader's words. */
  because: string;
  /** Named fields the tier could not read. */
  missing: string[];
}

/**
 * How each artifact flag bears on a tier, keyed on `public.artifact_flag`.
 *
 * `mechanism` means the measurement itself is suspect: the guide hit something
 * other than the gene, or only one guide carried the signal. No statistic can
 * argue a gene out of that, so it is a hard cap.
 *
 * `scope` means the measurement is probably right and the gene is still a poor
 * use of a bench: a frequent hitter is real in a third of all screens ever run,
 * which makes it uninformative rather than wrong. It caps at Moderate.
 *
 * `quality` is a property of the screen, not of this gene. It is shown and does
 * not cap, because capping every gene on a bottlenecked replicate would say the
 * same thing 20,000 times.
 */
export const FLAG_KIND: Record<string, "mechanism" | "scope" | "quality"> = {
  copy_number_cluster: "mechanism",
  multi_gene_guide: "mechanism",
  promiscuous_guide: "mechanism",
  single_guide: "mechanism",
  frequent_hitter: "scope",
  paralog_buffering: "scope",
  low_coverage: "quality",
  bottleneck: "quality",
  low_plasmid_representation: "quality",
};

/** Readable names for the enum, so the UI never prints snake_case at a reader. */
export const FLAG_LABEL: Record<string, string> = {
  copy_number_cluster: "Copy-number cluster",
  multi_gene_guide: "Guide targets more than one gene",
  promiscuous_guide: "Promiscuous guide",
  single_guide: "One guide carried the signal",
  frequent_hitter: "Frequent hitter",
  paralog_buffering: "Paralog buffering",
  low_coverage: "Low coverage",
  bottleneck: "Bottlenecked replicate",
  low_plasmid_representation: "Low plasmid representation",
};

export function flagLabel(flag: string): string {
  return FLAG_LABEL[flag] ?? flag.replace(/_/g, " ");
}

/** Depleted needs a larger effect than enriched to clear the same bar. */
const STRONG_LFC = { depleted: 1.0, enriched: 0.75 };
const MODERATE_LFC = { depleted: 0.5, enriched: 0.4 };
const STRONG_FDR = 0.05;
const MODERATE_FDR = 0.1;
const STRONG_CONCORDANCE = 0.75;
const MODERATE_CONCORDANCE = 0.5;
/** Above this share of the Atlas, a gene is a frequent hitter whatever the flags say. */
const FREQUENT_HITTER_RATE = 0.25;
const STRONG_BAYES = 10;

const num = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function evidenceTier(row: CandidateRow): TierResult {
  const components: TierComponent[] = [];
  const missing: string[] = [];

  const direction: "depleted" | "enriched" =
    row.direction ?? (num(row.lfc) && row.lfc < 0 ? "depleted" : "enriched");

  // --- the four core legs ---------------------------------------------------
  const hasLfc = num(row.lfc);
  const hasFdr = num(row.fdr);
  const hasConcordance = num(row.guides) && num(row.guidesAgree) && row.guides > 0;
  const hasAtlas = num(row.atlasHits) && num(row.atlasScreens) && row.atlasScreens > 0;
  const coreRecorded = [hasLfc, hasFdr, hasConcordance, hasAtlas].filter(Boolean).length;

  const concordance = hasConcordance ? row.guidesAgree! / row.guides! : null;
  const atlasRate = hasAtlas ? row.atlasHits! / row.atlasScreens! : null;

  components.push({
    label: "Effect size",
    field: "lfc",
    value: hasLfc ? `${row.lfc! > 0 ? "+" : ""}${row.lfc!.toFixed(2)} log₂` : null,
    bearing: hasLfc ? "supports" : "missing",
  });
  if (!hasLfc) missing.push("effect size");

  components.push({
    label: "Multiple-testing q-value",
    field: "fdr",
    value: hasFdr ? row.fdr!.toFixed(3) : null,
    bearing: hasFdr ? "supports" : "missing",
  });
  if (!hasFdr) missing.push("q-value");

  components.push({
    label: "Guide concordance",
    field: "n_good_guides / n_guides",
    value: hasConcordance ? `${row.guidesAgree} of ${row.guides} guides` : null,
    bearing: hasConcordance ? "supports" : "missing",
  });
  if (!hasConcordance) missing.push("guide agreement");

  components.push({
    label: "How often the Atlas calls this gene",
    field: "atlas_hit_count / atlas_screen_count",
    value: hasAtlas
      ? `${row.atlasHits} of ${row.atlasScreens} screens`
      : null,
    bearing: hasAtlas ? "context" : "missing",
    note: hasAtlas ? undefined : "The Atlas check has not been run on this screen.",
  });
  if (!hasAtlas) missing.push("Atlas history");

  components.push({
    label: "Independent essentiality evidence",
    field: "bayes_factor",
    value: num(row.bayes) ? row.bayes!.toFixed(2) : null,
    bearing: num(row.bayes) ? "context" : "missing",
  });

  // --- flags ---------------------------------------------------------------
  const flags = row.flags;
  const mechanism = flags === null ? [] : flags.filter((f) => FLAG_KIND[f] === "mechanism");
  const scope = flags === null ? [] : flags.filter((f) => FLAG_KIND[f] === "scope");

  components.push({
    label: "Artifact flags",
    field: "hit_flags",
    value:
      flags === null
        ? null
        : flags.length === 0
          ? "None raised"
          : flags.map(flagLabel).join(", "),
    bearing:
      flags === null ? "missing" : mechanism.length > 0 ? "caps" : scope.length > 0 ? "caps" : "supports",
    note:
      flags === null
        ? "The artifact stage has not reported on this hit, which is not the same as reporting nothing."
        : undefined,
  });

  const rankKey = num(row.chance) ? row.chance : hasFdr ? -row.fdr! : null;
  const base = { components, calibrated: false, rankKey, missing };

  // --- 1. not enough evidence, evaluated before everything else -------------
  if (coreRecorded <= 2) {
    return {
      ...base,
      tier: "Not enough evidence recorded",
      because: `Only ${coreRecorded} of 4 core components are recorded: ${missing.join(", ")} missing.`,
    };
  }

  // --- 2. caps no statistic can argue with ---------------------------------
  if (mechanism.length > 0) {
    return {
      ...base,
      tier: "Weak",
      because: `${flagLabel(mechanism[0])} — the measurement itself is in question, whatever the statistics say.`,
    };
  }

  const frequentHitter =
    scope.includes("frequent_hitter") || (atlasRate !== null && atlasRate > FREQUENT_HITTER_RATE);

  // --- 3. Strong ------------------------------------------------------------
  const lfcStrong = hasLfc && Math.abs(row.lfc!) >= STRONG_LFC[direction];
  const fdrStrong = hasFdr && row.fdr! <= STRONG_FDR;
  const concStrong = concordance !== null && concordance >= STRONG_CONCORDANCE;
  const corroborated =
    (direction === "depleted" && num(row.bayes) && row.bayes! >= STRONG_BAYES) ||
    (hasConcordance && row.guidesAgree === row.guides);

  if (
    coreRecorded === 4 &&
    !frequentHitter &&
    lfcStrong &&
    fdrStrong &&
    concStrong &&
    corroborated &&
    row.verdict !== "Artifact"
  ) {
    return {
      ...base,
      tier: "Strong",
      because: "Every recorded component agrees, and nothing is flagged.",
    };
  }

  // --- 4. Moderate ----------------------------------------------------------
  const lfcModerate = !hasLfc || Math.abs(row.lfc!) >= MODERATE_LFC[direction];
  const fdrModerate = !hasFdr || row.fdr! <= MODERATE_FDR;
  const concModerate = concordance === null || concordance >= MODERATE_CONCORDANCE;

  if (lfcModerate && fdrModerate && concModerate) {
    // A capped row says so, so the reader can tell it apart from a row that is
    // merely middling. Silently demoting it would hide the reason.
    if (frequentHitter) {
      return {
        ...base,
        tier: "Moderate",
        because:
          atlasRate !== null
            ? `Capped: called in ${row.atlasHits} of ${row.atlasScreens} Atlas screens.`
            : "Capped: flagged as a frequent hitter.",
      };
    }
    return {
      ...base,
      tier: "Moderate",
      because:
        coreRecorded < 4
          ? `Components agree, but ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not recorded.`
          : "Components agree, but not every one clears the Strong bar.",
    };
  }

  // --- 5. Weak --------------------------------------------------------------
  const why = !concModerate
    ? `Guides disagree: ${row.guidesAgree} of ${row.guides} support the call.`
    : !fdrModerate
      ? `q-value ${row.fdr!.toFixed(3)} is above the ${MODERATE_FDR} cut.`
      : `Effect size ${row.lfc!.toFixed(2)} is below the ${MODERATE_LFC[direction]} floor for a ${direction} call.`;

  return { ...base, tier: "Weak", because: why };
}

/** Tier order for sorting. Not exposed to the UI as a number. */
const TIER_ORDER: Record<Tier, number> = {
  Strong: 0,
  Moderate: 1,
  Weak: 2,
  "Not enough evidence recorded": 3,
};

export function compareTier(a: TierResult, b: TierResult): number {
  const byTier = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
  if (byTier !== 0) return byTier;
  if (a.rankKey === null && b.rankKey === null) return 0;
  if (a.rankKey === null) return 1;
  if (b.rankKey === null) return -1;
  return b.rankKey - a.rankKey;
}

/** The exact wording, in one place, so no surface can soften it. */
export const TIER_GLOSS: Record<Tier, string> = {
  Strong: "Every recorded component agrees, and nothing is flagged.",
  Moderate: "Components agree, but one leg is missing, middling or capped.",
  Weak: "A recorded component disagrees, or an artifact flag is set.",
  "Not enough evidence recorded":
    "Too few components were recorded to place this gene at all.",
};

export const NOT_CALIBRATED = "Evidence tier — not yet calibrated";

export const NOT_CALIBRATED_LONG =
  "A tier ranks candidates against each other. It is not a probability that a gene validates, " +
  "and no calibrated probability is available.";
