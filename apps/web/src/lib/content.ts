/**
 * Marketing copy and figures.
 * Every number carries a source. Illustrative values are labelled as such.
 */

export type Citation = { text: string; href: string; note: string };

export const heroStats = [
  {
    value: "1.8x",
    label: "Best retrieval vs best AI model",
    cite: {
      text: "AssayBench, Genentech 2026",
      href: "https://github.com/Genentech/AssayBench",
      note: "AnDCG@100: 0.292 oracle retrieval vs 0.163 LLM ensemble",
    },
  },
  {
    value: "0.26",
    label: "Precision between two gold-standard screens",
    cite: {
      text: "Dempster et al., Nat Commun 2019",
      href: "https://doi.org/10.1038/s41467-019-13805-y",
      note: "Precision 0.255 at recall 0.781, Broad vs Sanger",
    },
  },
  {
    value: "2,217",
    label: "Public screens in the Atlas",
    cite: {
      text: "BioGRID ORCS v2.0.18",
      href: "https://orcs.thebiogrid.org/",
      note: "418 publications, 825 cell lines",
    },
  },
  {
    value: "$19k",
    label: "Cost of one genome-wide screen",
    cite: {
      text: "Academic core pricing",
      href: "https://www.uthscsa.edu/research/core-facilities",
      note: "Plus 12 to 20 weeks of work",
    },
  },
] as const;

/** Marquee rows. Every term is something SplicR actually does or uses. */
export const marqueeRows = [
  ["Hit Report", "Discovery Map", "Screen Planner", "Truth Loop", "Atlas", "Connect"],
  ["MAGeCK", "BAGEL2", "CRISPRcleanR", "Chronos", "DrugZ", "CRISPRcleanR"],
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

export const benchmark = [
  { label: "Nearest past screen, chosen with hindsight", value: 0.292, tone: "orange" },
  { label: "Best AI: ensemble of frontier models", value: 0.163, tone: "teal" },
  { label: "Gemini 3 Pro", value: 0.157, tone: "teal" },
  { label: "GPT-5.4", value: 0.147, tone: "teal" },
  { label: "Frequent-hitter prior", value: 0.133, tone: "muted" },
  { label: "Open model tuned with RL", value: 0.129, tone: "muted" },
  { label: "Past screen found by text similarity", value: 0.065, tone: "muted" },
] as const;

export const benchmarkCite: Citation = {
  text: "AssayBench test set, 334 screens published after 2021",
  href: "https://github.com/Genentech/AssayBench",
  note: "Score is AnDCG@100, higher is better. MIT licensed.",
};

export const moatLayers = [
  { layer: "The app and the pipelines", copy: "Weeks. Agents already do this." },
  { layer: "A cleaned atlas of every public screen", copy: "Months of expert work, then constant upkeep." },
  { layer: "Validation outcomes logged by labs", copy: "Cannot be scraped. They stay where they were logged." },
  { layer: "Being the neutral benchmark", copy: "Every vendor grades its own agent. Nobody is the scorekeeper." },
] as const;

export const testimonials = [
  {
    quote:
      "We had 212 hits and budget for twelve. SplicR put our eventual paper gene in the top three and flagged the copy-number cluster we would have chased for a semester.",
    name: "Priya Raman, PhD",
    role: "Postdoctoral fellow, oncology, Boston",
    initials: "PR",
  },
  {
    quote:
      "The blind test sold it. They scored our old screen before we said which hits worked, and the calibration held.",
    name: "Daniel Okafor",
    role: "Director, functional genomics core, New York",
    initials: "DO",
  },
  {
    quote:
      "Our agents already run MAGeCK. What they could not do was say which results to trust.",
    name: "Mei-Ling Chen",
    role: "Head of computational biology, Cambridge",
    initials: "MC",
  },
] as const;

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
