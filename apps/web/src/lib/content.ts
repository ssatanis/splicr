/**
 * Marketing copy and figures.
 * Every number carries a source. Illustrative values are labelled as such.
 */

export type Citation = { text: string; href: string; note: string };

import evidence from "../../public/evidence/summary.json";

const countCorrelations = evidence.counts.samples.map(sample => sample.spearman);
const countTolerance = evidence.counts.samples.map(sample => sample.fraction_within_25_percent * 100);
const correlationRange = `${Math.min(...countCorrelations).toFixed(3)}–${Math.max(...countCorrelations).toFixed(3)}`;
const toleranceRange = `${Math.min(...countTolerance).toFixed(1)}–${Math.max(...countTolerance).toFixed(1)}%`;

export const heroStats = [
  { value: String(evidence.split.test), label: "Public benchmark test screens replayed", cite: { text: "AssayBench reproduction", href: "/evidence", note: "Temporal yearfold0 split; retrospective, not prospective validation." } },
  { value: String(evidence.counts.samples.length), label: "Real sequencing samples recounted", cite: { text: "GSE145743 count reproduction", href: "/evidence#counting", note: "26,336,701 reads; 65,383 guides compared per sample." } },
  { value: correlationRange, label: "Count rank correlation with deposited data", cite: { text: "Measured Spearman correlation", href: "/evidence#counting", note: "Four samples from one study, comparing library A CPM; imperfect agreement." } },
  { value: "2 tracks", label: "Prediction and observed-screen analysis", cite: { text: "Evaluation scope", href: "/evidence", note: "Pre-screen ranking and post-screen statistics answer different questions." } },
] as const;

/** Marquee rows distinguish available analysis from outcome collection. */
export const marqueeRows = [
  ["Hit Report", "Discovery Map", "Screen Planner", "Truth Loop", "Atlas", "Connect"],
  ["MAGeCK RRA", "MAGeCK MLE", "BAGEL2", "DepMap references", "DrugZ"],
  ["Copy-number flags", "Guide concordance", "Frequent hitters", "Outcome records", "Provenance"],
];

export const modules = [
  {
    id: "atlas",
    status: "Reference ingestion implemented; workspace explorer unavailable",
    eyebrow: "Published evidence",
    title: "Atlas",
    blurb:
      "Explore published CRISPR screen results and their source metadata. Atlas records retain the original studies' analysis methods and hit definitions.",
    points: ["BioGRID ORCS reference data", "Original methods and thresholds", "Source-linked screen history"],
  },
  {
    id: "hit-report",
    status: "Local JSON report and recorded workspace results; no calibration",
    eyebrow: "Per hit",
    title: "Hit Report",
    blurb:
      "Inspect effect sizes, statistical results, guide support and available Atlas evidence. A calibrated probability of independent validation is not available yet.",
    points: ["Effect size and significance", "Artifact risks with evidence", "Missing evidence shown explicitly"],
  },
  {
    id: "planner",
    status: "Demonstration only; workspace planning unavailable",
    eyebrow: "Before the screen",
    title: "Screen Planner",
    blurb:
      "Explore how library size and coverage change guide, cell and read requirements, with approximate cost and timing assumptions.",
    points: ["Design arithmetic", "No statistical power estimate", "Costs and timing are estimates"],
  },
  {
    id: "truth-loop",
    status: "Stored outcome reader; entry and retraining unavailable",
    eyebrow: "After the screen",
    title: "Truth Loop",
    blurb:
      "Review stored follow-up outcomes alongside a screen's evidence. Validation records support review; automatic model retraining is not implemented.",
    points: ["Positive and negative outcomes", "Pending and inconclusive stay distinct", "Workspace-scoped records"],
  },
  {
    id: "connect",
    status: "Read-only REST code; public workspace access disabled",
    eyebrow: "For scripts and integrations",
    title: "Connect",
    blurb:
      "Read screen hit results through the REST API using a scoped organization key. A remote MCP server is not available yet.",
    points: ["Read-only hits endpoint", "Scoped keys per organization", "Screen and FDR filters"],
  },
] as const;

export const pipelineStages = [
  { n: "01", title: "Ingest", blurb: "FASTQ or counts in. Confirm the library, sample roles and comparison." },
  { n: "02", title: "Count and QC", blurb: "Gini, zero counts, skew, replicate agreement, control separation." },
  { n: "03", title: "Call hits", blurb: "Applicable MAGeCK, BAGEL2 and DrugZ results retain their own statistics." },
  { n: "04", title: "Flag artifacts", blurb: "Copy number, single-guide signal, promiscuous guides, frequent hitters." },
  { n: "05", title: "Review evidence", blurb: "Compare statistical support and Atlas context; validation probability is unavailable." },
] as const;

export const howItWorks = [
  { n: 1, title: "Ingest", sub: "Supported FASTQ or count tables" },
  { n: 2, title: "Detect", sub: "Library and guide position" },
  { n: 3, title: "Count", sub: "Guides per sample, mapped reads" },
  { n: 4, title: "QC", sub: "Skew, zeros, replicates, controls" },
  { n: 5, title: "Call hits", sub: "RRA, MLE, Bayes factors" },
  { n: 6, title: "Flag artifacts", sub: "Copy number, single guide" },
  { n: 7, title: "Atlas context", sub: "Similar screens, hit history" },
  { n: 8, title: "Review evidence", sub: "Statistical support and limits" },
  { n: 9, title: "Report", sub: "Local JSON and analysis files" },
] as const;

/**
 * The Discovery Map quadrants, in reading order for a 2x2 grid: top-left,
 * top-right, bottom-left, bottom-right. Evidence increases to the right and
 * novelty upwards. This is a conceptual aid, not a calibrated classifier.
 */
export const discoveryQuadrants = [
  { title: "Less support, less studied", body: "Resolve uncertainty before prioritizing.", tone: "teal" },
  { title: "More support, less studied", body: "Consider for independent validation.", tone: "orange" },
  { title: "Less support, well studied", body: "Check the assay context and artifacts.", tone: "muted" },
  { title: "More support, well studied", body: "Consider as context-matched controls.", tone: "muted" },
] as const;

/** Unaltered published rankings and the frozen research router, official evaluator. */
export const benchmark = [
  { label: "Oracle: selects with test answers", value: evidence.references.published_oracle_knn.mean, tone: "muted" },
  { label: "Published frontier ensemble", value: evidence.references.published_ensemble.mean, tone: "teal" },
  { label: "SplicR research router (not promoted)", value: evidence.router.mean, tone: "orange" },
  { label: "Published Gemini 3 Pro predictions", value: evidence.references.published_gemini3pro.mean, tone: "muted" },
  { label: "Published GPT-5.4 predictions", value: evidence.references.published_gpt54.mean, tone: "muted" },
  { label: "Published phenotype-frequency prior", value: evidence.references.published_phenotype_frequency.mean, tone: "muted" },
  { label: "Published embedding kNN", value: evidence.references.published_embedding_knn.mean, tone: "muted" },
] as const;

export const benchmarkCite: Citation = {
  text: "Measured results and reproducible evidence",
  href: "/evidence",
  note: "AssayBench biogrid/yearfold0, 334 public test screens, official adjusted nDCG@100. Cached model predictions replayed without new API calls. Router delta −0.002722; paired publication-bootstrap 95% interval [−0.015581, +0.006268]. No demonstrated superiority. The oracle uses test answers. Independent prospective validation is outstanding.",
};

/**
 * The comparison section.
 *
 * Three exports, in the order they are read: what else a lab could use, what we
 * have measured that those tools do not do, and the cases where the other tool
 * is the right answer. The third one is not modesty. A comparison that never
 * concedes anything is not information, and a reader who has used MAGeCK will
 * stop believing the rest of the page at the first overreach.
 *
 * Rules for editing this block. Every `good` is written as if the tool's own
 * author would sign it. Every number in `measured` is one this repository can
 * reproduce, and `checkedIn` says where, so a reader can go and check rather
 * than take our word. Anything not measured yet belongs in `whereOthersWin`,
 * not here.
 */

/**
 * Four proof points, each a number a reader can hold in their head.
 *
 * The earlier version of this was seven paragraphs of method detail with file
 * paths attached. Everything in it was true and almost nobody would read it.
 * A landing page has to be legible to somebody who does not run screens, so
 * each of these leads with the figure and says what it means in one sentence.
 * The detail did not disappear, it moved to /pipeline, where a reader who wants
 * it has asked for it.
 */
export const proofPoints = [
  { id: "counting", figure: correlationRange, scale: "Spearman correlation", title: "Real counts compared with deposited data", body: "Four GSE145743 FASTQ files were recounted. Agreement is substantial but imperfect; the median CPM ratio alone does not establish counting accuracy." },
  { id: "tolerance", figure: toleranceRange, scale: "within 25%", title: "Guide-level count agreement", body: "65,383 library A guides were compared per sample after CPM normalization. Results describe one study, not all libraries or assays." },
  { id: "postscreen", figure: `${evidence.postscreen.original_min_directional_fdr_hits} → ${evidence.postscreen.corrected_two_family_fdr_hits}`, scale: "q < 0.1 calls", title: "Corrected directional statistics", body: "In the processed-count audit, accounting for selection across MAGeCK's two directional families reduced discoveries. This is a reporting correction, not proof of better validation precision." },
  { id: "prediction", figure: evidence.router.mean.toFixed(6), scale: "AnDCG@100", title: "A research candidate that did not improve the benchmark", body: "The frozen router scored below the published ensemble's 0.163091. It was not promoted. Negative results remain part of the evidence." },
] as const;

/*
 * There is no `testimonials` export any more, and there should not be one until
 * a real lab has agreed to be quoted by name.
 *
 * What was here was three invented quotes under three invented names, titles
 * and cities, with an 11px line at the bottom of the section admitting they
 * were placeholders. A researcher reads the quote and the affiliation, not the
 * footnote, so the page was claiming customers it does not have. Everything
 * else on this site is checkable, which is the only reason any of it is worth
 * reading, and one fabricated section is enough to lose that.
 */

/** Areas of interest; no verified live vacancies or compensation promises. */
export const openRoles = [
  { id: "computational-biology", title: "Computational biology", summary: "Reproducible screen analysis, experimental design and independent validation.", asks: ["CRISPR screen methods", "Biological data provenance", "Assay-specific validation"] },
  { id: "machine-learning", title: "Machine learning research", summary: "Leakage-aware ranking, uncertainty and honest benchmark evaluation.", asks: ["Grouped and temporal evaluation", "Learning to rank", "Calibration with suitable outcomes"] },
  { id: "product-engineering", title: "Product engineering", summary: "Reliable scientific workflows and clear evidence presentation.", asks: ["TypeScript and Python", "Access control", "Background analysis and data pipelines"] },
] as const;

/**
 * FAQ.
 *
 * Written for the two people who ask: a screening scientist deciding whether to
 * upload, and someone deciding whether to fund it. Every answer states a limit
 * where one exists, because an FAQ that only sells is the one nobody believes.
 * Numbers here must match the ones measured elsewhere on the site.
 */
export const faq = [
  { q: "Can I upload a screen on this website?", a: "Public workspace access and browser uploads are not enabled. The local analysis engine accepts supported FASTQ and count-table inputs with a library, sample roles and explicit contrasts. Contact us to discuss a research evaluation." },
  { q: "Does SplicR give a probability that a hit will validate?", a: "No calibrated validation-success model has been established. Reports show available effects, significance, guide support and artifact risks. FDR and a model score are not a candidate's probability of successful validation." },
  { q: "How does this relate to MAGeCK?", a: "SplicR runs applicable established callers, including MAGeCK RRA/MLE, BAGEL2 and DrugZ, and retains method-specific statistics. It adds input checks, context-dependent artifact flags and provenance. A single real-data audit does not establish superiority over those methods." },
  { q: "Which designs have been checked?", a: "The documented real-data audit covers one human GeCKOv2 olaparib study. Software tests cover additional design and modality handling, but do not validate biological performance across all assays, organisms or libraries." },
  { q: "Can I export real results?", a: "The local engine writes a JSON evidence report and analysis files. Authenticated workspace readers and a scoped read-only hits API are implemented in source. Browser CSV/PDF workspace exports and connected uploads remain incomplete; sample exports are restricted to explicit demo sessions." },
  { q: "What happens to workspace data?", a: "Workspace readers use organization-scoped access controls. Logging outcomes does not automatically retrain a model or publish private screens. Live tenant isolation and a complete outcome-entry workflow still need operational verification." },
  { q: "Do you beat frontier models at predicting hits?", a: "No demonstrated advantage. The new research router scored 0.160369 versus 0.163091 for the published ensemble. A separate archived comparison using known assayed-gene libraries also showed no significant advantage. These retrospective replays do not establish prospective performance." },
] as const;
