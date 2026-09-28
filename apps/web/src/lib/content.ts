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
 * best past screen, so the ratio was a ceiling on retrieval rather than
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
    label: "Published screens in the largest public index",
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

/** Marquee rows. Every term is something SplicR actually does or uses. */
export const marqueeRows = [
  ["Hit Report", "Discovery Map", "Screen Planner", "Truth Loop", "Atlas", "Connect"],
  ["MAGeCK", "BAGEL2", "CRISPRcleanR", "Chronos", "DrugZ"],
  ["Copy-number flags", "Guide concordance", "Frequent hitters", "Calibration", "Blind tests"],
];

export const modules = [
  {
    id: "atlas",
    eyebrow: "The answer key",
    title: "Atlas",
    blurb:
      "Every public CRISPR screen, re-analyzed through one pipeline, plus the record of which hits held up afterwards.",
    points: ["2,217 screens, one method", "Validated, failed or replicated per hit", "Refreshed monthly"],
  },
  {
    id: "hit-report",
    eyebrow: "Per hit",
    title: "Hit Report",
    blurb:
      "Upload a screen. Every hit gets a calibrated chance it is real, the reason, and its history across the Atlas.",
    points: ["Say 80%, and 8 in 10 validate", "Artifacts named with evidence", "Real on one axis, new on the other"],
  },
  {
    id: "planner",
    eyebrow: "Before the screen",
    title: "Screen Planner",
    blurb:
      "A focused library built from screens like yours, with the coverage, replicates and cost the design actually needs.",
    points: ["Built for in vivo and primary cells", "Power from real effect sizes", "Cost and timeline up front"],
  },
  {
    id: "truth-loop",
    eyebrow: "After the screen",
    title: "Truth Loop",
    blurb:
      "Turn top hits into a validation plan, log what held up, and every result sharpens the scores.",
    points: ["Guides, plate map, order file", "Outcomes logged in minutes", "Private data tunes only your model"],
  },
  {
    id: "connect",
    eyebrow: "For agents",
    title: "Connect",
    blurb:
      "A REST API and a remote MCP server, so Claude, Biomni and GPT agents can query SplicR mid-conversation.",
    points: ["MCP over Streamable HTTP", "Scoped keys per organization", "Every agent is a channel"],
  },
] as const;

export const pipelineStages = [
  { n: "01", title: "Ingest", blurb: "FASTQ or counts in. Library and design detected for you." },
  { n: "02", title: "Count and QC", blurb: "Gini, zero counts, skew, replicate agreement, control separation." },
  { n: "03", title: "Call hits", blurb: "MAGeCK, BAGEL2, DrugZ and CRISPRcleanR in one consensus table." },
  { n: "04", title: "Flag artifacts", blurb: "Copy number, single-guide signal, promiscuous guides, frequent hitters." },
  { n: "05", title: "Score", blurb: "Atlas context and validation outcomes give a calibrated chance it is real." },
] as const;

export const howItWorks = [
  { n: 1, title: "Ingest", sub: "FASTQ, counts or MAGeCK output" },
  { n: 2, title: "Detect", sub: "Library, guide position, design" },
  { n: 3, title: "Count", sub: "Guides per sample, mapped reads" },
  { n: 4, title: "QC", sub: "Skew, zeros, replicates, controls" },
  { n: 5, title: "Call hits", sub: "RRA, MLE, Bayes factors" },
  { n: 6, title: "Flag artifacts", sub: "Copy number, single guide" },
  { n: 7, title: "Atlas context", sub: "Similar screens, hit history" },
  { n: 8, title: "Score", sub: "Calibrated chance it is real" },
  { n: 9, title: "Report", sub: "Discovery Map, validation plan" },
] as const;

/**
 * The Discovery Map quadrants, in reading order for a 2x2 grid: top-left,
 * top-right, bottom-left, bottom-right. "Chance it is real" increases to the
 * right and "how new" increases upwards, so real sits on the right and new at
 * the top. Reordering this array moves the cards, so keep it spatial.
 */
export const discoveryQuadrants = [
  { title: "Fake and new", body: "The trap. Where wasted months go.", tone: "teal" },
  { title: "Real and new", body: "Validate these first.", tone: "orange" },
  { title: "Fake and known", body: "Ignore.", tone: "muted" },
  { title: "Real and known", body: "Positive controls. Not a paper.", tone: "muted" },
] as const;

/**
 * AssayBench, with our own row in it.
 *
 * Every value here was re-scored by this project's harness on the same 334 test
 * screens, and all six of the paper's published reference points reproduced to
 * four decimals. Our row is included because leaving it out of a chart we chose
 * to publish would be the dishonest option: we are behind the language models,
 * the paired difference is significant, and a reader can see that here rather
 * than find it out later.
 *
 * The top row is an oracle. It reads the test labels to pick the single best
 * past screen, so it is a ceiling on what single-donor retrieval could be worth,
 * not a result anyone can have. The label has to keep saying so.
 *
 * Measured 2026-09-27 against the official Genentech evaluator
 * (`pip install git+https://github.com/Genentech/AssayBench.git`) on the
 * 334-screen yearfold0 test split, from `engine/splicr/features/orcs_retrieval.py`.
 * Our row is `orcs_retrieval_rate` at 0.1628, pre-registered in that module
 * before it was ever scored on test, run once, no tuning: 95% CI [0.1358,
 * 0.1900], which contains the ensemble's 0.1631, so the honest word is "tie",
 * never "beats". The 0.136 row is upstream's own phenotype-stratified
 * hit-frequency prior refit on train+validation (assaybench_stack.py:21); it was
 * mislabelled as ours until this was measured. The bottom row is `retrieval_knn`
 * (assaybench_stack.py:25), which replaced an unsourced 0.065 that no run in the
 * repository produces.
 */
export const benchmark = [
  { label: "Oracle: best past screen, chosen with hindsight", value: 0.292, tone: "muted" },
  { label: "SplicR", value: 0.163, tone: "orange" },
  { label: "Ensemble of frontier models", value: 0.163, tone: "teal" },
  { label: "Gemini 3 Pro", value: 0.157, tone: "teal" },
  { label: "GPT-5.4", value: 0.147, tone: "teal" },
  { label: "Hit-frequency prior, refit on every pre-2022 screen", value: 0.136, tone: "muted" },
  { label: "Retrieval on screen metadata alone", value: 0.122, tone: "muted" },
] as const;

export const benchmarkCite: Citation = {
  text: "AssayBench test set, 334 screens published after 2021",
  href: "https://github.com/Genentech/AssayBench",
  note: "Score is AnDCG@100, higher is better. Every row scored with Genentech's own evaluator; the published reference points reproduce to four decimals. Our row is a single pre-registered run with no tuning, 95% CI [0.1358, 0.1900], which contains the ensemble, so the two are tied rather than separated.",
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
    title: "We found the paper's own gene without being told",
    body: "We re-ran a published olaparib screen from its raw reads. The gene that paper is about came back fourth, and the known resistance gene came back significant.",
  },
  {
    id: "counting",
    figure: "0.97",
    scale: "median ratio",
    title: "Our counts match the ones the authors published",
    body: "Counted from raw sequencing and compared guide by guide to the table deposited with that paper, across four of its samples.",
  },
  {
    id: "offtarget",
    figure: "20,872",
    scale: "of 20,872 genes",
    title: "Our artifact flags match their published source exactly",
    body: "Every gene, zero average difference, against the study that defined the measure. The obvious shortcut gets 82 percent and quietly overcounts.",
  },
  {
    id: "library-detect",
    figure: "100%",
    scale: "every decoy under 2%",
    title: "We read the library from the reads, not the file name",
    body: "Five hundred random guides identify the right library every time, which is what keeps a mislabelled upload from becoming a wrong answer.",
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
    q: "How is the chance a hit is real worked out?",
    a: "From the evidence in your own screen, weighted by what has held up elsewhere: effect size, how many guides agree, the artifact checks, and how the gene behaves across public screens of similar phenotype. The calibration comes from outcomes labs log after they validate. There are not yet enough of those for the calibration curve to be a published result, and we say so on the number itself rather than in a footnote.",
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
    a: "It stays yours. Your data is scoped to your workspace and the database enforces that per row, not in application code. Validation outcomes you log tune your own model; nothing identifiable about an unpublished screen joins the public Atlas.",
  },
  {
    q: "Do you beat the language models at predicting hits?",
    a: "We match them. On the AssayBench test split our retrieval scorer reaches 0.163 against a frontier ensemble at 0.163, with a 95% confidence interval that contains theirs, so the honest word is tie rather than beat. It gets there by retrieving over 1,574 published screens instead of recalling literature, which means no model API, the same answer every run, and about two minutes on a laptop. That task is still a prediction from a screen's description alone. Ours is the opposite question: given the data from a screen you did run, which of its hits survive a re-test.",
  },
] as const;
