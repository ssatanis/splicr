/**
 * Fixture data for the dashboard. Deterministic (seeded) so screenshots and
 * tests are stable. Replace with Supabase queries once the engine is live.
 * All values are illustrative.
 */
import { GENE_POOL } from "./genes";

export type Verdict = "Real and new" | "Real but generic" | "Real and known" | "Artifact" | "Uncertain";
export type StageStatus = "done" | "running" | "queued" | "failed" | "skipped";
export type ScreenStatus = "complete" | "running" | "queued" | "failed" | "draft";

export interface Screen {
  id: string;
  name: string;
  cellLine: string;
  organism: "Human" | "Mouse";
  library: string;
  modality: "Knockout" | "CRISPRi" | "CRISPRa";
  phenotype: string;
  status: ScreenStatus;
  qc: "pass" | "warn" | "fail" | "pending";
  hits: number;
  realHits: number;
  createdAt: string;
  owner: string;
  stage: number; // 0-9 stages complete
}

export interface Hit {
  gene: string;
  rank: number;
  lfc: number;
  pValue: number;
  fdr: number;
  bayesFactor: number;
  guides: number;
  guidesAgree: number;
  chance: number;
  novelty: number;
  verdict: Verdict;
  flags: string[];
  why: string;
  atlasHits: number;
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
  library: string;
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

export const screens: Screen[] = [
  {
    id: "scr_demo",
    name: "A375 ferroptosis sensitizers",
    cellLine: "A375",
    organism: "Human",
    library: "Brunello",
    modality: "Knockout",
    phenotype: "RSL3 survival, 14 d",
    status: "complete",
    qc: "pass",
    hits: 212,
    realHits: 41,
    createdAt: daysAgo(3),
    owner: "You",
    stage: 9,
  },
  {
    id: "scr_002",
    name: "HAP1 essentiality baseline",
    cellLine: "HAP1",
    organism: "Human",
    library: "TKOv3",
    modality: "Knockout",
    phenotype: "Proliferation, 18 d",
    status: "complete",
    qc: "pass",
    hits: 1_804,
    realHits: 1_520,
    createdAt: daysAgo(9),
    owner: "You",
    stage: 9,
  },
  {
    id: "scr_003",
    name: "Jurkat IFN-γ resistance (CRISPRi)",
    cellLine: "Jurkat",
    organism: "Human",
    library: "Dolcetto",
    modality: "CRISPRi",
    phenotype: "IFN-γ, sorted PD-L1 low",
    status: "running",
    qc: "warn",
    hits: 0,
    realHits: 0,
    createdAt: daysAgo(0.2),
    owner: "R. Alvarez",
    stage: 5,
  },
  {
    id: "scr_004",
    name: "B16-F10 in vivo tumor growth",
    cellLine: "B16-F10",
    organism: "Mouse",
    library: "Brie",
    modality: "Knockout",
    phenotype: "In vivo, 21 d",
    status: "complete",
    qc: "warn",
    hits: 96,
    realHits: 12,
    createdAt: daysAgo(14),
    owner: "R. Alvarez",
    stage: 9,
  },
  {
    id: "scr_005",
    name: "MOLM-13 venetoclax",
    cellLine: "MOLM-13",
    organism: "Human",
    library: "GeCKOv2 A",
    modality: "Knockout",
    phenotype: "Venetoclax 100 nM, 12 d",
    status: "failed",
    qc: "fail",
    hits: 0,
    realHits: 0,
    createdAt: daysAgo(20),
    owner: "You",
    stage: 4,
  },
  {
    id: "scr_006",
    name: "K562 CRISPRa drug efflux",
    cellLine: "K562",
    organism: "Human",
    library: "Calabrese",
    modality: "CRISPRa",
    phenotype: "Doxorubicin, 10 d",
    status: "queued",
    qc: "pending",
    hits: 0,
    realHits: 0,
    createdAt: daysAgo(0.05),
    owner: "M. Chen",
    stage: 0,
  },
];

const flagPool = [
  "Copy-number cluster",
  "One guide drives signal",
  "Promiscuous guide",
  "Frequent hitter",
  "Low guide coverage",
  "Bottlenecked replicate",
];

const whyByVerdict: Record<Verdict, string[]> = {
  "Real and new": [
    "All guides agree; also hit in 3 similar screens from other labs",
    "Strong, consistent depletion; never reported in this context",
    "Replicates agree; effect scales with dose",
  ],
  "Real but generic": [
    "Real, but it hits in about 40% of unrelated screens",
    "Core essential; drops out regardless of condition",
  ],
  "Real and known": [
    "Known positive control for this pathway; guides agree",
    "Replicates the published mechanism in this cell model",
  ],
  Artifact: [
    "Sits in an amplified region; its neighbors drop out too",
    "One guide drives about 90% of the signal",
    "Guide matches 14 genomic sites",
    "Signal concentrated in a bottlenecked replicate",
  ],
  Uncertain: ["Guides split 2 vs 2; no similar screen to compare against", "Borderline effect; low read coverage at endpoint"],
};

export function buildHits(seed = 11, n = 212): Hit[] {
  const r = rng(seed);
  const pool = [...GENE_POOL];
  const hits: Hit[] = [];
  for (let i = 0; i < n; i++) {
    const gene = pool.length ? pool.splice(Math.floor(r() * pool.length), 1)[0] : `GENE-${i}`;
    const u = r();
    let verdict: Verdict;
    if (u < 0.19) verdict = "Real and new";
    else if (u < 0.36) verdict = "Real and known";
    else if (u < 0.5) verdict = "Real but generic";
    else if (u < 0.78) verdict = "Artifact";
    else verdict = "Uncertain";

    const chance =
      verdict === "Real and new"
        ? 0.62 + r() * 0.35
        : verdict === "Real and known"
          ? 0.7 + r() * 0.28
          : verdict === "Real but generic"
            ? 0.6 + r() * 0.3
            : verdict === "Artifact"
              ? 0.03 + r() * 0.25
              : 0.3 + r() * 0.3;
    const novelty =
      verdict === "Real and new" ? 0.65 + r() * 0.33 : verdict === "Real and known" ? 0.05 + r() * 0.3 : verdict === "Real but generic" ? 0.1 + r() * 0.35 : r();
    const lfc = -(0.6 + r() * 2.6) * (chance > 0.5 ? 1 : 0.6 + r() * 0.6);
    const pValue = Math.max(1e-9, Math.pow(10, -(1 + r() * 7) * (chance > 0.5 ? 1 : 0.5)));
    const guides = 4;
    const guidesAgree = verdict === "Artifact" ? 1 + Math.floor(r() * 2) : 3 + Math.floor(r() * 2);
    const flags =
      verdict === "Artifact"
        ? [flagPool[Math.floor(r() * 3)]]
        : verdict === "Real but generic"
          ? ["Frequent hitter"]
          : r() < 0.12
            ? [flagPool[3 + Math.floor(r() * 3)]]
            : [];
    const whys = whyByVerdict[verdict];
    hits.push({
      gene,
      rank: 0,
      lfc: Number(lfc.toFixed(2)),
      pValue,
      fdr: Math.min(1, pValue * (40 + r() * 400)),
      bayesFactor: Number(((chance - 0.3) * 30 + (r() - 0.5) * 4).toFixed(1)),
      guides,
      guidesAgree,
      chance: Number(chance.toFixed(2)),
      novelty: Number(novelty.toFixed(2)),
      verdict,
      flags,
      why: whys[Math.floor(r() * whys.length)],
      atlasHits: verdict === "Real but generic" ? 300 + Math.floor(r() * 500) : Math.floor(r() * 40),
      atlasScreens: 900 + Math.floor(r() * 400),
    });
  }
  hits.sort((a, b) => a.pValue - b.pValue);
  hits.forEach((h, i) => (h.rank = i + 1));
  return hits;
}

export const demoHits = buildHits();

export const samples: Sample[] = [
  { id: "s1", label: "Plasmid", condition: "plasmid", replicate: 1, timepoint: "d0", reads: 42_115_920, mapped: 0.94, zeroGuides: 0.001, gini: 0.07, skewRatio: 3.1, verdict: "pass" },
  { id: "s2", label: "T0 rep 1", condition: "T0", replicate: 1, timepoint: "d0", reads: 38_204_112, mapped: 0.92, zeroGuides: 0.004, gini: 0.09, skewRatio: 3.8, verdict: "pass" },
  { id: "s3", label: "T0 rep 2", condition: "T0", replicate: 2, timepoint: "d0", reads: 36_990_441, mapped: 0.93, zeroGuides: 0.004, gini: 0.09, skewRatio: 3.9, verdict: "pass" },
  { id: "s4", label: "DMSO rep 1", condition: "DMSO", replicate: 1, timepoint: "d14", reads: 41_003_870, mapped: 0.91, zeroGuides: 0.021, gini: 0.18, skewRatio: 6.4, verdict: "pass" },
  { id: "s5", label: "DMSO rep 2", condition: "DMSO", replicate: 2, timepoint: "d14", reads: 39_551_209, mapped: 0.9, zeroGuides: 0.024, gini: 0.19, skewRatio: 6.9, verdict: "pass" },
  { id: "s6", label: "RSL3 rep 1", condition: "RSL3", replicate: 1, timepoint: "d14", reads: 40_118_330, mapped: 0.9, zeroGuides: 0.048, gini: 0.27, skewRatio: 9.2, verdict: "pass" },
  { id: "s7", label: "RSL3 rep 2", condition: "RSL3", replicate: 2, timepoint: "d14", reads: 24_390_118, mapped: 0.88, zeroGuides: 0.14, gini: 0.41, skewRatio: 18.7, verdict: "warn" },
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

export const stageRuns: StageRun[] = [
  { key: "ingest", title: "Ingest", status: "done", startedAt: daysAgo(3.1), durationSec: 212, detail: "7 FASTQ files, 20.4 GB, checksums verified", tool: "tus + S3" },
  { key: "detect", title: "Detect library", status: "done", startedAt: daysAgo(3.09), durationSec: 41, detail: "Brunello (76,441 guides): 99.6% of sampled reads match; guide at position 24, forward", tool: "fingerprint" },
  { key: "count", title: "Count", status: "done", startedAt: daysAgo(3.08), durationSec: 1_880, detail: "Exact match with 1-mismatch fallback; 91.4% mapped overall", tool: "mageck count 0.5.9.5" },
  { key: "qc", title: "QC", status: "done", startedAt: daysAgo(3.05), durationSec: 96, detail: "Replicate 2 of RSL3 lost 14% of guides; flagged as bottlenecked", tool: "splicr.qc" },
  { key: "hits", title: "Call hits", status: "done", startedAt: daysAgo(3.05), durationSec: 640, detail: "RRA, MLE, BAGEL2 and CRISPRcleanR complete; 212 candidate hits at FDR 0.1", tool: "mageck test / mle, BAGEL2, CRISPRcleanR" },
  { key: "artifacts", title: "Flag artifacts", status: "done", startedAt: daysAgo(3.04), durationSec: 58, detail: "9 copy-number clusters, 31 one-guide hits, 6 promiscuous guides", tool: "splicr.artifacts" },
  { key: "atlas", title: "Atlas context", status: "done", startedAt: daysAgo(3.04), durationSec: 122, detail: "14 similar screens; nearest: ORCS-1741 (A375, ferroptosis, Brunello)", tool: "splicr.atlas" },
  { key: "score", title: "Score", status: "done", startedAt: daysAgo(3.03), durationSec: 34, detail: "41 hits above 0.6 chance real; calibration band ±0.06", tool: "splicr.score v0.3" },
  { key: "report", title: "Report", status: "done", startedAt: daysAgo(3.03), durationSec: 12, detail: "Hit Report v1 built; validation plan for top 12", tool: "splicr.report" },
];

export const atlasSimilar: AtlasScreen[] = [
  { id: "ORCS-1741", source: "BioGRID ORCS", title: "Genome-wide screen for ferroptosis regulators in melanoma", cellLine: "A375", library: "Brunello", phenotype: "RSL3 survival", year: 2021, similarity: 0.91, sharedHits: 27 },
  { id: "ORCS-2033", source: "BioGRID ORCS", title: "GPX4 inhibitor resistance in lung adenocarcinoma", cellLine: "A549", library: "Brunello", phenotype: "ML210 survival", year: 2022, similarity: 0.84, sharedHits: 19 },
  { id: "ORCS-1266", source: "BioGRID ORCS", title: "Ferroptosis sensitizers in renal cell carcinoma", cellLine: "786-O", library: "GeCKOv2", phenotype: "Erastin survival", year: 2019, similarity: 0.77, sharedHits: 14 },
  { id: "DM-A375", source: "DepMap 26Q1", title: "A375 Chronos gene effect", cellLine: "A375", library: "Avana", phenotype: "Proliferation", year: 2026, similarity: 0.71, sharedHits: 33 },
  { id: "ORCS-2418", source: "BioGRID ORCS", title: "Lipid peroxidation suppressors, CRISPRi", cellLine: "HT-1080", library: "Dolcetto", phenotype: "RSL3 survival", year: 2023, similarity: 0.69, sharedHits: 11 },
];

export const outcomes: Outcome[] = [
  { id: "o1", screenId: "scr_demo", gene: "ACSL4", predicted: 0.91, result: "validated", assay: "Arrayed KO, RSL3 viability", loggedAt: daysAgo(1), by: "You" },
  { id: "o2", screenId: "scr_demo", gene: "SLC7A11", predicted: 0.88, result: "validated", assay: "Arrayed KO, RSL3 viability", loggedAt: daysAgo(1), by: "You" },
  { id: "o3", screenId: "scr_demo", gene: "MCM7", predicted: 0.14, result: "failed", assay: "Competition assay", loggedAt: daysAgo(1), by: "You" },
  { id: "o4", screenId: "scr_002", gene: "SHOC2", predicted: 0.77, result: "validated", assay: "Competition assay", loggedAt: daysAgo(6), by: "R. Alvarez" },
  { id: "o5", screenId: "scr_002", gene: "DUSP4", predicted: 0.58, result: "inconclusive", assay: "Arrayed KO", loggedAt: daysAgo(6), by: "R. Alvarez" },
  { id: "o6", screenId: "scr_004", gene: "PTPN2", predicted: 0.83, result: "validated", assay: "In vivo re-test", loggedAt: daysAgo(10), by: "R. Alvarez" },
  { id: "o7", screenId: "scr_004", gene: "APLNR", predicted: 0.69, result: "pending", assay: "In vivo re-test", loggedAt: daysAgo(2), by: "R. Alvarez" },
];

export const calibrationBins = [
  { bin: "0–10%", predicted: 0.05, observed: 0.04, n: 88 },
  { bin: "10–20%", predicted: 0.15, observed: 0.13, n: 61 },
  { bin: "20–40%", predicted: 0.3, observed: 0.33, n: 47 },
  { bin: "40–60%", predicted: 0.5, observed: 0.47, n: 29 },
  { bin: "60–80%", predicted: 0.7, observed: 0.74, n: 34 },
  { bin: "80–100%", predicted: 0.9, observed: 0.86, n: 41 },
];

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

export const overviewKpis = {
  screens: screens.length,
  hitsScored: 2_112,
  outcomesLogged: outcomes.length,
  validatedRate: 0.71,
  calibrationError: 0.04,
  atlasScreens: 2_217,
};
