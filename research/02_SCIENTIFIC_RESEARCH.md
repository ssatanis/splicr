# Scientific research review

Review date: 2026-09-27. This document distinguishes published evidence, repository observations, and proposed experiments. A reviewed method is **not** an implemented SplicR feature. New run results belong in `06_EXPERIMENT_REGISTRY.md` and `08_VALIDATION_REPORT.md`.

## 1. What can be predicted, and what is being evaluated?

Track A estimates a gene ranking from a prospective experimental description. Track B estimates observed perturbation effects from measurements, then prioritizes follow-up. A third task, adaptive acquisition, uses observations from completed rounds to select the next round. These have different available information and must have different result tables.

AssayBench's primary temporal benchmark has 1,349 training entries through 2020, 218 validation entries in 2021, and 334 test entries from 2022 onward. An additional 19 LaTest entries are public. The paper reports AnDCG@100 of 0.2918 for Oracle kNN, 0.1631 for its LLM ensemble, 0.1570 for Gemini 3 Pro, 0.1470 for GPT-5.4, 0.1334 for phenotype gene frequency, and 0.0646 for embedding kNN. The oracle uses target answers to choose a donor; it is not deployable or a universal upper bound. These are published values, not measurements produced by this research document. [AssayBench paper, Table 2](https://arxiv.org/html/2605.10876v1).

The official package exposes `AssayBenchDataset` and `RankingMetrics`. Its source repository contains prediction files and figure scripts, so replay of published outputs is possible without purchasing fresh model inference. Replay does not establish that an API model remains available, has the same weights, or can reproduce a stochastic historical output. Record model identifier, prediction-file hash, prompt/configuration, number of runs, and inference date separately. [Official repository](https://github.com/Genentech/AssayBench).

### The metric contract

For a list of genes, map assayed genes to signed relevance and unassayed genes to missing. Pad a short list with zeros, truncate at k, then remove missing positions. **Never backfill with genes originally below k.** DCG uses linear signed relevance divided by `log2(rank+1)`. IDCG sorts relevance after clipping negatives to zero. Adjust against the analytical, screen-specific random baseline and clamp below zero. Precision and directional FDR have different condensation conventions; do not infer them from DCG. [Official metric documentation](https://genentech.github.io/AssayBench/metric.html).

The paper's prose allows negative adjusted scores, whereas the documentation and implementation clamp them. Precision terminology also varies between ordinary and normalized precision. The metric page describes precision condensation before cutoff, but the current source's `compute_precision_at_k` truncates first. Reproduction must pin the code revision and test edge cases against that implementation. The random baseline is the nDCG of `min(k, G)` copies of the mean target relevance; HGNC mapping and invalid-symbol penalties are separate constructor settings. [Official metric source](https://raw.githubusercontent.com/Genentech/AssayBench/main/src/assaybench/benchmark/metrics.py).

Repository-specific concern: `docs/08-assaybench-headroom.md` describes using the target's measured library to densify and pad a list. That is a library-aware prediction protocol and must not silently replace description-only predictions or be presented as a fair improvement over untouched published lists. Upstream itself is inconsistent: the landing page mentions a candidate list, while the prompt and metric comments describe unknown assayed genes. Declare permitted inputs and apply identical rules to every comparator. [Official task description](https://genentech.github.io/AssayBench/). `engine/analysis/assaybench_fusion/README.md` records deliberate test-label diagnostics; those historical test results are exploratory, even when the eventual weight fit uses pre-2022 screens.

Clamping is itself important to interpretation: a random ranking can have a positive mean clamped AnDCG because negative deviations are erased. Thus “zero means random” is a normalization shorthand, not a statement that the empirical expected clamped score of a finite random ranking is exactly zero. Report seeded random replicates if using random performance as an empirical comparison.

## 2. Established methods for measured count data

These methods solve Track B; none predicts unseen assay hits from text alone.

| Method | Statistical mechanism and required input | Suitable use and limitations | Primary source |
|---|---|---|---|
| MAGeCK RRA | Normalized guide counts; fitted mean–variance relationship and negative-binomial guide tests, followed by modified robust rank aggregation into gene enrichment/depletion results | Strong two-condition baseline; replicates improve dispersion evidence. Gene FDR is not a validation probability. Default normalization can fail if most guides shift | [Li et al., 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC4290824/) |
| MAGeCK-MLE / VISPR | Negative-binomial generalized linear model with sample design matrix, gene beta effects, and latent guide efficacy; VISPR supplies QC and visualization | Multi-condition, time-course and interaction contrasts require an identifiable design. A confounded batch cannot be repaired by adding a model term. Guide efficiency and normalization assumptions must match the library | [Li et al., 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC4699372/) |
| MAGeCKFlute | Workflow combining RRA/MLE outputs with QC, normalization and functional analysis; supports copy-number correction options | Useful reporting and differential-dependency workflow; pathway enrichment is downstream interpretation, not independent validation | [Wang et al., 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6862721/) |
| MAGeCK2 | Maintained successor with RRA/MLE, paired sample support, UMIs and paired guides | Assess through matched fixtures before replacing the installed tool. Official PyPI has version 0.3.0 dated 2026-09-11; a packaging release is not evidence of improved hit prediction | [Official documentation](https://github.com/davidliwei/mageck2-doc), [versioned package](https://pypi.org/project/mageck2/0.3.0/) |
| BAGEL / BAGEL2 | Essential and nonessential reference distributions over fold changes; Bayes factors, with BAGEL2 computational and multi-targeting corrections | Well matched to loss-of-function fitness screens. Reference classes must be appropriate. Bayes factors depend on class models; they are neither FDR nor probability of validation. BAGEL2 does not itself solve copy-number correction | [Kim and Hart, 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC7789424/) |
| CRISPRcleanR | Unsupervised genomic segmentation of guide fold changes and correction of regional gene-independent shifts | Works without a supplied CN profile, but needs sufficient genomic coverage. Compare corrected and uncorrected effects; broad real biological signals may resemble artifacts | [Iorio et al., 2018](https://pubmed.ncbi.nlm.nih.gov/30103702/) |
| CERES | Joint model separates gene effects and copy-number-associated cutting effects while estimating guide activity across screens | Designed for large knockout fitness panels with CN profiles; does not transfer automatically to CRISPRi/a or arbitrary reporter assays | [Meyers et al., 2017](https://www.broadinstitute.org/publications/broad135411) |
| Chronos | Mechanistic population-dynamics model accounting for growth, guide efficacy, screen quality and heterogeneous editing outcomes; separate CN correction | Strong candidate for large viability panels with raw counts, pDNA/baseline mapping and time metadata. Its gene effect is a fitness estimate, not a general phenotype or calibrated success probability | [Dempster et al., 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8686573/) |
| DrugZ | Abundance-dependent variance estimation for guide fold changes; guide/replicate evidence aggregated to gene Z scores and multiple-testing results | Treated versus untreated chemogenetic interactions, including sensitivity and resistance. Preserve pairing and distinguish drug-specific interaction from baseline essentiality | [Colic et al., 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6706933/) |
| JACKS | Joint Bayesian factorization of guide efficacy and screen-specific gene effects using screens sharing a guide library | Reuses guide information across experiments while retaining different gene effects. Requires compatible guide identities; does not independently remove every CN artifact | [Allen et al., 2019](https://genome.cshlp.org/content/29/3/464) |
| ScreenBEAM | Bayesian hierarchical model of reagent effects and replicate variability for functional-genomic meta-analysis | Useful reference for sharing information without treating reagents as independent gene replicates. Distributional assumptions differ from a raw-count NB model | [Yu et al., 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC4907394/) |

SplicR already wraps MAGeCK RRA/MLE, BAGEL2 and DrugZ in `engine/splicr/hits.py`; replacing them with a homemade significance score would discard established inference. Improvements should focus on input validation, design-aware routing, explicit tool versions, complete outputs, and comparisons on the same count tables. Tool agreement is not independent evidence when all tools consume the same guides.

Recommended count experiment: freeze public raw-count datasets with matched biological replicates; compare applicable methods using leave-one-replicate-out rank agreement, control-gene precision–recall, guide downsampling, depth downsampling, and independent validation where available. Do not call recovery of the essential-gene training reference independent evidence for BAGEL. Evaluate false depletion among nonexpressed genes and persistence of known amplified oncogene dependencies separately. Preserve all results, including failed method runs.

## 3. Biological assumptions that must become explicit features

Cas9 knockout induces DNA cleavage; CRISPRi and CRISPRa regulate transcription without the same cutting mechanism. Guide design depends on modality, target position and chromatin context. Activity predictors developed for nuclease libraries cannot be assumed valid for repression or activation. [Doench et al., 2016](https://www.nature.com/articles/nbt.3437), [Horlbeck et al., 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC5094855/).

Copy-number amplification can produce a gene-independent antiproliferative cutting response. A high copy-number value is therefore an artifact risk, not proof that a particular dependency is false. Compare genomic-neighborhood shifts, guide specificity, expression and orthogonal noncutting perturbation, retaining the original effect. [Aguirre et al., 2016](https://pmc.ncbi.nlm.nih.gov/articles/4972686/).

Ferroptosis is an iron-dependent cell-death process with a distinct mechanism from apoptosis. For prediction, a “cell death” category alone is too coarse. Keep inducer, rescue condition, cell background and measured endpoint. A gene that changes a lipid-peroxidation readout need not change terminal viability on the same timescale. [Dixon et al., 2012](https://pmc.ncbi.nlm.nih.gov/articles/3367386/).

The following are modeling hypotheses, not asserted measured SplicR improvements:

| Biological distinction | Feature or analysis implication | Falsification experiment |
|---|---|---|
| Generic proliferation versus context-specific dependency | Separate common-essential prior from phenotype-conditioned residual; include control/treatment contrast | Report fitness and nonfitness results separately; compare residual model with frequency alone |
| Resistance versus sensitization | Explicit requested outcome, selection direction and perturbation modality; preserve negative relevance | Reverse-direction paired entries must stay in one study group; report wrong-direction rate |
| Synthetic lethality versus single-gene essentiality | Interaction needs genotype/condition and appropriate controls | Hold out genotype or compound class; test against marginal single-gene effects |
| DNA damage versus other stresses | Target/mechanism annotations and baseline DNA-repair context | Compare mechanism matching with compound-name matching; exclude target-publication annotations |
| Host entry versus replication versus immune response | Organism/strain, receptor context, readout stage, exposure time | Leave-pathogen-family-out and leave-cell-line-out validation |
| Reporter signal versus survival | Readout type, reporter gene, sorting gate and normalization | Compare against viability-only prior; inspect assay-marker leakage |
| Dose and duration | Unit-normalized concentration and exposure, missingness flags; nonlinear interactions | Hold out dose ranges rather than random rows from the same titration |
| Mutations and cell background | Exact stable cell identity and genotype provenance; derivatives kept distinct | Leave-lineage/study out; ablate parent-line substitution |

### Compound normalization

Preserve the submitted name and map through a versioned synonym table to stable ChEMBL identifiers, structures and mechanism annotations. Store salt form and parent relationship rather than erasing them. Normalize numerical dose to molar units only when unit and molecular identity are unambiguous; ranges, combinations and unknown doses remain explicit. Targets require organism, assay type, potency relation and provenance. Binding is not necessarily cellular target engagement, and an inhibited target is not necessarily a knockout-resistance gene.

RDKit provides molecular parsing, fingerprints and standardization tools. Pin its version and standardization options; reject invalid structures visibly. A useful experiment compares exact compound identity, target overlap and structure similarity under scaffold/compound holdouts. Structure similarity is a feature whose value needs measurement, not an assumption of identical biological response. [RDKit documentation](https://www.rdkit.org/docs/), [MolStandardize API](https://www.rdkit.org/docs/cppapi/namespaceRDKit_1_1MolStandardize.html).

## 4. Architecture hypotheses worth testing

### A. Measured-denominator, context-conditioned priors

For context c and gene g, let `n_gc` be the number of eligible historical screens that measured g, and `h_gc` the number with positive relevance. A shrinkage estimate is

`p_gc = (h_gc + alpha_c * p_g,parent) / (n_gc + alpha_c)`.

This is a posterior mean under a beta-binomial construction conditional on a fixed parent rate. If the parent rate is estimated, its uncertainty must be included before calling an interval Bayesian. For ranking, a regularized conditional frequency is sufficient; do not advertise a calibrated validation probability. Estimate opposite-direction relevance separately. Never count an unmeasured gene as a non-hit. Weight or aggregate related entries so a publication with many directional variants does not dominate support.

Fit shrinkage and context granularity using publication-grouped inner folds. Use a small predetermined family of phenotype, modality, direction and compound/pathogen contexts. Back off on unseen contexts. Prefer sparse sufficient statistics over a dense screen × gene × context tensor. This hypothesis is feasible with existing data, requires no API, and directly addresses sparse evidence and phenotype mixture shifts.

### B. Retrieval that transfers effects, not just words

Compare BM25 or TF–IDF retrieval with existing embeddings and structured matching under the same historical donor set. Exclude the query's entire publication, duplicate experiment, reverse-direction variants and prohibited dates. Donor rankings should carry source identity and transfer direction. A query mentioning “resistance” must not inherit sensitivity hits merely because both mention the same drug.

Learn a similarity or donor weighting function only from out-of-fold transfer scores computed within permitted training data. Include a no-transfer option when context support is weak. Any learned cross-encoder must be compared with inexpensive lexical retrieval; expensive embedding inference does not establish biological relevance. Retrieval of a screen's publication or supplement containing its answers is contamination even when delivered through a literature API.

### C. Gene representations with dates and ablations

Pathway, interaction, expression and dependency features can share information for rarely screened genes, but can also replace phenotype-specific signal with generic hubness. Compare annotation count and degree-only controls with full features. Use missingness indicators, train-fitted transforms and stable identifier joins. Keep evidence subtypes separate: experimental interaction, coexpression, text mining and inferred links have different dependence and contamination risks.

Repository analyses already document harmful broad Reactome/STRING expansion. That is a reason to demand controlled validation, not to discard all biological structure or retain it at arbitrary tiny weights. A strict historical experiment needs historical releases or claim-level dates. A 2026 annotation graph is modern-knowledge prediction, even without an explicit CRISPR hit table.

### D. Learned screen–gene ranking

Start with regularized linear/additive models over historical rates and context, then test a bounded tree ranker or low-rank factorization. The training sample size is the number of independent studies, not millions of screen–gene rows. Negative sampling must come only from measured nonhits, with weights correcting for sampling. For matrix factorization, unmeasured cells are masked, not filled with zero.

Pairwise logistic losses model relative relevance. LambdaMART uses rank-sensitive gradients, but its usual gain/normalization may differ from AssayBench's signed relevance and random adjustment. Select by official validation scoring; do not rewrite the metric to match a training objective. Keep a deterministic baseline, fixed feature budget, grouped folds and learning curves. Add model complexity only when study-level paired intervals and rare-context results support it.

### E. Language models and rank ensembles

Use published prediction artifacts for reproducible retrospective comparisons. New LLM experiments need exact model identifiers, frozen prompts, cost/latency records and multiple sampled runs. Biology explanations are hypotheses until linked to verifiable sources. Retrieval must respect historical cutoffs. A model's unknown pretraining corpus prevents certifying historical non-memorization; prospective private outcomes are the strongest check.

Reciprocal rank fusion avoids treating incomparable raw model scores as probabilities. Learn any weights from grouped training predictions made without that fold's labels. Missing predictions need an explicit abstention policy. A context gate adds parameters and can overfit categories with few studies; compare fixed weights, shrunk category weights and a small learned gate. Replaying a cached LLM list is not an independently deployable description-to-ranking system.

## 5. Foundation models: relevant capabilities and actual mismatch

| Model family | Published capability | Appropriate SplicR experiment and constraint |
|---|---|---|
| Geneformer | Transformer representations from rank-encoded single-cell transcriptomes for transfer tasks in network biology | Frozen representations plus a simple ranker, where a legitimate baseline cell profile exists; text alone does not supply a transcriptome. [Theodoris et al., 2023](https://www.nature.com/articles/s41586-023-06139-9) |
| scGPT | Generative single-cell model evaluated on annotation, integration and perturbation tasks | Compare frozen gene/cell embeddings against PCA/expression baselines with the same inputs and splits. [Cui et al., 2024](https://www.nature.com/articles/s41592-024-02201-0) |
| scFoundation | Large transcriptomic model with gene/cell representations and downstream response tasks | Requires expression and checkpoint provenance; representation extraction and downstream fitting need independent cost measurements. [Hao et al., 2024](https://www.nature.com/articles/s41592-024-02305-7) |
| GEARS | Graph-supported prediction of transcriptional response to single/multiple genetic perturbations | Expression-response accuracy must be converted to the actual assay endpoint and validated. GO graph dates and shared perturbations are leakage risks. [Roohani et al., 2023](https://www.nature.com/articles/s41587-023-01905-6) |
| CPA | Composes basal-state, perturbation and covariate representations, including dosage and combinations | Useful for chemical/transcriptomic subproblems; no demonstrated direct AssayBench advantage follows. [Lotfollahi et al., 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10258562/) |
| Protein and graph embeddings | Potential functional similarity features from sequence or network context | Compare with simple sequence/domain/pathway overlap. Missing isoforms, context independence and checkpoint terms must be recorded; not implemented by this review |

A 2025 experimental comparison found that several deep perturbation predictors did not beat deliberately simple linear baselines on its transcriptomic tasks. This is evidence for rigorous controls, not a theorem that deep models cannot improve assay prediction. [Ahlmann-Eltze et al., 2025](https://www.nature.com/articles/s41592-025-02772-6.pdf).

Why a sophisticated model can lose: its pretraining endpoint differs from assay hit ranking; heterogeneous assays have scarce independent labels; incomplete annotations favor well-studied genes; leakage can inflate development results; train–test phenotype proportions differ; representation quality does not guarantee a good ranking objective; and text embeddings can emphasize vocabulary instead of intervention mechanism. These are testable explanations, not accepted excuses.

## 6. Calibration and independent validation

Define the event before fitting: a candidate reproduces a predeclared, directionally consistent effect above a specified magnitude in an independent assay with specified controls. Store validation modality, replicate count, cell context, endpoint, effect and outcome status. “Not tested,” “inconclusive,” and “failed validation” are different states.

Use study/laboratory/time-separated training, calibration and evaluation sets. Compare logistic calibration with isotonic regression only when enough independent outcomes support the latter. Assess Brier score, log loss, reliability curves with uncertainty, and precision at actual validation budgets. Calibration literature demonstrates that classifier confidence often needs correction; it does not make `1 − FDR` a validation probability. [Guo et al., 2017](https://proceedings.mlr.press/v70/guo17a).

Published validations are preferentially chosen and reported. Positive–unlabeled methods require assumptions about selection and class prevalence; treating selected positives as representative generally fails. Record selection propensities where possible and randomize some validation choices prospectively. Without identifiable selection or representative outcomes, population success probabilities are not established. [Bekker and Davis, 2018](https://arxiv.org/abs/1808.08755), [SAR risk analysis](https://www.jmlr.org/beta/papers/v24/22-067.html).

SplicR's replication benchmark measures cross-screen replication, not necessarily orthogonal validation in a new laboratory. It is useful evidence but cannot support an unrestricted “chance of successful validation” label. Until an appropriate outcome cohort exists, report evidence strength, support counts and uncertainty rather than a fabricated percentage.

## 7. Sequential validation and experimental decisions

The September 2026 AssayLoop work introduces a separate 1,389-screen adaptive task. AssayFormer learns from accumulated gene/outcome observations; an LLM prior can seed an adaptive handoff. The paper reports 5.67-fold enrichment and recovery of 27.7% of hits after assaying roughly 5% of candidates. These are published sequential results, not AnDCG@100 and not SplicR results. Its architecture includes hit-matrix initialization and feedback-conditioned training. [AssayLoop, 2026](https://arxiv.org/html/2609.11877v1).

For a candidate set S, a useful decision objective is expected validated utility plus pathway coverage and information gain, subject to cost and feasibility constraints. If probabilities are uncalibrated, call the first term a prioritization utility, not expected validated hits. Redundant candidates can have decreasing marginal value; a greedy coverage rule is a transparent baseline before a learned policy.

Evaluate a policy by hiding all unacquired outcomes from its interface. After each proposed batch is frozen, reveal only that batch; charge repeated, invalid and unspent selections according to the exact sequential protocol. Report enrichment, cumulative discoveries, coverage/diversity, common-essential fraction and cost. Comparing adaptive versus frozen ranking at identical total budgets isolates the value of feedback. Simulated historical replay is useful but is not a completed prospective wet-lab trial.

## 8. Evidence standard for the current research program

1. Pin dataset, evaluator, identifier map, code revision, seeds and feature manifests.
2. Preserve a reproduction of the legacy scorer and all published accessible baselines.
3. Restrict new model selection to declared development folds; group related experiments and publications.
4. Keep a complete candidate registry, including failures; use study-clustered paired resampling for comparisons.
5. Describe public test scores as retrospective once they have informed development. A new split of already inspected labels is not prospective evidence.
6. Freeze prediction artifacts before a lab reveals independent outcomes. Maintain access logs and an outcome steward.
7. Promote a component only after its incremental benefit, runtime, missing-data behavior and failure cases are understood.

No literature review or finite test suite can establish perfect biological accuracy or a guarantee of zero software defects. The defensible deliverable is a reproducible measured improvement with an explicit boundary of validity.
