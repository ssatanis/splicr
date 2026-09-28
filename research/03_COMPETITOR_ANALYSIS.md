# Competitor and alternative-method analysis

As of 2026-09-27. This is a task-specific technical comparison, not a claim that SplicR outperforms every commercial product. Sources were read from primary publications and official projects. No vendor's undisclosed customer outcomes are assumed.

## 1. Relevant competitive categories

| Category | Representative alternatives | What users obtain | Fair comparison for SplicR |
|---|---|---|---|
| Count-to-hit inference | MAGeCK RRA/MLE, MAGeCK2, BAGEL2, DrugZ | Gene effects, rankings and significance/essentiality evidence from measured guides | Same count tables, controls, contrast and preprocessing; recovery of independent outcomes plus guide/replicate robustness |
| Large fitness-panel modeling | CERES, Chronos, CRISPRcleanR, JACKS | More reliable dependency estimates or guide effects across suitable experiments | Appropriate fitness cohorts; preservation of true amplified dependencies and removal of cutting artifacts |
| Screen catalogs and dependency portals | BioGRID ORCS, Broad DepMap, Sanger Project Score | Searchable published screens, cell-line dependencies and contextual information | Provenance, retrieval quality, coverage, permitted data access and freshness; catalog size is not prediction accuracy |
| Description-to-gene prediction | AssayBench frequency/retrieval baselines, generalist LLMs, learned relevance models | Candidate genes before measurements exist | Official temporal AnDCG, direction, coverage, study uncertainty and inference cost |
| Perturbation response models | Geneformer, scGPT, scFoundation, GEARS, CPA | Representations or predicted molecular response with required molecular inputs | Same endpoint and available inputs; transcriptome accuracy is not automatically hit-ranking accuracy |
| Adaptive experimental selection | AssayLoop/AssayFormer and acquisition baselines | New batches chosen using observed outcomes | Matched budget, sequentially hidden outcomes, enrichment and diversity |
| End-to-end laboratory prioritization | SplicR's intended combined workflow | Ingestion, QC, evidence, candidate choice and outcome feedback | Independent validation yield, scientist time saved, artifact sensitivity, auditability and cost |

The open-source inference engines are often components of a strong product, not components SplicR needs to replace. `engine/splicr/hits.py` already integrates several. Defensible differentiation would be correctness of the entire workflow and evidence of decision value.

## 2. Description-only prediction: measured competitive bar

The official AssayBench temporal test table reports the following. These are external reference values; see `05_BENCHMARK_REPRODUCTION.md` for local replay.

| Method | Published AnDCG@100 | Information and operational constraint |
|---|---:|---|
| Oracle kNN | 0.2918 | Uses target answers to select its historical donor; diagnostic only |
| LLM ensemble | 0.1631 | Multiple published model outputs; exact membership/fusion must match the artifact |
| Gemini 3 Pro | 0.1570 | Hosted model snapshot; exact prompt and sampling matter |
| GPT-5.4 | 0.1470 | Hosted model snapshot; target-publication memorization cannot be ruled out |
| Gene-frequency by phenotype | 0.1334 | Strong inexpensive reference, driven by historical recurrence |
| Embedding kNN | 0.0646 | Description similarity does not guarantee transferable hit biology |
| Gene-relevance predictor | 0.0565 | More learned capacity did not establish superiority in this reported setting |

Source: [official published table](https://arxiv.org/html/2605.10876v1). Existing SplicR documentation reports 0.1361 for one legacy scorer; that value needs reproduction under its exact available-input protocol and is not an independent result of this review.

A fair leaderboard has to hold training screens, target-library access, candidate universe, symbol normalization and evaluator fixed. A system trained on 1,567 pre-2022 entries has more labels than one trained on 1,349 entries. A cached ensemble reranker and a locally executable predictor have different deployment requirements. List both distinctions in the result table rather than hiding them in footnotes.

The official repository supplies archived predictions, enabling inexpensive reproducible comparisons. No new paid calls were made. The published model name alone is not a reproducibility guarantee. [Benchmark code and artifacts](https://github.com/Genentech/AssayBench).

Official documentation checked on 2026-09-27 lists GPT-5.4, lists `gemini-3.1-pro-preview`, and marks Gemini 3 Pro Preview as shut down. This establishes public documentation status, not this account's permissions or reproducibility of the historical benchmark's model endpoint. Substituting Gemini 3.1 Pro is a new experiment, not replay of Gemini 3 Pro. Fresh latency and monetary cost were not measured. [OpenAI GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4), [Google model catalog](https://ai.google.dev/gemini-api/docs/models?hl=en), [Google deprecations](https://ai.google.dev/gemini-api/docs/deprecations).

## 3. Count methods: where SplicR should integrate rather than claim novelty

MAGeCK RRA supplies a useful general two-condition reference; MLE adds an explicit design matrix and guide efficiency. SplicR's advantage must be reliable configuration, QC and interpretation, not renaming their statistics. [MAGeCK-MLE/VISPR](https://pmc.ncbi.nlm.nih.gov/articles/PMC4699372/).

MAGeCK2 deserves a compatibility experiment for UMI, paired-guide and paired-sample data, but an installed successor is not evidence of stronger biological inference. Pin and compare it on representative fixtures before switching tools. [Official MAGeCK2 docs](https://github.com/davidliwei/mageck2-doc).

BAGEL2's essential/nonessential training references suit fitness classification. DrugZ's differential design suits chemogenetic sensitivity and suppression. Averaging their raw scores would combine different statistical quantities; any consensus needs an explicit task, normalization and independent evaluation. [BAGEL2](https://pmc.ncbi.nlm.nih.gov/articles/PMC7789424/), [DrugZ](https://pmc.ncbi.nlm.nih.gov/articles/PMC6706933/).

Chronos is a strong alternative for large matched fitness panels with appropriate experimental metadata. Its authors' comparisons on dependency datasets cannot establish universal superiority on infection, activation, reporter or patient-derived assays. [Chronos](https://pmc.ncbi.nlm.nih.gov/articles/PMC8686573/).

## 4. Data portals: useful infrastructure and important product boundaries

BioGRID ORCS curates published gene-level results and metadata. Its original score fields and author thresholds vary across screens; a single combined score cannot be presumed to have the same biological meaning everywhere. SplicR can add traceable harmonization, but must not describe downloaded gene summaries as uniformly reprocessed raw reads. [ORCS curation guidance](https://wiki.thebiogrid.org/doku.php/orcs%3Acuration_guide).

DepMap and Project Score supply functional dependencies in cancer models. Using their measurements as features for the same underlying experiments would recycle labels. Project Score's published terms exclude resale and commercial service use under its ordinary internal-research license; SplicR cannot assume a public download confers product rights. [Project Score official resource and license](https://www.sanger.ac.uk/tool/project-score-database/).

Open Targets combines target evidence and mechanism information; its published licensing page marks platform data CC0 and describes agreements with contributing sources. This is useful for a documented platform export, but does not automatically license a separate direct download from a restricted upstream provider. [Open Targets license](https://platform-docs.opentargets.org/licence).

## 5. Adaptive acquisition is a separate competitive frontier

AssayLoop evaluates sequences of experiments, allowing later selections to depend on earlier outcomes. Its comparison should use the same candidate universe, number of rounds and effective budget. A static ranking must remain static in its baseline run; an adaptive policy must receive only outcomes already purchased. [AssayLoop paper](https://arxiv.org/abs/2609.11877).

Potential SplicR differentiation is a real laboratory loop: preserve the initial recommendation, capture selected candidates and reasons, record positive/negative/inconclusive outcomes, update evidence, and propose a new batch with visible tradeoffs. A functional UI or a simulated replay does not establish that laboratories discover more validated biology. A prospective study is needed.

## 6. Evidence required for commercial differentiation

| Intended claim | Evidence required | Current interpretation |
|---|---|---|
| “Better screen prediction” | Comparable official scores, study-level paired uncertainty, separate prospective evaluation | Report exact measured result, never “best overall” without the relevant comparison set |
| “Calibrated chance of validation” | Defined event, representative independent outcomes, held-out calibration and selection-bias analysis | Cannot be inferred from p-values, FDR, Bayes factors or cross-screen recurrence |
| “Finds artifacts” | Per-artifact references and independent false-positive/false-negative measurements | Flags are risk evidence; correction must preserve genuine dependencies |
| “Saves validation budget” | Same-budget candidate selection tested against independently acquired outcomes | Rank quality and retrospective overlap are useful preliminary evidence |
| “Unique data advantage” | Consented, versioned outcomes with negative and inconclusive results plus selection records | Public data itself is not proprietary differentiation |
| “Every screen, one pipeline” | Inventory of raw reads/counts actually processed, tool versions and successful run records | A catalog of heterogeneous published summaries does not satisfy this claim |

The most credible near-term product is an auditable evidence and analysis workflow with a rigorously evaluated predictor. Confidence categories, explicit missing evidence and reproducible reports are more useful than unsupported precision.
