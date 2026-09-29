/**
 * The screen planner's model.
 *
 * This is design arithmetic, and it says so. Given a library, a coverage, an
 * MOI and a sequencing depth it tells you how many guides, cells, reads, PCR
 * reactions and weeks the design needs, how evenly the library is expected to be
 * represented, and how much sampling noise the design alone puts on a guide's
 * fold change. Every quantity is either a closed form or a short numerical
 * integral, and every assumption is a field the reader can change.
 *
 * What it deliberately does not produce is a statistical power percentage. A
 * power figure for a pooled screen needs the dispersion of guide counts across
 * replicates in your cells, the effect-size distribution you expect, the
 * multiple-testing correction over your library and the guide efficacy
 * distribution. None of those can be known before the screen, so a percentage
 * here would be a formula dressed as a calculation. The noise floor below is
 * honest about what it is: the sampling noise of picking cells and reading
 * reads, which is a lower bound on the noise a real screen has.
 *
 * MODEL
 *
 * Transduction. Cells receive a Poisson number of integrations with mean MOI.
 * The fraction carrying at least one is 1 - exp(-MOI). To hold `coverage` cells
 * per guide after selection you must transduce
 *   cells = guides * coverage / (1 - exp(-MOI)).
 * Joung et al. (Nat Protoc 2017, doi 10.1038/nprot.2017.016) work their example
 * by dividing by the MOI itself: 100,000 guides at 500 cells and MOI 0.3 is
 * 1.67e8 cells. The Poisson form gives 1.93e8, because an MOI of 0.3 infects
 * 25.9% of cells, not 30%. The planner uses the Poisson form and the method
 * panel says the two differ.
 * Among infected cells, the fraction with two or more integrations is
 *   1 - MOI * exp(-MOI) / (1 - exp(-MOI)).
 *
 * Representation. Plasmid pool abundance a_i is lognormal with mean 1 and a
 * spread set by the skew ratio, the 90th over the 10th percentile of guide
 * counts that the standard protocols quote:
 *   sigma = ln(ratio) / (2 * z_0.90),  z_0.90 = 1.28155.
 * The cells (or reads) a guide receives are Poisson(mean * a_i). The expected
 * fraction of guides below a floor is the Poisson-lognormal mixture, integrated
 * numerically over the lognormal.
 *
 * Noise floor. A guide's log fold change compares two samples. Picking cells
 * adds variance 1/coverage to the log abundance of each and reading reads adds
 * 1/depth (delta method, Poisson). Averaging r replicate comparisons divides by
 * r and averaging g independent guides divides by g:
 *   SE(log2 FC) = sqrt(2 * (1/coverage + 1/depth) / r / g) / ln 2.
 * Biological variation, guide efficacy, and a shared library bottleneck between
 * replicates are not in it, so it is a floor, not an estimate.
 *
 * Genomic DNA. A diploid human cell holds about 6.6 pg, so N cells yield
 * N * 6.6e-6 ug, and the PCR is set up at a fixed mass per reaction.
 */

import { findLibrary } from "./libraries";

export const MODEL_VERSION = "planner-model-2026-09";

export type DesignKind = "dropout" | "treatment";

export interface PlanInputs {
  /** `custom`, or the slug of a catalogued library. */
  library: string;
  genes: number;
  guidesPerGene: number;
  controls: number;
  coverage: number;
  moi: number;
  startingCellsM: number;
  doublingHours: number;
  design: DesignKind;
  replicates: number;
  screenDays: number;
  readsPerGuide: number;
  runReadsM: number;
  skew: number;
  cellFloor: number;
  readFloor: number;
  gdnaPgPerCell: number;
  gdnaUgPerPcr: number;
  costLibrary: number;
  costVirus: number;
  costCulturePerBillion: number;
  costGdnaPerUg: number;
  costPcr: number;
  costSeqPerMillion: number;
  weeksLibrary: number;
  weeksVirus: number;
  weeksSelection: number;
  weeksHarvest: number;
  weeksSequencing: number;
  weeksAnalysis: number;
}

export type NumericKey = Exclude<keyof PlanInputs, "library" | "design">;

export interface FieldSpec {
  key: NumericKey;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  help?: string;
}

const spec = (s: FieldSpec): FieldSpec => s;

export const FIELDS: Record<NumericKey, FieldSpec> = {
  genes: spec({ key: "genes", label: "Genes targeted", min: 1, max: 30_000, step: 100, integer: true }),
  guidesPerGene: spec({ key: "guidesPerGene", label: "Guides per gene", min: 1, max: 12, step: 0.5, help: "Average. Whole numbers or decimals." }),
  controls: spec({ key: "controls", label: "Control guides", min: 0, max: 10_000, step: 100, integer: true, help: "Non-targeting or safe-targeting guides." }),
  coverage: spec({ key: "coverage", label: "Cells per guide", unit: "cells", min: 20, max: 5_000, step: 50, integer: true, help: "Held at every step: transduction, each passage and harvest." }),
  moi: spec({ key: "moi", label: "MOI", min: 0.05, max: 2, step: 0.05, help: "Mean integrations per cell before selection." }),
  startingCellsM: spec({ key: "startingCellsM", label: "Cells on hand", unit: "million", min: 0.1, max: 100_000, step: 5, help: "Cells available before transduction." }),
  doublingHours: spec({ key: "doublingHours", label: "Doubling time", unit: "hours", min: 6, max: 240, step: 1, integer: true }),
  replicates: spec({ key: "replicates", label: "Replicates", unit: "per arm", min: 1, max: 12, step: 1, integer: true }),
  screenDays: spec({ key: "screenDays", label: "Days in screen", unit: "days", min: 3, max: 60, step: 1, integer: true, help: "From the end of selection to harvest." }),
  readsPerGuide: spec({ key: "readsPerGuide", label: "Reads per guide", unit: "reads", min: 20, max: 5_000, step: 50, integer: true, help: "Mean sequencing depth per sample." }),
  runReadsM: spec({ key: "runReadsM", label: "Reads per run", unit: "million", min: 1, max: 50_000, step: 50, help: "Yield of the sequencing run you would use. Check your core's current specification." }),
  skew: spec({ key: "skew", label: "Library skew", unit: "90th / 10th", min: 1, max: 50, step: 0.5, help: "Ratio of the 90th to the 10th percentile guide count in your plasmid pool. Standard protocols ask for under 10." }),
  cellFloor: spec({ key: "cellFloor", label: "Cell floor", unit: "cells", min: 1, max: 1_000, step: 5, integer: true, help: "A guide holding fewer cells than this is at risk of drifting out by chance." }),
  readFloor: spec({ key: "readFloor", label: "Read floor", unit: "reads", min: 1, max: 1_000, step: 5, integer: true, help: "A guide with fewer reads than this is poorly measured." }),
  gdnaPgPerCell: spec({ key: "gdnaPgPerCell", label: "gDNA per cell", unit: "pg", min: 1, max: 30, step: 0.1, help: "About 6.6 pg for a diploid human cell. Cancer lines are often higher." }),
  gdnaUgPerPcr: spec({ key: "gdnaUgPerPcr", label: "gDNA per PCR", unit: "µg", min: 0.5, max: 50, step: 0.5, help: "Mass loaded into one amplification reaction." }),
  costLibrary: spec({ key: "costLibrary", label: "Library plasmid and amplification", unit: "$", min: 0, max: 1_000_000, step: 50 }),
  costVirus: spec({ key: "costVirus", label: "Lentivirus production and titration", unit: "$", min: 0, max: 1_000_000, step: 50 }),
  costCulturePerBillion: spec({ key: "costCulturePerBillion", label: "Cell culture", unit: "$ per billion cells grown", min: 0, max: 100_000, step: 10 }),
  costGdnaPerUg: spec({ key: "costGdnaPerUg", label: "gDNA extraction", unit: "$ per µg", min: 0, max: 1_000, step: 0.1 }),
  costPcr: spec({ key: "costPcr", label: "PCR", unit: "$ per reaction", min: 0, max: 1_000, step: 0.5 }),
  costSeqPerMillion: spec({ key: "costSeqPerMillion", label: "Sequencing", unit: "$ per million reads", min: 0, max: 1_000, step: 0.5 }),
  weeksLibrary: spec({ key: "weeksLibrary", label: "Library preparation", unit: "weeks", min: 0, max: 52, step: 1, integer: true }),
  weeksVirus: spec({ key: "weeksVirus", label: "Virus production", unit: "weeks", min: 0, max: 52, step: 1, integer: true }),
  weeksSelection: spec({ key: "weeksSelection", label: "Transduction and selection", unit: "weeks", min: 0, max: 52, step: 1, integer: true }),
  weeksHarvest: spec({ key: "weeksHarvest", label: "Harvest, gDNA and PCR", unit: "weeks", min: 0, max: 52, step: 1, integer: true }),
  weeksSequencing: spec({ key: "weeksSequencing", label: "Sequencing turnaround", unit: "weeks", min: 0, max: 52, step: 1, integer: true }),
  weeksAnalysis: spec({ key: "weeksAnalysis", label: "Analysis", unit: "weeks", min: 0, max: 52, step: 1, integer: true }),
};

export const NUMERIC_KEYS = Object.keys(FIELDS) as NumericKey[];

export const DEFAULT_INPUTS: PlanInputs = {
  library: "brunello",
  genes: 19_114,
  guidesPerGene: 4,
  controls: 1_000,
  coverage: 500,
  moi: 0.3,
  startingCellsM: 20,
  doublingHours: 24,
  design: "treatment",
  replicates: 3,
  screenDays: 14,
  readsPerGuide: 500,
  runReadsM: 400,
  skew: 6,
  cellFloor: 30,
  readFloor: 30,
  gdnaPgPerCell: 6.6,
  gdnaUgPerPcr: 10,
  costLibrary: 600,
  costVirus: 1_000,
  costCulturePerBillion: 200,
  costGdnaPerUg: 0.5,
  costPcr: 6,
  costSeqPerMillion: 8,
  weeksLibrary: 2,
  weeksVirus: 2,
  weeksSelection: 1,
  weeksHarvest: 1,
  weeksSequencing: 2,
  weeksAnalysis: 1,
};

export interface Preset {
  id: string;
  label: string;
  blurb: string;
  inputs: Partial<PlanInputs>;
}

export const PRESETS: readonly Preset[] = [
  {
    id: "genome-ko",
    label: "Genome-wide knockout",
    blurb: "Brunello, 500 cells per guide, three replicates",
    inputs: { library: "brunello", coverage: 500, moi: 0.3, replicates: 3, design: "treatment", doublingHours: 24, startingCellsM: 20, screenDays: 14, readsPerGuide: 500 },
  },
  {
    id: "focused-primary",
    label: "Focused library, primary cells",
    blurb: "1,200 genes, slow-growing cells, shorter screen",
    inputs: {
      library: "custom", genes: 1_200, guidesPerGene: 4, controls: 500, coverage: 500, moi: 0.3, replicates: 3,
      design: "treatment", doublingHours: 36, startingCellsM: 20, screenDays: 10, readsPerGuide: 500, weeksLibrary: 6,
    },
  },
  {
    id: "genome-crispri",
    label: "Genome-wide CRISPRi",
    blurb: "Dolcetto Set A, dropout against day 0",
    inputs: { library: "dolcetto-a", coverage: 500, moi: 0.3, replicates: 3, design: "dropout", doublingHours: 24, screenDays: 21, startingCellsM: 20, readsPerGuide: 500 },
  },
];

// ---------------------------------------------------------------------------
// Parsing and clamping
// ---------------------------------------------------------------------------

export interface FieldIssue {
  key: NumericKey;
  message: string;
  used: number;
}

export interface Sanitized {
  inputs: PlanInputs;
  issues: FieldIssue[];
}

const LIBRARY_KEYS = new Set(["custom"]);

function clampField(field: FieldSpec, raw: unknown, fallback: number): { value: number; issue: string | null } {
  const text = typeof raw === "string" ? raw.trim() : raw;
  if (text === "" || text === null || text === undefined) return { value: fallback, issue: `Enter a number. Using ${fallback}.` };
  const n = typeof text === "number" ? text : Number(text);
  if (!Number.isFinite(n)) return { value: fallback, issue: `Enter a number. Using ${fallback}.` };
  const stepped = field.integer ? Math.round(n) : n;
  const bounded = Math.min(field.max, Math.max(field.min, stepped));
  if (bounded !== n) {
    return {
      value: bounded,
      issue: `${field.label} must be ${field.integer ? "a whole number " : ""}from ${field.min.toLocaleString("en-US")} to ${field.max.toLocaleString("en-US")}. Using ${bounded.toLocaleString("en-US")}.`,
    };
  }
  return { value: n, issue: null };
}

/**
 * One field, as typed. `ok` is false when the text is not yet a number (empty,
 * or half-typed), which a form treats as "keep the last good value and say what
 * is expected" rather than as a reason to jump to a default mid-keystroke.
 */
export function parseField(
  key: NumericKey,
  raw: string,
): { ok: boolean; value: number; issue: string | null } {
  const field = FIELDS[key];
  const text = raw.trim();
  const n = Number(text);
  if (text === "" || !Number.isFinite(n)) {
    return { ok: false, value: DEFAULT_INPUTS[key], issue: `Enter a number from ${field.min.toLocaleString("en-US")} to ${field.max.toLocaleString("en-US")}.` };
  }
  const { value, issue } = clampField(field, n, DEFAULT_INPUTS[key]);
  return { ok: true, value, issue };
}

/**
 * Accepts anything, returns a plan input that is always safe to compute with,
 * and names every field it had to change. A number that is out of range is
 * clamped and reported rather than silently accepted or thrown at the page.
 */
export function sanitizeInputs(raw: Partial<Record<keyof PlanInputs, unknown>>): Sanitized {
  const inputs: PlanInputs = { ...DEFAULT_INPUTS };
  const issues: FieldIssue[] = [];

  const library = typeof raw.library === "string" ? raw.library : DEFAULT_INPUTS.library;
  inputs.library = LIBRARY_KEYS.has(library) || findLibrary(library) ? library : DEFAULT_INPUTS.library;
  inputs.design = raw.design === "dropout" || raw.design === "treatment" ? raw.design : DEFAULT_INPUTS.design;

  for (const key of NUMERIC_KEYS) {
    if (raw[key] === undefined) continue;
    const { value, issue } = clampField(FIELDS[key], raw[key], DEFAULT_INPUTS[key]);
    inputs[key] = value;
    if (issue) issues.push({ key, message: issue, used: value });
  }
  return { inputs, issues };
}

// ---------------------------------------------------------------------------
// Numerics
// ---------------------------------------------------------------------------

const Z90 = 1.2815515655446004;
const LN2 = Math.LN2;

/** sigma of the lognormal whose 90th over 10th percentile ratio is `ratio`. */
export function skewToSigma(ratio: number): number {
  return ratio <= 1 ? 0 : Math.log(ratio) / (2 * Z90);
}

/** P(X <= k) for X ~ Poisson(lambda), by the stable recurrence in log space. */
export function poissonCdf(k: number, lambda: number): number {
  if (k < 0) return 0;
  if (lambda <= 0) return 1;
  const ln = Math.log(lambda);
  let logTerm = -lambda;
  let sum = Math.exp(logTerm);
  for (let j = 1; j <= k; j++) {
    logTerm += ln - Math.log(j);
    sum += Math.exp(logTerm);
  }
  return Math.min(1, sum);
}

const GRID = (() => {
  // Midpoint rule over +/- 8 standard deviations, weights normalized so a
  // truncation error in the tails cannot leak into the total probability.
  const n = 240;
  const lo = -8;
  const dz = 16 / n;
  const z: number[] = [];
  const w: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const zi = lo + (i + 0.5) * dz;
    const wi = Math.exp(-0.5 * zi * zi);
    z.push(zi);
    w.push(wi);
    total += wi;
  }
  return { z, w: w.map((wi) => wi / total) };
})();

/**
 * Expected fraction of guides that receive fewer than `floor` cells (or reads)
 * when the mean is `mean` and guide abundance is lognormal with the given sigma.
 * With sigma = 0 this is the plain Poisson tail.
 */
export function fractionBelow(mean: number, sigma: number, floor: number): number {
  if (floor <= 0) return 0;
  if (mean <= 0) return 1;
  const k = Math.ceil(floor) - 1;
  if (sigma === 0) return poissonCdf(k, mean);
  // Beyond this mean the Poisson tail below `floor` is smaller than 1e-15, and
  // skipping the sum keeps the coverage solver fast enough to run per keystroke.
  const negligible = floor + 12 * Math.sqrt(floor + 1) + 30;
  let total = 0;
  for (let i = 0; i < GRID.z.length; i++) {
    const abundance = Math.exp(sigma * GRID.z[i] - (sigma * sigma) / 2);
    const lambda = mean * abundance;
    if (lambda > negligible) continue;
    total += GRID.w[i] * poissonCdf(k, lambda);
  }
  return Math.min(1, total);
}

const needCache = new Map<string, number | null>();

/**
 * The smallest whole mean, in cells or reads, at which at least `target` of
 * guides reach `floor`. Null when even a very large mean cannot, which cannot
 * happen for any skew the form allows but is reported rather than assumed.
 *
 * Bisection on integers, and memoized: it depends only on the skew and the
 * floor, so typing in any other field reuses the answer instead of paying for
 * it on every keystroke.
 */
export function meanNeeded(target: number, sigma: number, floor: number): number | null {
  const key = `${target}|${sigma}|${floor}`;
  const cached = needCache.get(key);
  if (cached !== undefined) return cached;

  const allowed = 1 - target;
  const ok = (mean: number) => fractionBelow(mean, sigma, floor) <= allowed;
  let result: number | null;
  let hi = Math.max(Math.ceil(floor), 1);
  while (!ok(hi) && hi <= 1e9) hi *= 2;
  if (hi > 1e9) {
    result = null;
  } else {
    let lo = Math.floor(hi / 2);
    if (lo >= 1 && ok(lo)) lo = 0;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (ok(mid)) hi = mid;
      else lo = mid;
    }
    result = hi;
  }
  if (needCache.size > 500) needCache.clear();
  needCache.set(key, result);
  return result;
}

/** The lognormal (mean 1) percentile factor: mean * factor is that percentile's mean. */
export function percentileFactor(sigma: number, z: number): number {
  return Math.exp(sigma * z - (sigma * sigma) / 2);
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export interface Phase {
  id: string;
  label: string;
  days: number;
  computed: boolean;
}

export interface CostLine {
  id: string;
  label: string;
  driver: string;
  amount: number;
}

export type CheckLevel = "ok" | "warn" | "info";

export interface Check {
  id: string;
  level: CheckLevel;
  title: string;
  detail: string;
}

export interface Plan {
  modelVersion: string;
  library: {
    name: string;
    fromCatalog: boolean;
    genes: number;
    targeting: number;
    controls: number;
    guides: number;
    guidesPerGene: number;
  };
  transduction: {
    pInfected: number;
    multiFraction: number;
    cellsToTransduce: number;
    expansionDoublings: number;
    expansionDays: number;
    postSelectionDays: number;
  };
  samples: {
    arms: number;
    flasks: number;
    total: number;
    cellsPerSample: number;
    doublings: number;
    cellsGrown: number;
  };
  sequencing: {
    readsPerSample: number;
    totalReads: number;
    runFraction: number;
    runsNeeded: number;
    gdnaPerSampleUg: number;
    gdnaTotalUg: number;
    pcrPerSample: number;
    pcrTotal: number;
  };
  representation: {
    sigma: number;
    cellsBelowFloor: number;
    readsBelowFloor: number;
    coverageFor99: number | null;
    depthFor99: number | null;
    p10Cells: number;
    p10Reads: number;
  };
  noise: {
    guideSeLog2: number;
    geneSeLog2: number;
    geneHalfWidth95: number;
  };
  timeline: { phases: Phase[]; totalDays: number; totalWeeks: number };
  costs: { lines: CostLine[]; total: number };
  checks: Check[];
}

/** The published reference point the cost total is set beside, never mistaken for it. */
export const PUBLISHED_REFERENCE = {
  label: "Greehey CCRI Target Discovery Core, one pooled genome-wide screen",
  usd: 19_000,
  weeksLow: 12,
  weeksHigh: 20,
  href: "https://gccri.uthscsa.edu/services/tdc/service-and-pricing/",
} as const;

function resolveLibrary(inputs: PlanInputs): Plan["library"] {
  const catalog = findLibrary(inputs.library);
  if (catalog) {
    const targeting = catalog.guides - catalog.controls;
    return {
      name: `${catalog.name} (${catalog.organism.toLowerCase()})`,
      fromCatalog: true,
      genes: catalog.genes,
      targeting,
      controls: catalog.controls,
      guides: catalog.guides,
      guidesPerGene: targeting / catalog.genes,
    };
  }
  const targeting = Math.round(inputs.genes * inputs.guidesPerGene);
  return {
    name: "Custom library",
    fromCatalog: false,
    genes: inputs.genes,
    targeting,
    controls: inputs.controls,
    guides: targeting + inputs.controls,
    guidesPerGene: inputs.guidesPerGene,
  };
}

export function buildPlan(inputs: PlanInputs): Plan {
  const library = resolveLibrary(inputs);
  const guides = library.guides;

  // --- transduction -------------------------------------------------------
  const pInfected = 1 - Math.exp(-inputs.moi);
  const multiFraction = 1 - (inputs.moi * Math.exp(-inputs.moi)) / pInfected;
  const cellsToTransduce = (guides * inputs.coverage) / pInfected;
  const startingCells = inputs.startingCellsM * 1e6;
  const expansionDoublings = Math.max(0, Math.log2(cellsToTransduce / startingCells));
  const expansionDays = (expansionDoublings * inputs.doublingHours) / 24;

  // --- samples ------------------------------------------------------------
  const arms = inputs.design === "treatment" ? 2 : 1;
  const flasks = arms * inputs.replicates;
  const total = flasks + 1; // plus the day-zero reference
  const cellsPerSample = guides * inputs.coverage;
  const doublings = (inputs.screenDays * 24) / inputs.doublingHours;
  // After selection one library-worth of cells fills every flask, which takes
  // log2(flasks) doublings; each flask then produces one maintained population
  // of new cells per doubling across the screen.
  const postSelectionDoublings = Math.log2(Math.max(1, flasks));
  const postSelectionDays = (postSelectionDoublings * inputs.doublingHours) / 24;
  const cellsGrown =
    Math.max(0, cellsToTransduce - startingCells) + flasks * cellsPerSample * (1 + doublings);

  // --- sequencing ---------------------------------------------------------
  const readsPerSample = guides * inputs.readsPerGuide;
  const totalReads = readsPerSample * total;
  const runReads = inputs.runReadsM * 1e6;
  const gdnaPerSampleUg = (cellsPerSample * inputs.gdnaPgPerCell) / 1e6;
  const pcrPerSample = Math.ceil(gdnaPerSampleUg / inputs.gdnaUgPerPcr);

  // --- representation and noise ------------------------------------------
  const sigma = skewToSigma(inputs.skew);
  const cellsBelowFloor = fractionBelow(inputs.coverage, sigma, inputs.cellFloor);
  const readsBelowFloor = fractionBelow(inputs.readsPerGuide, sigma, inputs.readFloor);
  const z10 = -Z90;
  const perGuideVariance = (2 * (1 / inputs.coverage + 1 / inputs.readsPerGuide)) / inputs.replicates;
  const guideSeLog2 = Math.sqrt(perGuideVariance) / LN2;
  const geneSeLog2 = guideSeLog2 / Math.sqrt(Math.max(1, library.guidesPerGene));

  // --- timeline -----------------------------------------------------------
  const week = 7;
  const phases: Phase[] = [
    { id: "library", label: "Library preparation", days: inputs.weeksLibrary * week, computed: false },
    { id: "virus", label: "Virus production", days: inputs.weeksVirus * week, computed: false },
    { id: "expand", label: "Expand cells to transduce", days: Math.ceil(expansionDays), computed: true },
    { id: "select", label: "Transduction and selection", days: inputs.weeksSelection * week + Math.ceil(postSelectionDays), computed: false },
    { id: "screen", label: "Screen", days: inputs.screenDays, computed: false },
    { id: "harvest", label: "Harvest, gDNA and PCR", days: inputs.weeksHarvest * week, computed: false },
    { id: "sequence", label: "Sequencing turnaround", days: inputs.weeksSequencing * week, computed: false },
    { id: "analysis", label: "Analysis", days: inputs.weeksAnalysis * week, computed: false },
  ];
  const totalDays = phases.reduce((sum, phase) => sum + phase.days, 0);

  // --- costs --------------------------------------------------------------
  const gdnaTotalUg = gdnaPerSampleUg * total;
  const pcrTotal = pcrPerSample * total;
  const lines: CostLine[] = [
    { id: "library", label: "Library plasmid and amplification", driver: "one library", amount: inputs.costLibrary },
    { id: "virus", label: "Lentivirus production and titration", driver: "one preparation", amount: inputs.costVirus },
    {
      id: "culture",
      label: "Cell culture",
      driver: `${(cellsGrown / 1e9).toFixed(2)} billion cells grown`,
      amount: (cellsGrown / 1e9) * inputs.costCulturePerBillion,
    },
    {
      id: "gdna",
      label: "gDNA extraction",
      driver: `${Math.round(gdnaTotalUg).toLocaleString("en-US")} µg over ${total} samples`,
      amount: gdnaTotalUg * inputs.costGdnaPerUg,
    },
    { id: "pcr", label: "PCR", driver: `${pcrTotal.toLocaleString("en-US")} reactions`, amount: pcrTotal * inputs.costPcr },
    {
      id: "sequencing",
      label: "Sequencing",
      driver: `${(totalReads / 1e6).toFixed(1)} million reads`,
      amount: (totalReads / 1e6) * inputs.costSeqPerMillion,
    },
  ];
  const totalCost = lines.reduce((sum, line) => sum + line.amount, 0);

  const plan: Plan = {
    modelVersion: MODEL_VERSION,
    library,
    transduction: { pInfected, multiFraction, cellsToTransduce, expansionDoublings, expansionDays, postSelectionDays },
    samples: { arms, flasks, total, cellsPerSample, doublings, cellsGrown },
    sequencing: {
      readsPerSample,
      totalReads,
      runFraction: totalReads / runReads,
      runsNeeded: Math.max(1, Math.ceil(totalReads / runReads)),
      gdnaPerSampleUg,
      gdnaTotalUg,
      pcrPerSample,
      pcrTotal,
    },
    representation: {
      sigma,
      cellsBelowFloor,
      readsBelowFloor,
      coverageFor99: meanNeeded(0.99, sigma, inputs.cellFloor),
      depthFor99: meanNeeded(0.99, sigma, inputs.readFloor),
      p10Cells: inputs.coverage * percentileFactor(sigma, z10),
      p10Reads: inputs.readsPerGuide * percentileFactor(sigma, z10),
    },
    noise: { guideSeLog2, geneSeLog2, geneHalfWidth95: 1.959963984540054 * geneSeLog2 },
    timeline: { phases, totalDays, totalWeeks: Math.ceil(totalDays / week) },
    costs: { lines, total: totalCost },
    checks: [],
  };
  plan.checks = runChecks(inputs, plan);
  return plan;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function formatPct(fraction: number): string {
  if (fraction === 0) return "0%";
  const pct = fraction * 100;
  if (pct < 0.001) return "under 0.001%";
  return pct < 10 ? `${pct.toFixed(2)}%` : `${pct.toFixed(1)}%`;
}

function runChecks(inputs: PlanInputs, plan: Plan): Check[] {
  const checks: Check[] = [];
  const add = (id: string, level: CheckLevel, title: string, detail: string) =>
    checks.push({ id, level, title, detail });

  if (inputs.coverage < 200) {
    add(
      "coverage",
      "warn",
      "Coverage is below the usual working range",
      `${inputs.coverage} cells per guide is under the 200 to 500 that screens are usually run at. At this depth ${formatPct(plan.representation.cellsBelowFloor)} of guides are expected to hold fewer than ${inputs.cellFloor} cells, so chance can remove them before selection acts.`,
    );
  } else if (inputs.coverage < 500) {
    add("coverage", "info", "Coverage is below the protocol's 500", `${inputs.coverage} cells per guide. Joung et al. (Nat Protoc 2017) aim for more than 500 cells per guide, and more if selection is weak or the screen is negative selection.`);
  } else {
    add("coverage", "ok", "Coverage meets the protocol's 500", `${inputs.coverage} cells per guide. Joung et al. (Nat Protoc 2017) aim for more than 500.`);
  }

  if (inputs.moi > 0.5) {
    add(
      "moi",
      "warn",
      "MOI is high",
      `At MOI ${inputs.moi}, ${(plan.transduction.multiFraction * 100).toFixed(0)}% of infected cells carry two or more guides. A cell with two guides has a phenotype that belongs to neither, and Joung et al. warn that higher MOIs may confound results. They use an MOI below 0.3.`,
    );
  } else if (inputs.moi > 0.3) {
    add(
      "moi",
      "info",
      "MOI is above the protocol's 0.3",
      `At MOI ${inputs.moi}, ${(plan.transduction.multiFraction * 100).toFixed(0)}% of infected cells carry two or more guides. The trade is fewer cells to transduce against more cells with two guides.`,
    );
  } else {
    add(
      "moi",
      "ok",
      "MOI keeps most cells to one guide",
      `At MOI ${inputs.moi}, ${(plan.transduction.pInfected * 100).toFixed(0)}% of cells are infected and ${(plan.transduction.multiFraction * 100).toFixed(0)}% of those carry two or more guides.`,
    );
  }

  if (inputs.readsPerGuide < 100) {
    add("depth", "warn", "Sequencing is shallow", `${inputs.readsPerGuide} reads per guide leaves a guide-level fold change dominated by counting noise. Joung et al. ask for more than 100 reads per guide to check a library and more than 500 for a screen.`);
  } else if (inputs.readsPerGuide < 500) {
    add("depth", "info", "Sequencing is below the protocol's 500", `${inputs.readsPerGuide} reads per guide. Joung et al. aim for more than 500 reads per guide for screening analysis. ${formatPct(plan.representation.readsBelowFloor)} of guides are expected under ${inputs.readFloor} reads at this library skew.`);
  } else {
    add("depth", "ok", "Sequencing depth meets the protocol's 500", `${inputs.readsPerGuide} reads per guide. ${formatPct(plan.representation.readsBelowFloor)} of guides are expected under ${inputs.readFloor} reads at this library skew.`);
  }

  if (inputs.skew > 10) {
    add("skew", "warn", "Library skew is above the protocol limit", `A 90th to 10th percentile ratio of ${inputs.skew} is over the 10 that Joung et al. give as the limit for a usable library. Re-amplify the pool, or plan for ${plan.representation.coverageFor99 ?? "more than 1,000,000"} cells per guide to keep 99% of guides over ${inputs.cellFloor} cells.`);
  }

  if (inputs.replicates < 2) {
    add("replicates", "warn", "One replicate cannot estimate variability", "With a single replicate there is no way to tell a real effect from a noisy guide. Use at least two, and three where cells allow.");
  }

  if (inputs.design === "dropout" && inputs.screenDays < 14) {
    add("days", "info", "A short dropout screen", `${inputs.screenDays} days may not be long enough for essential-gene depletion to separate from noise. Fitness screens usually run two to three weeks.`);
  }

  if (plan.transduction.expansionDays > 21) {
    add("expansion", "warn", "Reaching the required cell number takes a long time", `Growing from ${inputs.startingCellsM} million to ${(plan.transduction.cellsToTransduce / 1e6).toFixed(0)} million cells takes about ${Math.ceil(plan.transduction.expansionDays)} days at this doubling time. Primary and slow-growing cells often cannot be expanded that far, which decides the scope before any statistic does. Consider a focused library.`);
  }

  if (plan.samples.cellsPerSample > 2e8) {
    add("scale", "info", "Each sample is a large culture", `${(plan.samples.cellsPerSample / 1e6).toFixed(0)} million cells must be held per sample, across ${plan.samples.flasks} flasks plus a reference.`);
  }

  if (plan.sequencing.runFraction > 1) {
    add("run", "info", "More than one sequencing run", `The samples need ${(plan.sequencing.runFraction * 100).toFixed(0)}% of a run of this size, so ${plan.sequencing.runsNeeded} runs or a larger one.`);
  }

  if (plan.library.controls < 100 && plan.library.controls > 0) {
    add("controls", "info", "Few control guides", `${plan.library.controls} control guides make an empirical null thin. Libraries such as Brunello carry 1,000.`);
  } else if (plan.library.controls === 0) {
    add("controls", "info", "No control guides counted", "Without non-targeting or safe-targeting controls, guide effects cannot be separated from the cost of cutting alone.");
  }

  if (!plan.library.fromCatalog && inputs.guidesPerGene < 3) {
    add("guides", "info", "Fewer than three guides per gene", "Two guides per gene halves the evidence for each gene. Libraries built for coverage-limited settings do this on purpose, and accept the loss.");
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

const SHORT_KEYS: Record<keyof PlanInputs, string> = {
  library: "lib", genes: "genes", guidesPerGene: "gpg", controls: "ctrl", coverage: "cov", moi: "moi",
  startingCellsM: "start", doublingHours: "dbl", design: "des", replicates: "rep", screenDays: "days",
  readsPerGuide: "rpg", runReadsM: "run", skew: "skew", cellFloor: "cfl", readFloor: "rfl",
  gdnaPgPerCell: "pg", gdnaUgPerPcr: "ugpcr", costLibrary: "clib", costVirus: "cvir",
  costCulturePerBillion: "ccul", costGdnaPerUg: "cdna", costPcr: "cpcr", costSeqPerMillion: "cseq",
  weeksLibrary: "wlib", weeksVirus: "wvir", weeksSelection: "wsel", weeksHarvest: "wharv",
  weeksSequencing: "wseq", weeksAnalysis: "wana",
};

/** Only what differs from the defaults, so a shared link is short and stable. */
export function inputsToParams(inputs: PlanInputs): URLSearchParams {
  const params = new URLSearchParams();
  (Object.keys(SHORT_KEYS) as (keyof PlanInputs)[]).forEach((key) => {
    if (inputs[key] !== DEFAULT_INPUTS[key]) params.set(SHORT_KEYS[key], String(inputs[key]));
  });
  return params;
}

export function paramsToRaw(params: URLSearchParams | Record<string, string | string[] | undefined>) {
  const get = (name: string): string | undefined => {
    if (params instanceof URLSearchParams) return params.get(name) ?? undefined;
    const value = params[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const raw: Partial<Record<keyof PlanInputs, unknown>> = {};
  (Object.keys(SHORT_KEYS) as (keyof PlanInputs)[]).forEach((key) => {
    const value = get(SHORT_KEYS[key]);
    if (value !== undefined) raw[key] = value;
  });
  return raw;
}

/** A preset's own inputs over the defaults, so choosing one is never partial. */
export function applyPreset(preset: Preset): PlanInputs {
  return sanitizeInputs({ ...DEFAULT_INPUTS, ...preset.inputs }).inputs;
}

// ---------------------------------------------------------------------------
// Formatting the plan for people and files
// ---------------------------------------------------------------------------

export function planRows(inputs: PlanInputs, plan: Plan): (string | number)[][] {
  const rows: (string | number)[][] = [];
  const add = (section: string, quantity: string, value: string | number, unit: string, note = "") =>
    rows.push([section, quantity, typeof value === "number" ? Number(value.toPrecision(6)) : value, unit, note]);

  add("Library", "Library", plan.library.name, "", plan.library.fromCatalog ? "Counts from the engine's parse of the library file" : "Entered");
  add("Library", "Genes", plan.library.genes, "genes");
  add("Library", "Targeting guides", plan.library.targeting, "guides");
  add("Library", "Control guides", plan.library.controls, "guides");
  add("Library", "Total guides", plan.library.guides, "guides");
  add("Transduction", "Fraction infected", plan.transduction.pInfected, "fraction", "1 - exp(-MOI)");
  add("Transduction", "Infected cells with two or more guides", plan.transduction.multiFraction, "fraction");
  add("Transduction", "Cells to transduce", plan.transduction.cellsToTransduce, "cells", "guides x coverage / fraction infected");
  add("Samples", "Cells held per sample", plan.samples.cellsPerSample, "cells", "guides x coverage");
  add("Samples", "Flasks", plan.samples.flasks, "flasks", `${plan.samples.arms} arm(s) x ${inputs.replicates} replicate(s)`);
  add("Samples", "Samples sequenced", plan.samples.total, "samples", "flasks plus a day-zero reference");
  add("Sequencing", "Reads per sample", plan.sequencing.readsPerSample, "reads");
  add("Sequencing", "Total reads", plan.sequencing.totalReads, "reads");
  add("Sequencing", "Fraction of one run", plan.sequencing.runFraction, "fraction", `${inputs.runReadsM} million reads per run`);
  add("Sequencing", "gDNA per sample", plan.sequencing.gdnaPerSampleUg, "ug");
  add("Sequencing", "PCR reactions", plan.sequencing.pcrTotal, "reactions");
  add("Representation", "Library skew (90th / 10th)", inputs.skew, "ratio", "Assumed, not measured");
  add("Representation", `Guides under ${inputs.cellFloor} cells`, plan.representation.cellsBelowFloor, "fraction");
  add("Representation", `Guides under ${inputs.readFloor} reads`, plan.representation.readsBelowFloor, "fraction");
  add("Noise floor", "Guide log2 fold change, sampling noise", plan.noise.guideSeLog2, "log2", "Lower bound; excludes biological variation");
  add("Noise floor", "Gene log2 fold change, sampling noise", plan.noise.geneSeLog2, "log2", "Lower bound; excludes biological variation");
  add("Timeline", "Total", plan.timeline.totalWeeks, "weeks", "Sum of the phases, rounded up");
  for (const line of plan.costs.lines) add("Cost", line.label, Number(line.amount.toFixed(2)), "USD", line.driver);
  add("Cost", "Total", Number(plan.costs.total.toFixed(2)), "USD", "Consumables and sequencing only. Excludes labour, equipment time and analysis");
  return rows;
}

export const PLAN_COLUMNS = ["section", "quantity", "value", "unit", "note"] as const;
