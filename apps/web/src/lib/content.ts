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

export type ComparisonKind = "Open source" | "Reference data" | "Service" | "General AI";

export type ComparisonRow = {
  id: string;
  name: string;
  kind: ComparisonKind;
  /** What it is genuinely good at, stated without hedging. */
  good: string;
  /** What it does not do. A limit, not an accusation. */
  gap: string;
  cost: string;
  cite: Citation;
};

export const comparison: readonly ComparisonRow[] = [
  {
    id: "mageck",
    name: "MAGeCK",
    kind: "Open source",
    good: "The field's default hit caller, and the units most published screens report their results in. RRA for a ranked list, MLE when there are several conditions.",
    gap: "Scores one screen with no knowledge of any other. Its last public commit was December 2020 and it pins Python below 3.11, so it will not grow new methods.",
    cost: "Free. Installs from bioconda in a minute, and its QC thresholds take longer to learn than to run.",
    cite: {
      text: "liulab-dfci/MAGeCK",
      href: "https://github.com/liulab-dfci/MAGeCK",
      note: "Version 0.5.9.5. Last public commit 2020-12-16.",
    },
  },
  {
    id: "mageckflute",
    name: "MAGeCKFlute",
    kind: "Open source",
    good: "Takes MAGeCK output the rest of the way: batch effects, copy-number bias, then pathway and protein-complex enrichment. Actively maintained, with a Nature Protocols walkthrough.",
    gap: "Starts from MAGeCK output, so it inherits whatever counting and QC did. Enrichment against published pathways pushes well studied genes up, which is the wrong direction if the question is whether a hit is new.",
    cost: "Free, Bioconductor. Last commit June 2026.",
    cite: {
      text: "Wang et al., Nat Protoc 2019",
      href: "https://doi.org/10.1038/s41596-018-0113-7",
      note: "MAGeCKFlute: integrative analysis of pooled CRISPR screens.",
    },
  },
  {
    id: "bagel2",
    name: "BAGEL2",
    kind: "Open source",
    good: "Bayes factors against reference essential and nonessential sets. The right model for a dropout screen, and the basis of Project Score's own published scores.",
    gap: "Dropout designs only, so it has nothing to say about a drug screen. No copy-number correction and no artifact flagging. It also breaks on NumPy 2, which removed a function it calls.",
    cost: "Free, MIT. Git clone, no release tags, and its -s flag is registered twice.",
    cite: {
      text: "Kim and Hart, Genome Med 2021",
      href: "https://doi.org/10.1186/s13073-020-00809-3",
      note: "BAGEL2. Repository hart-lab/bagel, build 115.",
    },
  },
  {
    id: "drugz",
    name: "DrugZ",
    kind: "Open source",
    good: "Built for chemogenetic screens, which is where a drug-modifier hit actually lives. Small, fast, and it does one job without a configuration file.",
    gap: "One contrast in, one table out. No QC, no artifact flags, no context from other screens. Last commit August 2021.",
    cost: "Free, MIT.",
    cite: {
      text: "Colic et al., Genome Med 2019",
      href: "https://doi.org/10.1186/s13073-019-0665-3",
      note: "DrugZ. Repository hart-lab/drugz.",
    },
  },
  {
    id: "crisprcleanr",
    name: "CRISPRcleanR",
    kind: "Open source",
    good: "The standard correction for copy-number bias, segmented along the chromosome. Project Score's published log fold changes are CRISPRcleanR corrected, so it is the method of record for an entire public dataset.",
    gap: "Needs guide coordinates, and corrects the whole screen's bias rather than naming which of your hits is an artifact. R and Bioconductor, which on a bare R install is the real cost.",
    cost: "Free. Last commit April 2023.",
    cite: {
      text: "Iorio et al., BMC Genomics 2018",
      href: "https://doi.org/10.1186/s12864-018-5189-5",
      note: "CRISPRcleanR. Repository francescojm/CRISPRcleanR 3.0.1.",
    },
  },
  {
    id: "web-tools",
    name: "CRISPRAnalyzeR and PinAPL-Py",
    kind: "Open source",
    good: "Point and click, no command line. PinAPL-Py covers read quality through gene ranking in a single web submission, and for a lab with no computational person these were the difference between an analysis and none.",
    gap: "Both have stopped: last commits May 2020 and April 2021. An unpatched hosted tool is a poor place to put unpublished data, and neither knows anything about screens other than the one you uploaded.",
    cost: "Free while the hosts stay up.",
    cite: {
      text: "Spahn et al., Sci Rep 2017",
      href: "https://doi.org/10.1038/s41598-017-16193-9",
      note: "PinAPL-Py. CRISPRAnalyzeR: boutroslab/CRISPRAnalyzeR, GPL-2.0.",
    },
  },
  {
    id: "screenpro2",
    name: "ScreenPro2",
    kind: "Open source",
    good: "The maintained modern option. Python, scverse compatible, and built for the CRISPRi, CRISPRa and dual-guide V3 libraries the older tools assume away. Last commit September 2026.",
    gap: "Starts from a count matrix, so a read-level problem such as a failed amplicon reaches it unseen. It is a library for analysing your screen, not a record of anyone else's.",
    cost: "Free, pip install.",
    cite: {
      text: "ArcInstitute/ScreenPro2",
      href: "https://github.com/ArcInstitute/ScreenPro2",
      note: "Version 0.7.0. Arc Institute, Gilbert lab.",
    },
  },
  {
    id: "depmap",
    name: "DepMap",
    kind: "Reference data",
    good: "The best answer anywhere to whether a gene is essential in cancer lines: 17,916 genes across 1,178 models scored the same way with Chronos, plus copy number and common-essential calls. Free and CC BY 4.0.",
    gap: "Cancer cell lines in standard culture. It has no reading on your drug, your primary cells, your in vivo model or your reporter, which is most of why a lab runs its own screen.",
    cost: "Free with attribution. The 24Q4 release is 3.6 GB and the portal sits behind a bot check.",
    cite: {
      text: "DepMap 24Q4, Broad Institute",
      href: "https://depmap.org/portal/",
      note: "Counts measured on the downloaded 24Q4 files: 17,916 genes, 1,178 models.",
    },
  },
  {
    id: "orcs",
    name: "BioGRID ORCS",
    kind: "Reference data",
    good: "The broadest index of published screens there is: 2,217 screens from 418 publications across 825 cell lines, in one place, MIT licensed.",
    gap: "It keeps each paper's own hit calls and thresholds. Its SCORE.1 column is a p-value in one screen and a Bayes factor in the next, with opposite sign conventions, so the screens are indexed rather than comparable.",
    cost: "Free. The human archive is 718 MB and will not download by script.",
    cite: {
      text: "BioGRID ORCS v2.0.18",
      href: "https://orcs.thebiogrid.org/",
      note: "2,217 screens, 418 publications, 825 cell lines, September 2025.",
    },
  },
  {
    id: "project-score",
    name: "Project Score",
    kind: "Reference data",
    good: "An independent second read on the same question as DepMap, with the whole pipeline published: 17,995 genes across 325 samples, CRISPRcleanR corrected log fold changes through Bayes factors to binary calls.",
    gap: "Cancer lines again, and the licence is internal research only. It may not be resold or built into a commercial service, and combining it with other data does not change that.",
    cost: "Free for internal research. Not redistributable.",
    cite: {
      text: "Cell Model Passports, Sanger",
      href: "https://depmap.sanger.ac.uk/documentation/data-usage-policy/",
      note: "essentiality_matrices: 17,995 genes x 325 samples. The standalone Project Score portal now returns 404.",
    },
  },
  {
    id: "core-facility",
    name: "Core facility and CRO analysis",
    kind: "Service",
    good: "Someone else runs the screen and hands back a ranked gene list. For a lab without a computational person that is the difference between having a screen and not having one.",
    gap: "The analysis is usually one MAGeCK run reported once. Nothing names the artifacts, and nothing follows up on which hits held up, so the next screen starts from the same place as the last.",
    cost: "$19,000 for a pooled whole-genome screen, 12 to 20 weeks, at one published academic core.",
    cite: {
      text: "Greehey CCRI Target Discovery Core",
      href: "https://gccri.uthscsa.edu/services/tdc/service-and-pricing/",
      note: "Published price list: $19,000 pooled whole-genome, 12 to 20 weeks.",
    },
  },
  {
    id: "llm",
    name: "General LLMs and agents",
    kind: "General AI",
    good: "The strongest non-oracle result on AssayBench. Gemini 3 Pro scores 0.157 and an ensemble of frontier models 0.163, against 0.133 for a hit-frequency prior, and they lead by most on the screens statistics cannot help with: which receptor a named virus enters through.",
    gap: "They rank genes from what has been written down. They cannot read your counts, cannot see the amplified segment your hits sit in, and cannot tell you how often an answer at that confidence turns out to be right.",
    cost: "API pricing, which is small next to the screen.",
    cite: {
      text: "AssayBench, Genentech 2026",
      href: "https://github.com/Genentech/AssayBench",
      note: "AnDCG@100 on the 334-screen test split. Re-scored in this repository, matching the published values to four decimals.",
    },
  },
];

export type VerifiedClaim = {
  id: string;
  claim: string;
  /** The number, together with whatever caveat keeps it honest. */
  measured: string;
  /** Where the measurement lives, so a reader can check it. */
  checkedIn: string;
};

export const verifiedClaims: readonly VerifiedClaim[] = [
  {
    id: "same-pipeline",
    claim: "Public screens are re-analyzed, not indexed",
    measured:
      "ORCS carries each paper's own thresholds, and its score column changes meaning between screens. Running every screen through the same nine stages is what makes one screen's QC number comparable to another's.",
    checkedIn: "docs/02-pipeline.md, docs/04-data-sources.md",
  },
  {
    id: "library-detect",
    claim: "The library is read out of the reads, not the file name",
    measured:
      "Guides are matched against every library and ranked by the fraction of the candidate hit. 500 random Brunello guides fingerprint to Brunello at 100%, with every decoy library under 2%. Guide position comes from an anchor scan rather than a fixed trim, because TKOv3's backbone uses a different anchor and a plain 5' trim fails silently on it.",
    checkedIn: "engine/splicr/detect.py, engine/splicr/config.py",
  },
  {
    id: "counting",
    claim: "Counting agrees with the authors' own published counts",
    measured:
      "On GSE145743, a published genome-wide olaparib screen, counting raw FASTQ gives a median per-guide CPM ratio of 0.978 against the authors' table and a Spearman correlation of 0.93. Absolute counts cannot match: their table was subsampled to 5 million reads with replacement and merged across half-libraries. Rank and depth-normalised magnitude can, and do.",
    checkedIn: "data/testdata/README.md, engine/splicr/count.py",
  },
  {
    id: "recovery",
    claim: "The paper's own gene comes back without being told about it",
    measured:
      "The same run puts CHD1L, the gene that screen's paper is about, at rank 4 of 20,916 scored genes, and calls PARG, the canonical route to PARP inhibitor resistance, at FDR 0.006. One screen is one screen, so read this as evidence the pipeline is wired correctly rather than as an accuracy figure.",
    checkedIn: "engine/splicr/pipeline.py, GSE145743",
  },
  {
    id: "offtarget",
    claim: "Off-target flags reproduce their source exactly",
    measured:
      "Fortin et al. 2019's published per-gene multiplex counts are reproduced for 20,872 of 20,872 GeCKOv2 genes, mean difference zero. Counting distinct gene symbols instead, the obvious reading, reproduces 81.7% and overstates by 0.66 guides per gene, because two overlapping annotations at one cut site are one cut.",
    checkedIn: "engine/splicr/artifacts.py",
  },
  {
    id: "null-means-unmeasured",
    claim: "An unmeasured field is empty, never zero",
    measured:
      "Off-target columns hold counts from the guides the screen actually used, or nothing at all. Correcting that removed false critical flags from CHD1L, POLE3, POLE4, CDK2 and PARP1 on the olaparib screen, and left PARG reading 1 of 3 guides as a warning. The earlier version told a user to discard their most reliable real hit.",
    checkedIn: "engine/splicr/artifacts.py",
  },
  {
    id: "qc-definitions",
    claim: "QC metrics use the definitions their sources use",
    measured:
      "Gini on log(count+1) as MAGeCK computes it, NNMD as median over MAD as Chronos redefined it rather than the original mean over SD, and the 10-fold skew ratio attributed to Joung et al. 2017 rather than to Broad GPP. NNMD is measured on the dropout contrast: on the olaparib screen, treatment against control reports -0.02 and fails a good screen, while the same screen against its plasmid measures -2.63 and passes.",
    checkedIn: "engine/splicr/config.py, engine/splicr/qc.py",
  },
];

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
