/**
 * Labels and provenance for the settings panels.
 *
 * The QC numbers below are the engine's own, from engine/splicr/config.py
 * (`QcThresholds`). Both copies have to agree, because the engine writes the QC
 * verdict that this dashboard reads back, so each entry records the default and
 * where the number comes from. Several of these thresholds are widely quoted and
 * often misattributed, which is why the source is spelled out in the UI rather
 * than kept in a comment.
 */
import {
  DEFAULT_WORKSPACE_SETTINGS,
  type HitCaller,
  type Modality,
} from "@/lib/data/types";

export const MODALITY_LABEL: Record<Modality, string> = {
  knockout: "Knockout, SpCas9",
  crispri: "CRISPRi, dCas9-KRAB",
  crispra: "CRISPRa, dCas9 activator",
  base_edit: "Base editing",
  prime: "Prime editing",
  knockout_cas12a: "Knockout, Cas12a",
};

/** A word, not a sentence, for places where the label sits inside a list. */
export const MODALITY_SHORT: Record<Modality, string> = {
  knockout: "knockout",
  crispri: "CRISPRi",
  crispra: "CRISPRa",
  base_edit: "base editing",
  prime: "prime editing",
  knockout_cas12a: "Cas12a knockout",
};

/** The two organisms the Atlas carries guides for. */
export const TAXA: { value: number; label: string }[] = [
  { value: 9606, label: "Human, taxid 9606" },
  { value: 10090, label: "Mouse, taxid 10090" },
];

export const HIT_CALLER_NOTE: Record<HitCaller, string> = {
  mageck_rra:
    "Robust rank aggregation across guides. The usual first pass for a two-condition screen.",
  mageck_mle:
    "Maximum likelihood over a design matrix. Worth running when the screen has more than two arms.",
  bagel2:
    "Bayes factors against gold-standard essential and non-essential sets. Built for dropout screens.",
  drugz:
    "Written for chemogenomic screens, where a hit shifts relative to the drug arm rather than dropping out.",
  chronos:
    "DepMap's model for time-series and multi-passage designs. Needs more than one timepoint.",
};

export interface QcFieldMeta {
  /** Flat form field name the action reads, `qc.<column>`. */
  name: string;
  label: string;
  suffix?: string;
  min: number;
  max: number;
  step: number | "any";
  /** The engine default, used by "restore engine defaults". */
  fallback: number;
  provenance: string;
}

const qcDefaults = DEFAULT_WORKSPACE_SETTINGS.qc;

export const QC_FIELDS: QcFieldMeta[] = [
  {
    name: "qc.min_mapping_rate",
    label: "Minimum mapping rate",
    suffix: "fraction of reads",
    min: 0,
    max: 1,
    step: "any",
    fallback: qcDefaults.min_mapping_rate,
    provenance:
      "Default 0.60. The MAGeCK wiki asks for at least 60 percent of reads mapped to the library, and MAGeCKFlute raises that to 65. The engine warns under 0.65 and fails under this line.",
  },
  {
    name: "qc.max_zero_fraction",
    label: "Maximum zero fraction",
    suffix: "fraction of guides",
    min: 0,
    max: 1,
    step: "any",
    fallback: qcDefaults.max_zero_fraction,
    provenance:
      "Default 0.01. The MAGeCK wiki expects fewer than 1 percent of guides at zero counts. The engine warns from 0.05 upwards.",
  },
  {
    name: "qc.max_gini",
    label: "Maximum Gini, endpoint sample",
    min: 0,
    max: 1,
    step: "any",
    fallback: qcDefaults.max_gini,
    provenance:
      "Default 0.35, computed on log(count + 1). The MAGeCK wiki puts a plasmid pool near 0.1 and an endpoint sample at 0.2 to 0.3. The engine holds a plasmid pool to 0.15 and an endpoint sample to this value.",
  },
  {
    name: "qc.min_reads_per_guide",
    label: "Minimum mean reads per guide",
    suffix: "reads",
    min: 0,
    max: 100_000,
    step: 1,
    fallback: qcDefaults.min_reads_per_guide,
    provenance:
      "Default 185. DepMap requires more than 185 mean reads per guide before a sequenced sample passes.",
  },
  {
    name: "qc.nnmd_threshold",
    label: "NNMD threshold",
    suffix: "lower is better",
    min: -20,
    max: 0,
    step: "any",
    fallback: qcDefaults.nnmd_threshold,
    provenance:
      "Default -1.25. DepMap passes a screen at NNMD <= -1.25, where NNMD is the median of the essentials minus the median of the non-essentials, over the MAD of the non-essentials. The original definition used mean and standard deviation at -1.0; Chronos moved it to median and MAD.",
  },
];

/** Common retention windows, offered as presets beside the number field. */
export const RETENTION_PRESETS: { days: number; label: string }[] = [
  { days: 0, label: "Delete at once" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: 1825, label: "5 years" },
];
