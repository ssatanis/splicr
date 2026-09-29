/**
 * Marketing copy and figures.
 * Every number carries a source. Illustrative values are labelled as such.
 */

export type Citation = { text: string; href: string; note: string };

/**
 * The four numbers under the hero.
 *
 * All four describe the problem, not us. The row that used to sit first read
 * "1.8x, best retrieval vs best AI model", which divided AssayBench's oracle
 * by its language-model ensemble. That oracle reads the test labels to pick the
 * best past screen, so the ratio was a hindsight comparison rather than
 * anything SplicR does, and it contradicted our own benchmark section further
 * down the page. A reader who checks the source would have caught it.
 */
export const heroStats = [
  {
    value: "0.26",
    label: "Precision when one gold-standard screen checks another",
    cite: {
      text: "Dempster et al., Nat Commun 2019",
      href: "https://doi.org/10.1038/s41467-019-13805-y",
      note: "Precision 0.255 at recall 0.781, Broad against Sanger",
    },
  },
  {
    value: "0.30",
    label: "Replicate agreement once the context-specific effect is isolated",
    cite: {
      text: "Cell Systems 2023",
      href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10266068/",
      note: "Guide-level Pearson 0.30 on the context-specific delta, from 0.97 on the same screens' raw counts",
    },
  },
  {
    value: "2,217",
    label: "Published screens in BioGRID ORCS v2.0.18",
    cite: {
      text: "BioGRID ORCS v2.0.18",
      href: "https://orcs.thebiogrid.org/",
      note: "418 publications, 825 cell lines, September 2025",
    },
  },
  {
    value: "$19k",
    label: "Published price of one pooled genome-wide screen",
    cite: {
      text: "Greehey CCRI Target Discovery Core",
      href: "https://gccri.uthscsa.edu/services/tdc/service-and-pricing/",
      note: "Plus 12 to 20 weeks of work",
    },
  },
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
    eyebrow: "Published evidence",
    title: "Atlas",
    blurb:
      "Explore published CRISPR screen results and their source metadata. Atlas records retain the original studies' analysis methods and hit definitions.",
    points: ["BioGRID ORCS reference data", "Original methods and thresholds", "Source-linked screen history"],
    status: "Reference ingestion implemented; workspace explorer unavailable",
  },
  {
    id: "hit-report",
    eyebrow: "Per hit",
    title: "Hit Report",
    blurb:
      "Inspect effect sizes, statistical results, guide support and available Atlas evidence. A calibrated probability of independent validation is not available yet.",
    points: ["Effect size and significance", "Artifact risks with evidence", "Missing evidence shown explicitly"],
    status: "Local JSON report and recorded workspace results; no calibration",
  },
  {
    id: "planner",
    eyebrow: "Before the screen",
    title: "Screen Planner",
    blurb:
      "Explore how library size and coverage change guide, cell and read requirements, with approximate cost and timing assumptions.",
    points: ["Design arithmetic", "No statistical power estimate", "Costs and timing are estimates"],
    status: "Demonstration only; workspace planning unavailable",
  },
  {
    id: "truth-loop",
    eyebrow: "After the screen",
    title: "Truth Loop",
    blurb:
      "Record follow-up outcomes alongside a screen's evidence. Validation records support review; automatic model retraining is not implemented.",
    points: ["Positive and negative outcomes", "Pending and inconclusive stay distinct", "Workspace-scoped records"],
    status: "Stored outcome reader; entry and retraining unavailable",
  },
  {
    id: "connect",
    eyebrow: "For scripts and integrations",
    title: "Connect",
    blurb:
      "Read screen hit results through the REST API using a scoped organization key. A remote MCP server is not available yet.",
    points: ["Read-only hits endpoint", "Scoped keys per organization", "Screen and FDR filters"],
    status: "Read-only REST code; public workspace access disabled",
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
  { n: 1, title: "Ingest", sub: "FASTQ, counts or MAGeCK output" },
  { n: 2, title: "Detect", sub: "Library and guide position" },
  { n: 3, title: "Count", sub: "Guides per sample, mapped reads" },
  { n: 4, title: "QC", sub: "Skew, zeros, replicates, controls" },
  { n: 5, title: "Call hits", sub: "RRA, MLE, Bayes factors" },
  { n: 6, title: "Flag artifacts", sub: "Copy number, single guide" },
  { n: 7, title: "Atlas context", sub: "Similar screens, hit history" },
  { n: 8, title: "Review evidence", sub: "Statistical support and limits" },
  { n: 9, title: "Report", sub: "Hit evidence and exports" },
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

/**
 * AssayBench, with our own row in it.
 *
 * The original 0.163 SplicR row is the standalone ORCS retrieval scorer. The
 * 0.220 research fusion selects between a pre-2022 phenotype prior and the
 * published five-model prediction consensus by phenotype, using only
 * publication-excluded pre-2022 labels for selection. It was scored with the
 * official metric on 334 test screens in phenotype_router.py. The matched
 * published ensemble, also filtered and padded to 100 assayed genes, is 0.2193.
 * Their archived paired difference is +0.0006, 95% bootstrap CI
 * [-0.0080, +0.0087]: no demonstrated superiority or equivalence. The fusion uses published frontier predictions; its result
 * must never be described as model-free or independent of test-era literature.
 *
 * The top row is an oracle. It reads the test labels to pick the single best
 * past screen. It is a hindsight reference, not an attainable method or a
 * general performance ceiling. The label has to keep saying so.
 *
 * Measured 2026-09-27 against the official Genentech evaluator
 * (`pip install git+https://github.com/Genentech/AssayBench.git`) on the
 * 334-screen yearfold0 test split, from `engine/splicr/features/orcs_retrieval.py`.
 * The archived retrieval row is `orcs_retrieval_rate` at 0.1628. Historical
 * test results informed repository research, so none of these rows establishes
 * prospective performance. Overlapping marginal intervals do not establish
 * equivalence. The 0.136 row is upstream's own phenotype-stratified
 * hit-frequency prior refit on train+validation (assaybench_stack.py:21).
 */
export const benchmark = [
  { label: "Oracle: best past screen, chosen with hindsight", value: 0.292, tone: "muted" },
  { label: "Archived SplicR fusion (published rankings + known library)", value: 0.220, tone: "orange" },
  { label: "Frontier ensemble, filtered to assayed genes", value: 0.219, tone: "teal" },
  { label: "Archived SplicR retrieval (no model API)", value: 0.163, tone: "orange" },
  { label: "Frontier ensemble as published", value: 0.163, tone: "teal" },
  { label: "Phenotype prior, refit on pre-2022 screens", value: 0.136, tone: "muted" },
] as const;

export const benchmarkCite: Citation = {
  text: "AssayBench test set, 334 screens published after 2021",
  href: "https://github.com/Genentech/AssayBench",
  note: "Archived retrospective AnDCG@100 results, not production validation probabilities. Fusion uses published frontier rankings, pre-2022 labels and the known assayed-gene library. Its matched filtered/padded ensemble comparator is 0.219; archived paired difference +0.0006, 95% bootstrap interval [-0.0080, +0.0087], without demonstrated superiority. Published rows use their original inputs and are not matched library-aware comparisons. The oracle reads test answers. Independent prospective validation is outstanding.",
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
  {
    id: "recovery",
    figure: "4th",
    scale: "of 20,916 genes",
    title: "A published gene recovered in a retrospective reanalysis",
    body: "In the archived olaparib reanalysis from raw reads, CHD1L ranked fourth. This is a check on one published screen, not a blind prospective validation.",
  },
  {
    id: "counting",
    figure: "0.97",
    scale: "median ratio",
    title: "Counts compared with the authors' deposited table",
    body: "The archived check reports a median per-guide CPM ratio of 0.97 across four samples. A ratio near one checks scale; it does not establish perfect guide-level agreement.",
  },
  {
    id: "offtarget",
    figure: "20,872",
    scale: "of 20,872 genes",
    title: "Off-target annotations reproduce a published source",
    body: "The archived check reproduces Fortin et al.'s per-gene counts for 20,872 genes. Annotation agreement does not measure artifact-detection accuracy in a new screen.",
  },
  {
    id: "library-detect",
    figure: "100%",
    scale: "every decoy under 2%",
    title: "Library detection checked on sampled reference guides",
    body: "In the archived 500-guide fingerprint check, the source library matched fully and decoys stayed below 2%. This does not guarantee detection on every uploaded library.",
  },
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

export const openRoles = [
  {
    id: "senior-computational-biologist",
    title: "Senior Computational Biologist",
    type: "Full Time",
    pay: "$150 to $200K",
    location: "New York, United States",
    summary:
      "Own the Atlas: re-analyze every public screen through one pipeline and lead the validation-outcome curation.",
    asks: ["Deep MAGeCK, BAGEL2 and CRISPRcleanR experience", "Python, Polars, DuckDB, Postgres", "Has run pooled screens end to end"],
  },
  {
    id: "founding-ml-engineer",
    title: "Founding ML Engineer, Calibration",
    type: "Full Time",
    pay: "$160 to $220K",
    location: "New York, United States",
    summary:
      "Build the hit-confidence model: features, similar-screen retrieval, calibration, benchmarked on AssayBench.",
    asks: ["Gradient boosting and calibration in production", "Rigorous about leakage and evaluation", "Ships monitored models, not notebooks"],
  },
  {
    id: "full-stack-engineer",
    title: "Full-Stack Engineer",
    type: "Full Time",
    pay: "$140 to $190K",
    location: "New York, United States",
    summary:
      "Next.js, Supabase and the job engine. Make multi-gigabyte uploads feel instant and data-heavy UI feel calm.",
    asks: ["TypeScript, React, Postgres and RLS", "Has built background job systems", "Cares about the details"],
  },
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
  {
    q: "What do I have to give you?",
    a: "Raw FASTQ, or a count table if you already have one. You do not need to tell us the library: it is identified from the guide sequences in the reads, which is what stops a mislabelled upload becoming a wrong answer. Sample roles and the contrast you care about are the only things we ask you to fill in.",
  },
  {
    q: "Does SplicR give a probability that a hit will validate?",
    a: "Not yet. Real analyses report effect size, statistical significance, guide support, artifact risks and available historical evidence. We have not established an independently calibrated model of validation success. FDR is not that probability, and percentages shown in the labeled demo are illustrative.",
  },
  {
    q: "How is this different from running MAGeCK myself?",
    a: "For the statistics, it is not, and it should not be. MAGeCK and BAGEL2 are what our hit-calling stage runs. What is added around them is the parts people skip: reading the library from the reads, measuring QC against the definitions its sources actually use, naming each artifact with its evidence, and putting the result next to every comparable public screen.",
  },
  {
    q: "Which screen designs work today?",
    a: "Pooled knockout dropout and drug-modifier screens, in human and mouse, with or without a plasmid reference. CRISPRa and CRISPRi run, with the direction convention handled, though counting assumes a knockout amplicon layout so newer library designs are better served elsewhere for now. Sorting and reporter screens work without a fitness axis.",
  },
  {
    q: "Can I get my data out?",
    a: "Yes, and in the shape you already work in. The gene table exports as CSV that opens cleanly in R and Excel, as JSON with full provenance, and as a PDF you can hand a PI. The count matrix and the MAGeCK and BAGEL2 outputs come with it. There is a read-only REST endpoint if you would rather pull it from a script.",
  },
  {
    q: "What happens to my screen?",
    a: "Screen and outcome records are scoped to your workspace with database row-level access controls. Logging an outcome does not automatically retrain a model or publish an unpublished screen to the public Atlas.",
  },
  {
    q: "Do you beat the language models at predicting hits?",
    a: "The archived results do not demonstrate superiority. A retrospective research fusion using published frontier predictions and the known assayed-gene library scored 0.220; its matched filtered and padded ensemble comparator scored 0.219, with a paired interval spanning zero. These are research replay results, not the production scorer or prospective validation. The archived retrieval-only result of 0.163 uses no model API, but sharing a rounded score with an original published ensemble does not establish equal performance.",
  },
] as const;
