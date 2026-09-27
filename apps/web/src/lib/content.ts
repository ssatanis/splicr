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
 * past screen, so it is a ceiling on what retrieval could ever be worth, not a
 * result anyone can have. The label has to keep saying so.
 */
export const benchmark = [
  { label: "Oracle: best past screen, chosen with hindsight", value: 0.292, tone: "muted" },
  { label: "Ensemble of frontier models", value: 0.163, tone: "teal" },
  { label: "Gemini 3 Pro", value: 0.157, tone: "teal" },
  { label: "GPT-5.4", value: 0.147, tone: "teal" },
  { label: "SplicR's best scorer", value: 0.136, tone: "orange" },
  { label: "Frequent-hitter prior", value: 0.133, tone: "muted" },
  { label: "Past screen found by text similarity", value: 0.065, tone: "muted" },
] as const;

export const benchmarkCite: Citation = {
  text: "AssayBench test set, 334 screens published after 2021",
  href: "https://github.com/Genentech/AssayBench",
  note: "Score is AnDCG@100, higher is better. Every row re-scored by this project's harness; the published reference points reproduce to four decimals.",
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

export const comparisonCaveats = [
  {
    title: "For one clean screen, the open-source tools are enough",
    body: "If you have a dropout design and someone who can run a command, MAGeCK and BAGEL2 give you the same statistics we do, today, free. That is not a concession. They are what our hit-calling stage runs.",
  },
  {
    title: "For enrichment, use MAGeCKFlute",
    body: "Pathway and protein-complex enrichment is a real question and we do not answer it. MAGeCKFlute does, it is maintained, and it reads the MAGeCK output we already produce.",
  },
  {
    title: "For CRISPRi, CRISPRa and V3 libraries, use ScreenPro2",
    body: "Our counting assumes a knockout amplicon layout. ScreenPro2 was built for the newer library designs and is the better starting point for them.",
  },
  {
    title: "For essentiality in cancer lines, use DepMap",
    body: "It is free, it is CC BY 4.0, and it already answers that question across 1,178 models. Nobody should be paying for it, including paying us.",
  },
  {
    title: "We do not beat the language models at predicting a new screen",
    body: "On the 334 screens of the AssayBench test split our best scorer reaches AnDCG@100 0.136, against Gemini 3 Pro at 0.157 and a frontier ensemble at 0.163. The paired difference is significant, and the gap sits on drug-response and infection screens where the answer is specific biology. A frequency prior knows which genes are often hits and nothing about which receptor a virus uses.",
  },
  {
    title: "The calibrated score is a design, not yet a measurement",
    body: "The confidence model is fitted on validation outcomes labs log, and there are not yet enough of them for the calibration curve to be a result. Until there are, treat that number as what we are building rather than as something we have shown.",
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
