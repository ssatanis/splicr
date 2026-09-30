/**
 * Fixture data for the dashboard. Deterministic (seeded) so screenshots and
 * tests are stable. Replace with Supabase queries once the engine is live.
 * Every value here is illustrative and is labelled as sample data wherever it
 * is rendered.
 *
 * WHY THIS FILE IS GENERATED THE WAY IT IS
 *
 * A fixture that a console makes claims about is not free to be arbitrary. If
 * the UI says "candidates were cut at FDR 0.10" then every row in the fixture
 * has to survive that cut, and if it says "Benjamini-Hochberg" then the number
 * in the FDR column has to be a Benjamini-Hochberg q-value. The previous
 * version drew each column independently, so the file contradicted its own
 * labels: 108 of 212 rows sat above the threshold the preamble declared, 67 of
 * them at exactly 1.000, and the FDR column was `p * (40 + random * 400)`,
 * which is not a multiple-testing correction of anything.
 *
 * So the generator runs in the order the pipeline does, and each quantity is
 * computed from the one before it rather than drawn beside it:
 *
 *   1. A latent `real` coin, which is the fixture's ground truth and is never
 *      exported. It exists so the evidence below can be conditioned on it.
 *   2. The evidence a screen actually produces: effect size, how many guides
 *      agree, the gene-level p-value, the BAGEL2 Bayes factor, the Atlas
 *      history, and the artifact flags.
 *   3. `fdr`, a true Benjamini-Hochberg q-value over the p-values, corrected
 *      against the number of genes in the library rather than the number of
 *      rows that survived, and monotone by construction.
 *   4. `chance`, the calibrated score, as a logistic function of the evidence
 *      in step 2 including a penalty per flag. It is derived from the evidence,
 *      not the other way round, so the Bayes factor is independent evidence and
 *      a flagged gene cannot outrank a clean one on the same statistics.
 *   5. `verdict`, a label read off the score, the novelty and the frequent-hitter
 *      flag. One function, so no surface can disagree about which bucket a gene
 *      is in.
 *
 * The candidate set is then the rows whose q-value clears the threshold, and
 * `hits` / `realHits` on each screen are counted from that table rather than
 * typed in above it. That is what stops one page saying 41 and the next 98.
 */
import { GENE_POOL, MOUSE_GENE_POOL } from "./genes";

export type Verdict = "Real and new" | "Real but generic" | "Real and known" | "Artifact" | "Uncertain";
export type StageStatus = "done" | "running" | "queued" | "failed" | "skipped";
export type ScreenStatus = "complete" | "running" | "queued" | "failed" | "draft";
/** Which arm of a selection screen a gene came out of. */
export type Direction = "depleted" | "enriched";

/** The candidate cut. Stated once, used by the generator and by every label. */
export const FDR_THRESHOLD = 0.1;

/** Where "likely real" is drawn. One constant, so no two pages count it differently. */
export const LIKELY_REAL_THRESHOLD = 0.6;

/**
 * Half-width of the calibration interval on chance real.
 *
 * It was written out as "±0.06" in four unrelated files, which is four chances
 * for the printed band to drift away from the one the score is actually
 * calibrated to. It matters more than a tidy-up: the top twenty rows of the
 * candidate table span 96% to 88%, entirely inside this band, so any page that
 * ranks by chance real is ordering the head of its list by noise and has to say
 * so beside the column.
 */
export const CALIBRATION_BAND = 0.06;

/** Public screens in the Atlas. The per-gene denominators are subsets of this. */
export const ATLAS_SCREENS_TOTAL = 2_217;
export const ATLAS_HITS_WITH_OUTCOMES = 1_840;
export const ATLAS_RERUN_FROM_RAW = 96;

/**
 * What the pipeline does with a sample that breaches a distribution ceiling.
 * Printed with the weight, because "down-weighted, not dropped" without a number
 * tells a reader nothing about how much of the run they are still looking at.
 */
export const BOTTLENECK_WEIGHT = 0.35;

export interface Screen {
  id: string;
  name: string;
  cellLine: string;
  organism: "Human" | "Mouse";
  library: string;
  modality: "Knockout" | "CRISPRi" | "CRISPRa";
  phenotype: string;
  /** The re-test a validation plan for this screen would order. */
  benchAssay: string;
  status: ScreenStatus;
  qc: "pass" | "warn" | "fail" | "pending";
  /** Counted from this screen's hit table, never typed in. */
  hits: number;
  /** Rows at or above LIKELY_REAL_THRESHOLD, counted from the same table. */
  realHits: number;
  createdAt: string;
  owner: string;
  stage: number; // 0-9 stages complete
}

export interface Hit {
  gene: string;
  rank: number;
  lfc: number;
  /** Which arm the gene came out of. A survival screen has both. */
  direction: Direction;
  pValue: number;
  /** Benjamini-Hochberg q-value over `nTests` gene-level tests. */
  fdr: number;
  bayesFactor: number;
  guides: number;
  guidesAgree: number;
  /**
   * Each guide's own log2 fold change, which is what the concordance view draws.
   *
   * Derived from `guidesAgree` so the picture and the count cannot contradict
   * each other: the agreeing guides scatter around the gene-level effect, and
   * the rest sit near zero or cross it. That is the shape the real column has —
   * PARG reads [+4.34, +3.41, +1.55] and COG4 [+5.32, +5.92, -0.79].
   */
  guideLfcs: number[];
  chance: number;
  novelty: number;
  verdict: Verdict;
  flags: string[];
  why: string;
  atlasHits: number;
  /** Atlas screens that assayed this gene, which is a subset of the corpus. */
  atlasScreens: number;
}

export interface Sample {
  id: string;
  label: string;
  condition: string;
  replicate: number;
  timepoint: string;
  reads: number;
  mapped: number;
  zeroGuides: number;
  gini: number;
  skewRatio: number;
  verdict: "pass" | "warn" | "fail";
}

export interface StageRun {
  key: string;
  title: string;
  status: StageStatus;
  startedAt?: string;
  durationSec?: number;
  detail: string;
  tool?: string;
}

export interface AtlasScreen {
  id: string;
  source: string;
  title: string;
  cellLine: string;
  organism: "Human" | "Mouse";
  library: string;
  modality: "Knockout" | "CRISPRi" | "CRISPRa";
  phenotype: string;
  year: number;
  similarity: number;
  sharedHits: number;
}

export interface Outcome {
  id: string;
  screenId: string;
  gene: string;
  predicted: number;
  result: "validated" | "failed" | "inconclusive" | "pending";
  assay: string;
  loggedAt: string;
  by: string;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString();

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Guide and gene counts verified against the distributed library files (Sep 2026). */
export const libraries = [
  { name: "Brunello", guides: 76_441, genes: 19_114, perGene: 4, cas: "SpCas9", organism: "Human" },
  { name: "GeCKOv2 (A+B)", guides: 123_411, genes: 19_050, perGene: 6, cas: "SpCas9", organism: "Human" },
  { name: "TKOv3", guides: 70_944, genes: 18_052, perGene: 4, cas: "SpCas9", organism: "Human" },
  { name: "Avana", guides: 76_106, genes: 17_670, perGene: 4, cas: "SpCas9", organism: "Human" },
  { name: "Humagne C", guides: 20_355, genes: 19_755, perGene: 2, cas: "enAsCas12a", organism: "Human" },
  { name: "Dolcetto A (CRISPRi)", guides: 57_050, genes: 18_898, perGene: 3, cas: "dCas9-KRAB", organism: "Human" },
  { name: "Calabrese A (CRISPRa)", guides: 56_762, genes: 18_886, perGene: 3, cas: "dCas9-p65-HSF", organism: "Human" },
  { name: "Brie", guides: 78_637, genes: 19_674, perGene: 4, cas: "SpCas9", organism: "Mouse" },
];

/** Genes in the library, which is the number of gene-level tests BH corrects over. */
function testsInLibrary(label: string): number {
  return libraries.find((l) => l.name === label)?.genes ?? 19_000;
}

// ---------------------------------------------------------------------------
// The hit generator
// ---------------------------------------------------------------------------

/** Frequent-hitter cut: a gene called in more than a quarter of the screens that assayed it. */
const FREQUENT_HITTER_RATE = 0.25;

/**
 * One artifact flag costs this much log-odds on the score.
 *
 * The audit found the ranking indifferent to its own flags: a gene carrying
 * "Frequent hitter" was the top recommendation. Flags are evidence about
 * whether a signal is the gene, so they belong inside the score, and they are
 * still printed next to the statistic that raised them so a reader can disagree.
 */
const FLAG_PENALTY = 1.15;

interface BuildOptions {
  seed: number;
  /** How many candidates the screen called. The generator produces exactly this many. */
  candidates: number;
  /** Symbols to draw from, so a mouse screen never reports human symbols. */
  pool: readonly string[];
  /** Gene-level tests the BH correction runs over. */
  nTests: number;
  /** Genes that must appear, because a logged bench outcome refers to them. */
  pinned?: readonly string[];
  /** True when this screen has a down-weighted replicate to attribute signal to. */
  hasBottleneck?: boolean;
  /** Fraction of candidates coming out of the positive-selection arm. */
  enrichedFraction?: number;
}

interface Draft {
  gene: string;
  real: boolean;
  direction: Direction;
  lfc: number;
  pValue: number;
  guides: number;
  guidesAgree: number;
  guideLfcs: number[];
  bayesFactor: number;
  atlasScreens: number;
  atlasHits: number;
  novelty: number;
  flags: string[];
}

/**
 * The p-value budget a candidate has to fit inside to survive the cut.
 *
 * Benjamini-Hochberg keeps rank i when p_i <= threshold * i / m, so the largest
 * p-value in a set of n candidates over m tests is at most threshold * n / m.
 * The generator draws inside that budget rather than drawing freely and then
 * printing a threshold the rows do not meet.
 */
function pValueCeiling(candidates: number, nTests: number): number {
  return (FDR_THRESHOLD * candidates) / nTests;
}

function draftHits(o: BuildOptions): Draft[] {
  const r = rng(o.seed);
  const pool = [...o.pool];
  const pinned = [...(o.pinned ?? [])];
  const ceiling = pValueCeiling(o.candidates, o.nTests);
  // A margin below the ceiling, so the weakest candidate lands under the
  // threshold rather than exactly on it.
  const minExponent = -Math.log10(ceiling) + 0.12;
  const drafts: Draft[] = [];

  for (let i = 0; i < o.candidates; i++) {
    const gene =
      pinned.length > 0
        ? pinned.shift()!
        : pool.length > 0
          ? pool.splice(Math.floor(r() * pool.length), 1)[0]
          : `LOC${100_000 + i}`;
    // Keep a pinned gene out of the random draw as well.
    const dup = pool.indexOf(gene);
    if (dup >= 0) pool.splice(dup, 1);

    const real = r() < 0.46;
    const direction: Direction = r() < (o.enrichedFraction ?? 0) ? "enriched" : "depleted";

    // Effect size. A real hit moves further, and the positive-selection arm is
    // noisier because enrichment is bounded by how fast survivors can outgrow.
    const magnitude = (real ? 1.0 + r() * 2.3 : 0.45 + r() * 1.0) * (direction === "enriched" ? 0.75 : 1);
    const lfc = direction === "enriched" ? magnitude : -magnitude;

    const guides = 4;
    // Guide concordance is the single most diagnostic piece of evidence a screen
    // produces, so it separates the two populations hardest.
    const guidesAgree = real ? (r() < 0.62 ? 4 : 3) : r() < 0.55 ? 1 : r() < 0.9 ? 2 : 3;
    const concordance = guidesAgree / guides;

    // The agreeing guides scatter around the gene-level effect; the rest sit near
    // zero or cross it, which is exactly what makes a one-guide hit look wrong at
    // a glance where the gene-level number alone looks fine.
    const guideLfcs = Array.from({ length: guides }, (_, i) =>
      i < guidesAgree
        ? Number((lfc * (0.72 + r() * 0.56)).toFixed(2))
        : Number((lfc * (r() * 0.3 - 0.18)).toFixed(2)),
    );

    // The gene-level p-value follows the effect and the concordance, inside the
    // budget the threshold allows.
    const exponent = minExponent + (0.7 * magnitude + 3.4 * concordance + r() * 1.6) * (real ? 1 : 0.55);
    const pValue = Math.pow(10, -exponent);

    // BAGEL2 Bayes factor. Computed from guide fold changes against the
    // reference sets, so it depends on the effect and the concordance with its
    // own noise, and never on the score that is derived from it further down.
    // The noise term is wide on purpose. It is the part of the Bayes factor that
    // the effect size and the concordance do not already say, and it is what
    // makes this column evidence rather than a restatement of its neighbours.
    const bayesFactor = Number(
      ((real ? 2.5 : -7.5) + magnitude * 5.2 + concordance * 7.5 + (r() - 0.5) * 13).toFixed(1),
    );

    // Atlas history. Most genes are called rarely; a tail of core-essential and
    // stress-response genes is called in a large share of everything.
    const atlasScreens = 900 + Math.floor(r() * 400);
    const hitRate = Math.pow(r(), 2.6) * 0.62;
    const atlasHits = Math.round(hitRate * atlasScreens);
    // Anti-correlated with the Atlas hit rate, because a gene called in a large
    // share of the screens that assayed it is by definition not new anywhere.
    const novelty = Number(clamp(Math.pow(r(), 1.25) * (1 - hitRate / 0.62) + 0.02, 0.02, 0.99).toFixed(2));

    // Flags come from the structural causes that raise them, not from a label.
    const flags: string[] = [];
    if (guidesAgree === 1) flags.push("One guide drives signal");
    if (hitRate > FREQUENT_HITTER_RATE) flags.push("Frequent hitter");
    if (r() < 0.07) flags.push("Copy-number cluster");
    if (r() < 0.05) flags.push("Promiscuous guide");
    if (r() < 0.05) flags.push("Low guide coverage");
    if (o.hasBottleneck && r() < 0.08) flags.push("Bottlenecked replicate");

    drafts.push({
      gene,
      real,
      direction,
      lfc: Number(lfc.toFixed(2)),
      pValue,
      guides,
      guidesAgree,
      guideLfcs,
      bayesFactor,
      atlasScreens,
      atlasHits,
      novelty,
      flags,
    });
  }

  return drafts;
}

/**
 * Benjamini-Hochberg over `nTests` gene-level tests.
 *
 * `drafts` must already be sorted by ascending p-value. The step-up pass from
 * the bottom is what makes the column monotone: a q-value can never be smaller
 * than the one above it, which is the property the audit found violated on 66
 * adjacent pairs.
 */
function benjaminiHochberg(sortedP: number[], nTests: number): number[] {
  const q = sortedP.map((p, i) => Math.min(1, (p * nTests) / (i + 1)));
  for (let i = q.length - 2; i >= 0; i--) q[i] = Math.min(q[i], q[i + 1]);
  return q;
}

/**
 * Chance real: a logistic read of the evidence.
 *
 * Every term is something the pipeline measured. The flag term is what stops
 * the ranking being indifferent to its own artifact calls.
 */
function scoreOf(d: Draft, minExponent: number): number {
  const concordance = d.guidesAgree / d.guides;
  const significance = -Math.log10(d.pValue) - minExponent;
  const z =
    -3.85 +
    0.55 * Math.abs(d.lfc) +
    3.0 * concordance +
    0.2 * significance +
    0.045 * d.bayesFactor -
    FLAG_PENALTY * d.flags.length;
  // Bounded, because a calibrated probability of 1.00 on four guides is a claim
  // no screen can support, and the band on the score is plus or minus 0.06.
  return clamp(1 / (1 + Math.exp(-z)), 0.02, 0.97);
}

/**
 * One place decides which bucket a gene is in, so no surface can disagree.
 *
 * "Artifact" is a mechanistic claim and needs a named mechanism behind it, so it
 * requires an artifact flag and not merely a low score. A low score with nothing
 * to blame it on is uncertain, which is a different and weaker statement.
 * "Frequent hitter" is not an artifact: the signal is real, it is just not
 * specific to the condition, which is what "Real but generic" says.
 */
function verdictOf(chance: number, novelty: number, flags: string[]): Verdict {
  const mechanism = flags.some((f) => f !== "Frequent hitter");
  if (chance < LIKELY_REAL_THRESHOLD) return mechanism ? "Artifact" : "Uncertain";
  if (flags.includes("Frequent hitter")) return "Real but generic";
  return novelty >= 0.6 ? "Real and new" : "Real and known";
}

/**
 * The evidence sentence, composed from the row's own numbers.
 *
 * It used to be one of three stock phrases picked at random per verdict, which
 * meant a row could claim "all guides agree" beside a 2 of 4. Writing it from
 * the values means it cannot contradict the columns beside it.
 */
function describe(d: Draft, chance: number): string {
  const parts: string[] = [];
  parts.push(
    d.guidesAgree === d.guides
      ? `all ${d.guides} guides agree`
      : `${d.guidesAgree} of ${d.guides} guides agree`,
  );
  parts.push(
    `${d.direction === "enriched" ? "enriched" : "depleted"} at log2 ${d.lfc.toFixed(2)}`,
  );
  parts.push(`Bayes factor ${d.bayesFactor.toFixed(1)}`);
  parts.push(
    d.atlasHits === 0
      ? "never called in the Atlas screens that assayed it"
      : `called in ${d.atlasHits} of the ${d.atlasScreens} Atlas screens that assayed it`,
  );
  if (d.flags.length > 0) {
    parts.push(
      `${d.flags.join(" and ").toLowerCase()}, which cost it ${(FLAG_PENALTY * d.flags.length).toFixed(2)} log-odds`,
    );
  }
  const lead = chance >= LIKELY_REAL_THRESHOLD ? "Kept" : "Held back";
  return `${lead}: ${parts.join("; ")}.`;
}

export function buildHits(options: BuildOptions): Hit[] {
  const drafts = draftHits(options);
  drafts.sort((a, b) => a.pValue - b.pValue);

  const q = benjaminiHochberg(
    drafts.map((d) => d.pValue),
    options.nTests,
  );
  const minExponent = -Math.log10(pValueCeiling(options.candidates, options.nTests)) + 0.12;

  return drafts.map((d, i) => {
    const chance = Number(scoreOf(d, minExponent).toFixed(2));
    const verdict = verdictOf(chance, d.novelty, d.flags);
    return {
      gene: d.gene,
      rank: i + 1,
      lfc: d.lfc,
      direction: d.direction,
      pValue: d.pValue,
      fdr: q[i],
      bayesFactor: d.bayesFactor,
      guides: d.guides,
      guidesAgree: d.guidesAgree,
      guideLfcs: d.guideLfcs,
      chance,
      novelty: d.novelty,
      verdict,
      flags: d.flags,
      why: describe(d, chance),
      atlasHits: d.atlasHits,
      atlasScreens: d.atlasScreens,
    };
  });
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

/**
 * A screen's record, before its hit counts are filled in from its hit table.
 *
 * `candidates` is how many genes cleared the FDR cut, so the table is built at
 * that size and `hits` is read back off it. A screen the pipeline has not
 * reached the hit-calling stage on has no table at all, which is not the same
 * thing as a table with nothing in it.
 */
interface ScreenFixture extends Omit<Screen, "hits" | "realHits"> {
  candidates: number;
  seed: number;
  pinned?: readonly string[];
  hasBottleneck?: boolean;
  enrichedFraction?: number;
}

const FIXTURES: ScreenFixture[] = [
  {
    id: "scr_demo",
    name: "A375 ferroptosis sensitizers",
    cellLine: "A375",
    organism: "Human",
    library: "Brunello",
    modality: "Knockout",
    phenotype: "RSL3 survival, 14 d",
    benchAssay: "Arrayed KO, RSL3 viability",
    status: "complete",
    // One sample breaches all three distribution ceilings, so the screen cannot
    // carry a clean verdict. It was down-weighted rather than dropped, which is
    // a warning, not a pass.
    qc: "warn",
    createdAt: daysAgo(3.2),
    owner: "You",
    stage: 9,
    candidates: 212,
    seed: 11,
    hasBottleneck: true,
    // A survival screen has a positive-selection arm: knocking out a ferroptosis
    // executioner protects, so those genes come out enriched.
    enrichedFraction: 0.22,
  },
  {
    id: "scr_002",
    name: "HAP1 essentiality baseline",
    cellLine: "HAP1",
    organism: "Human",
    library: "TKOv3",
    modality: "Knockout",
    phenotype: "Proliferation, 18 d",
    benchAssay: "Competition assay against a non-targeting pool",
    status: "complete",
    qc: "pass",
    createdAt: daysAgo(9.2),
    owner: "You",
    stage: 9,
    // A proliferation baseline calls far more than a drug screen, and the
    // fixture names every one of them from a real symbol list, so the count is
    // what the list can actually cover rather than a round number typed above it.
    candidates: 184,
    seed: 4_021,
    enrichedFraction: 0.04,
  },
  {
    id: "scr_003",
    name: "Jurkat IFN-γ resistance (CRISPRi)",
    cellLine: "Jurkat",
    organism: "Human",
    library: "Dolcetto A (CRISPRi)",
    modality: "CRISPRi",
    phenotype: "IFN-γ, sorted PD-L1 low",
    benchAssay: "Arrayed CRISPRi, PD-L1 flow",
    status: "running",
    qc: "warn",
    createdAt: daysAgo(0.2),
    owner: "R. Alvarez",
    // Four stages finished, so the run is inside stage 5, which is hit calling.
    // It used to say five, which marked hit calling done on a screen that has no
    // hit table, and the tab badge then invented one.
    stage: 4,
    candidates: 0,
    seed: 7_712,
  },
  {
    id: "scr_004",
    name: "B16-F10 in vivo tumor growth",
    cellLine: "B16-F10",
    organism: "Mouse",
    library: "Brie",
    modality: "Knockout",
    phenotype: "In vivo, 21 d",
    benchAssay: "In vivo re-test, subcutaneous",
    status: "complete",
    qc: "warn",
    createdAt: daysAgo(14.2),
    owner: "R. Alvarez",
    stage: 9,
    candidates: 96,
    seed: 9_143,
    enrichedFraction: 0.35,
  },
  {
    id: "scr_005",
    name: "MOLM-13 venetoclax",
    cellLine: "MOLM-13",
    organism: "Human",
    library: "GeCKOv2 (A+B)",
    modality: "Knockout",
    phenotype: "Venetoclax 100 nM, 12 d",
    benchAssay: "Arrayed KO, venetoclax viability",
    status: "failed",
    qc: "fail",
    createdAt: daysAgo(20.2),
    owner: "You",
    // Three stages finished, so it failed inside stage 4, which is QC. That is
    // what every sentence about this screen already said.
    stage: 3,
    candidates: 0,
    seed: 5_501,
  },
  {
    id: "scr_006",
    name: "K562 CRISPRa drug efflux",
    cellLine: "K562",
    organism: "Human",
    library: "Calabrese A (CRISPRa)",
    modality: "CRISPRa",
    phenotype: "Doxorubicin, 10 d",
    benchAssay: "Arrayed CRISPRa, doxorubicin viability",
    status: "queued",
    qc: "pending",
    createdAt: daysAgo(0.05),
    owner: "M. Chen",
    stage: 0,
    candidates: 0,
    seed: 3_318,
  },
];

/**
 * Each screen's own hit table.
 *
 * Built once at module load, keyed by screen id. The console used to serve the
 * A375 human table to every screen, sliced by `screen.hits % 120`, which is how
 * a mouse screen came to export 96 human symbols under GRCm39 and how a running
 * screen with no hits came to show a tab badge of 12.
 */
const HIT_TABLES: Map<string, Hit[]> = new Map(
  FIXTURES
    // No entry at all for a run that has not reached hit calling, so the lookup
    // below can answer "not called" rather than "called nothing". A completed
    // screen always gets a table, even an empty one, because zero candidates is
    // then a result the run produced.
    .filter((f) => f.candidates > 0 || f.status === "complete")
    .map((f) => [
      f.id,
      buildHits({
        seed: f.seed,
        candidates: f.candidates,
        pool: f.organism === "Mouse" ? MOUSE_GENE_POOL : GENE_POOL,
        nTests: testsInLibrary(f.library),
        pinned: f.pinned,
        hasBottleneck: f.hasBottleneck,
        enrichedFraction: f.enrichedFraction,
      }),
    ]),
);

/**
 * The hit table for a screen, or null when hit calling has not run.
 *
 * Null rather than an empty array on purpose: the Hits tab has to tell "this
 * screen called nothing" apart from "this screen has not been called yet", and
 * an empty array cannot carry that difference.
 */
export function hitsForScreen(screenId: string): Hit[] | null {
  return HIT_TABLES.get(screenId) ?? null;
}

/** Gene-level tests the BH correction on this screen ran over. */
export function testsForScreen(screen: Screen): number {
  return testsInLibrary(screen.library);
}

export const screens: Screen[] = FIXTURES.map((f) => {
  const table = HIT_TABLES.get(f.id) ?? [];
  // Listed field by field rather than spread, so a generator knob added to
  // ScreenFixture cannot leak out onto the Screen every page renders.
  return {
    id: f.id,
    name: f.name,
    cellLine: f.cellLine,
    organism: f.organism,
    library: f.library,
    modality: f.modality,
    phenotype: f.phenotype,
    benchAssay: f.benchAssay,
    status: f.status,
    qc: f.qc,
    createdAt: f.createdAt,
    owner: f.owner,
    stage: f.stage,
    hits: table.length,
    realHits: table.filter((h) => h.chance >= LIKELY_REAL_THRESHOLD).length,
  };
});

/** The screen the shipped QC, replicate and control-separation block belongs to. */
export const QC_SCREEN_ID = "scr_demo";

export const demoHits: Hit[] = HIT_TABLES.get(QC_SCREEN_ID) ?? [];

export const samples: Sample[] = [
  { id: "s1", label: "Plasmid", condition: "plasmid", replicate: 1, timepoint: "d0", reads: 42_115_920, mapped: 0.94, zeroGuides: 0.001, gini: 0.07, skewRatio: 3.1, verdict: "pass" },
  { id: "s2", label: "T0 rep 1", condition: "T0", replicate: 1, timepoint: "d0", reads: 38_204_112, mapped: 0.92, zeroGuides: 0.004, gini: 0.09, skewRatio: 3.8, verdict: "pass" },
  { id: "s3", label: "T0 rep 2", condition: "T0", replicate: 2, timepoint: "d0", reads: 36_990_441, mapped: 0.93, zeroGuides: 0.004, gini: 0.09, skewRatio: 3.9, verdict: "pass" },
  { id: "s4", label: "DMSO rep 1", condition: "DMSO", replicate: 1, timepoint: "d14", reads: 41_003_870, mapped: 0.91, zeroGuides: 0.021, gini: 0.18, skewRatio: 6.4, verdict: "pass" },
  { id: "s5", label: "DMSO rep 2", condition: "DMSO", replicate: 2, timepoint: "d14", reads: 39_551_209, mapped: 0.9, zeroGuides: 0.024, gini: 0.19, skewRatio: 6.9, verdict: "pass" },
  { id: "s6", label: "RSL3 rep 1", condition: "RSL3", replicate: 1, timepoint: "d14", reads: 40_118_330, mapped: 0.9, zeroGuides: 0.048, gini: 0.27, skewRatio: 9.2, verdict: "pass" },
  // Gini 0.41 against a 0.30 ceiling, 14% zero-count guides against 5%, skew
  // 18.7 against 10. Three ceilings breached is a failed sample, not a warning;
  // the run survives it because the policy is to down-weight, not to drop.
  { id: "s7", label: "RSL3 rep 2", condition: "RSL3", replicate: 2, timepoint: "d14", reads: 24_390_118, mapped: 0.88, zeroGuides: 0.14, gini: 0.41, skewRatio: 18.7, verdict: "fail" },
];

export const replicateCorr: { a: string; b: string; r: number }[] = [
  { a: "T0 r1", b: "T0 r2", r: 0.97 },
  { a: "DMSO r1", b: "DMSO r2", r: 0.93 },
  { a: "RSL3 r1", b: "RSL3 r2", r: 0.81 },
  { a: "DMSO r1", b: "RSL3 r1", r: 0.86 },
];

export const controlSeparation = {
  auroc: 0.93,
  auprc: 0.88,
  nnmd: -1.62,
  essential: 684,
  nonessential: 927,
  library: "Brunello",
  atlasMedianAuroc: 0.91,
};

/**
 * The nine stages, as offsets from the screen's own created time.
 *
 * Absolute timestamps used to live here, which put every screen's run in the
 * same three days and let one screen's record be created 43 minutes after its
 * own run finished. `stagesForScreen` walks these offsets forward from the
 * screen's `createdAt`, so a run can never start before the screen exists.
 */
interface StageTemplate {
  key: string;
  title: string;
  /** Minutes after the screen was created. */
  offsetMin: number;
  durationSec: number;
  tool: string;
  /** Written from the screen's own record, so it never describes another run. */
  detail: (screen: Screen, hits: Hit[]) => string;
}

const STAGE_TEMPLATES: StageTemplate[] = [
  {
    key: "ingest",
    title: "Ingest",
    offsetMin: 3,
    durationSec: 212,
    tool: "tus + S3",
    detail: (s) => `Upload accepted for ${s.cellLine}, checksums verified`,
  },
  {
    key: "detect",
    title: "Detect library",
    offsetMin: 8,
    durationSec: 41,
    tool: "fingerprint",
    detail: (s) => {
      const lib = libraries.find((l) => l.name === s.library);
      return lib
        ? `${lib.name} (${lib.guides.toLocaleString("en-US")} guides): matched from sampled reads`
        : `${s.library}: guide counts are not registered for this library version`;
    },
  },
  {
    key: "count",
    title: "Count",
    offsetMin: 12,
    durationSec: 1_880,
    tool: "mageck count 0.5.9.5",
    detail: () => "Exact match with a one-mismatch fallback, median-ratio normalised",
  },
  {
    key: "qc",
    title: "QC",
    offsetMin: 46,
    durationSec: 96,
    tool: "splicr.qc",
    detail: (s) =>
      s.id === QC_SCREEN_ID
        ? `RSL3 rep 2 breached three distribution ceilings; down-weighted to ${BOTTLENECK_WEIGHT.toFixed(2)}`
        : `Overall verdict ${s.qc}; per-sample metrics are not recorded for this screen`,
  },
  {
    key: "hits",
    title: "Call hits",
    offsetMin: 49,
    durationSec: 640,
    tool: "mageck test / mle, BAGEL2, CRISPRcleanR",
    detail: (s, hits) =>
      `${hits.length} genes cleared Benjamini-Hochberg FDR ${FDR_THRESHOLD.toFixed(2)} over ${testsForScreen(s).toLocaleString("en-US")} gene-level tests`,
  },
  {
    key: "artifacts",
    title: "Flag artifacts",
    offsetMin: 60,
    durationSec: 58,
    tool: "splicr.artifacts",
    detail: (_s, hits) => {
      const flagged = hits.filter((h) => h.flags.length > 0).length;
      return `${flagged} of ${hits.length} candidates carry at least one flag`;
    },
  },
  {
    key: "atlas",
    title: "Atlas context",
    offsetMin: 62,
    durationSec: 122,
    tool: "splicr.atlas",
    detail: (s) => {
      const near = atlasSimilarFor(s)[0];
      return near
        ? `Nearest comparable screen: ${near.id} (${near.cellLine}, ${near.phenotype}, ${near.library})`
        : "No comparable public screen in the Atlas for this context";
    },
  },
  {
    key: "score",
    title: "Score",
    offsetMin: 65,
    durationSec: 34,
    tool: "splicr.score v0.3",
    detail: (_s, hits) =>
      `${hits.filter((h) => h.chance >= LIKELY_REAL_THRESHOLD).length} candidates at chance real ${LIKELY_REAL_THRESHOLD.toFixed(2)} or above; calibration band ±${CALIBRATION_BAND.toFixed(2)}`,
  },
  {
    key: "report",
    title: "Report",
    offsetMin: 66,
    durationSec: 12,
    tool: "splicr.report",
    detail: () => "Hit Report built from the run record",
  },
];

/**
 * The run log for one screen: its own timings, its own numbers.
 *
 * Stages past the one the pipeline reached carry no detail and no duration,
 * because nothing has measured them.
 */
export function stagesForScreen(screen: Screen): StageRun[] {
  const hits = hitsForScreen(screen.id) ?? [];
  const created = Date.parse(screen.createdAt);
  const reached = screen.status === "complete" ? STAGE_TEMPLATES.length : screen.stage;

  return STAGE_TEMPLATES.map((t, i) => {
    const done = i < reached;
    const status: StageStatus = done
      ? "done"
      : i === reached && screen.status === "running"
        ? "running"
        : i === reached && screen.status === "failed"
          ? "failed"
          : "queued";
    return {
      key: t.key,
      title: t.title,
      status,
      startedAt: done || status === "running" || status === "failed" ? new Date(created + t.offsetMin * 60_000).toISOString() : undefined,
      durationSec: done ? t.durationSec : undefined,
      detail: done ? t.detail(screen, hits) : "",
      tool: t.tool,
    };
  });
}

// ---------------------------------------------------------------------------
// Atlas
// ---------------------------------------------------------------------------

const ATLAS_SCREENS: AtlasScreen[] = [
  { id: "ORCS-1741", source: "BioGRID ORCS", title: "Genome-wide screen for ferroptosis regulators in melanoma", cellLine: "A375", organism: "Human", library: "Brunello", modality: "Knockout", phenotype: "RSL3 survival", year: 2021, similarity: 0.91, sharedHits: 27 },
  { id: "ORCS-2033", source: "BioGRID ORCS", title: "GPX4 inhibitor resistance in lung adenocarcinoma", cellLine: "A549", organism: "Human", library: "Brunello", modality: "Knockout", phenotype: "ML210 survival", year: 2022, similarity: 0.84, sharedHits: 19 },
  { id: "ORCS-1266", source: "BioGRID ORCS", title: "Ferroptosis sensitizers in renal cell carcinoma", cellLine: "786-O", organism: "Human", library: "GeCKOv2", modality: "Knockout", phenotype: "Erastin survival", year: 2019, similarity: 0.77, sharedHits: 14 },
  { id: "DM-A375", source: "DepMap", title: "A375 Chronos gene effect", cellLine: "A375", organism: "Human", library: "Avana", modality: "Knockout", phenotype: "Proliferation", year: 2026, similarity: 0.71, sharedHits: 33 },
  { id: "ORCS-2418", source: "BioGRID ORCS", title: "Lipid peroxidation suppressors, CRISPRi", cellLine: "HT-1080", organism: "Human", library: "Dolcetto", modality: "CRISPRi", phenotype: "RSL3 survival", year: 2023, similarity: 0.69, sharedHits: 11 },
  { id: "ORCS-2650", source: "BioGRID ORCS", title: "In vivo tumour growth modifiers in melanoma", cellLine: "B16-F10", organism: "Mouse", library: "Brie", modality: "Knockout", phenotype: "In vivo growth", year: 2022, similarity: 0.82, sharedHits: 21 },
  { id: "ORCS-1988", source: "BioGRID ORCS", title: "Immune evasion in syngeneic melanoma", cellLine: "B16-F10", organism: "Mouse", library: "Brie", modality: "Knockout", phenotype: "CD8 co-culture", year: 2020, similarity: 0.74, sharedHits: 16 },
  { id: "PS-HAP1", source: "Project Score", title: "HAP1 core fitness genes", cellLine: "HAP1", organism: "Human", library: "TKOv3", modality: "Knockout", phenotype: "Proliferation", year: 2021, similarity: 0.88, sharedHits: 41 },
  { id: "ORCS-2201", source: "BioGRID ORCS", title: "Interferon-γ response in T-cell leukaemia", cellLine: "Jurkat", organism: "Human", library: "Dolcetto", modality: "CRISPRi", phenotype: "IFN-γ, PD-L1 sort", year: 2023, similarity: 0.79, sharedHits: 12 },
  { id: "GEO-4417", source: "GEO/SRA re-run", title: "Doxorubicin efflux, CRISPRa overexpression", cellLine: "K562", organism: "Human", library: "Calabrese", modality: "CRISPRa", phenotype: "Doxorubicin survival", year: 2024, similarity: 0.66, sharedHits: 9 },
];

export const atlasScreensList = ATLAS_SCREENS;

/**
 * The Atlas screens comparable to one of ours.
 *
 * Matched on organism and modality rather than returned wholesale, so a mouse
 * in-vivo screen is not offered a human CRISPRi screen as its nearest neighbour.
 */
export function atlasSimilarFor(screen: Screen): AtlasScreen[] {
  return ATLAS_SCREENS.filter((a) => a.organism === screen.organism && a.modality === screen.modality).sort(
    (a, b) => b.similarity - a.similarity,
  );
}

/** Kept for the ferroptosis screen's Atlas tab, which is what it was written for. */
export const atlasSimilar = atlasSimilarFor(screens[0]);

// ---------------------------------------------------------------------------
// Bench outcomes
// ---------------------------------------------------------------------------

/**
 * A bench outcome is drawn from the screen's own hit table, not typed in beside
 * it.
 *
 * The gene and its predicted score used to be independent literals, and once the
 * hit table started being generated rather than hand-written, the Truth Loop
 * showed a gene "Validated at the bench" next to a calibrated chance of 2%. A
 * demo that shows the score being wrong that badly is not showing the product.
 *
 * So a lab re-tests what the plan told it to re-test: outcomes are taken from
 * the top of the chance ordering. One of them did not validate, on purpose. A
 * calibrated 0.9 is wrong one time in ten, and that case is exactly the one the
 * validation plan has to handle by dropping the gene rather than keeping its
 * slot and its plate well.
 */
function nthByChance(screenId: string, n: number): Hit | null {
  const table = hitsForScreen(screenId);
  if (table === null) return null;
  return [...table].sort((a, b) => b.chance - a.chance)[n] ?? null;
}

function outcome(
  id: string,
  screenId: string,
  n: number,
  result: Outcome["result"],
  assay: string,
  loggedDaysAgo: number,
  by: string,
): Outcome | null {
  const hit = nthByChance(screenId, n);
  if (hit === null) return null;
  return { id, screenId, gene: hit.gene, predicted: hit.chance, result, assay, loggedAt: daysAgo(loggedDaysAgo), by };
}

export const outcomes: Outcome[] = [
  outcome("o1", "scr_demo", 0, "validated", "Arrayed KO, RSL3 viability", 1, "You"),
  outcome("o2", "scr_demo", 2, "validated", "Arrayed KO, RSL3 viability", 1, "You"),
  outcome("o3", "scr_demo", 4, "failed", "Competition assay", 1, "You"),
  outcome("o4", "scr_002", 1, "validated", "Competition assay", 6, "R. Alvarez"),
  outcome("o5", "scr_002", 5, "inconclusive", "Arrayed KO", 6, "R. Alvarez"),
  outcome("o6", "scr_004", 0, "validated", "In vivo re-test", 10, "R. Alvarez"),
  outcome("o7", "scr_004", 3, "pending", "In vivo re-test", 2, "R. Alvarez"),
].filter((o): o is Outcome => o !== null);

/**
 * The reliability curve, and what it is computed over.
 *
 * Not the seven outcomes above. Seven outcomes cannot fill six bins, and the
 * Truth Loop used to print "Outcomes logged 7" directly above a curve whose bin
 * counts summed to 300 under the heading "Across all logged outcomes". The
 * cohort is named here and the page prints the denominator, so the two numbers
 * on that screen are no longer offered as the same number.
 */
export const calibration = {
  cohort: "SplicR reference cohort",
  source: "Re-tests recorded in BioGRID ORCS plus outcomes from workspaces that opted in",
  bins: [
    { bin: "0–10%", predicted: 0.05, observed: 0.04, n: 88 },
    { bin: "10–20%", predicted: 0.15, observed: 0.13, n: 61 },
    { bin: "20–40%", predicted: 0.3, observed: 0.33, n: 47 },
    { bin: "40–60%", predicted: 0.5, observed: 0.47, n: 29 },
    { bin: "60–80%", predicted: 0.7, observed: 0.74, n: 34 },
    { bin: "80–100%", predicted: 0.9, observed: 0.86, n: 41 },
  ],
};

/** Total outcomes behind the curve, summed from the bins rather than restated. */
export const calibrationN = calibration.bins.reduce((a, b) => a + b.n, 0);

// ---------------------------------------------------------------------------
// The bench queue
// ---------------------------------------------------------------------------

/**
 * What to re-test next on a screen, decided once.
 *
 * Two surfaces used to answer this and they disagreed completely: the overview
 * took everything that was not an artifact and sorted by calibrated chance,
 * while the screen's validation plan took `verdict === "Real and new"` and
 * sliced the first twelve in p-value order. The two lists for the demo screen
 * had no gene in common, and both were labelled as what to validate next.
 *
 * Anything the bench has already answered is removed rather than re-ordered.
 * The plan used to keep a slot and a plate well for MCM7, which is recorded in
 * this same fixture as having failed at the bench on this same screen, so the
 * Truth Loop fed nothing back into the plan it is supposed to inform.
 */
export function benchQueue(screenId: string): Hit[] {
  const table = hitsForScreen(screenId);
  if (table === null) return [];
  const settled = new Set(
    outcomes.filter((o) => o.screenId === screenId && o.result !== "pending").map((o) => o.gene),
  );
  return table
    .filter(
      (h) =>
        h.verdict !== "Artifact" && h.chance >= LIKELY_REAL_THRESHOLD && !settled.has(h.gene),
    )
    .sort((a, b) => b.chance - a.chance);
}

/** Candidates the bench has already answered on this screen, newest first. */
export function benchSettled(screenId: string): { hit: Hit; outcome: Outcome }[] {
  const table = hitsForScreen(screenId);
  if (table === null) return [];
  return outcomes
    .filter((o) => o.screenId === screenId)
    .map((outcome) => ({ hit: table.find((h) => h.gene === outcome.gene), outcome }))
    .filter((row): row is { hit: Hit; outcome: Outcome } => row.hit !== undefined)
    .sort((a, b) => Date.parse(b.outcome.loggedAt) - Date.parse(a.outcome.loggedAt));
}
