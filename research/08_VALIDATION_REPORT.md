# Validation report

Status: **reliability improvements verified within the tested scope; new benchmark superiority and prospective generalization not established.** Date: 2026-09-27.

## Main prediction results

All new results below use metadata-only prediction with training-union gene candidates. Training: 1,349 screens through 2020. Model selection: 218 screens from 2021. Replay: all 334 public test screens from 2022 onward, representing 63 publication identifiers. The official evaluator is unchanged. Public-test history prevents an untouched-test claim.

| Method | Test AnDCG@100 | 95% publication bootstrap |
|---|---:|---|
| Historical global prior | 0.050953 | [0.025164, 0.087776] |
| Validation-selected text residual ridge | 0.052459 | [0.025146, 0.091569] |
| Published external ensemble | 0.163091 | [0.124352, 0.211693] |
| Validation-selected metadata-only router | 0.160369 | [0.120386, 0.211201] |

Paired ridge−global difference: **+0.001507**, 95% interval **[−0.001993, +0.005019]**; relative point change +2.96%. Paired router−ensemble difference: **−0.002722**, interval **[−0.015581, +0.006268]**; relative point change −1.67%. Both intervals include zero. Neither result justifies a superior-model claim. Ranking-model validation results were used for selection and are explicitly optimistic.

The original library-aware SplicR baseline reproduces at 0.136052 over eight seeds. Its different training size and supplied gene universe prevent interpreting the metadata-only numbers as a fair regression from that baseline. The archived library-aware router reproduces at 0.219952 versus the comparably processed ensemble at 0.219324: also a tie. These tracks are kept separate.

## Secondary metrics and failures

| New metadata-only router | Value |
|---|---:|
| AnDCG@10 | 0.220311 |
| Official condensed precision@10 | 0.236991 |
| Official condensed precision@100 | 0.142465 |
| Recall@100 | 0.124638 |
| Mean measured genes among first 100 unique predictions | 70.102 |
| Wrong-direction fraction among returned unique top-100 predictions | 0.013487 |
| Invalid HGNC fraction | 0.001300 |

These are means across screens, not accuracy probabilities for future genes. Zero relevance includes measured nonhits; unmeasured predictions remain unknown. Official condensed precision and fixed-slot precision are separate columns in the artifacts. A low wrong-direction fraction does not prove that zero-relevance predictions are correct.

| Router phenotype | Screens | Publication IDs within category | AnDCG@100 |
|---|---:|---:|---:|
| Drug / chemical / environment | 144 | 32 | 0.138033 |
| Host–pathogen | 105 | 16 | 0.177222 |
| Fitness | 44 | 12 | 0.198193 |
| Molecular output / reporter | 39 | 7 | 0.160636 |
| Trafficking / structure | 2 | 2 | 0.046558 |

Publication counts overlap across categories; do not add them to estimate independent studies. The fitness gate improved its selection cohort but failed to transfer the advantage to test. Global/ridge predictors average only ~53 measured genes per top 100. These observations explain limitations; they are not permission to inspect target libraries or tune against test answers.

Full distributions, modality/cell/condition groups, training-seen versus unseen contexts, and descriptive author-year strata are saved in `*_summary.json` and `leakage_and_novelty_audit.json`. Small groups are retained, with counts and broad/undefined uncertainty. No difficult screens were removed. Author-string years are descriptive metadata and not independently verified publication dates.

## Leakage and independence audit

The complete snapshot has no repeated screen ID crossing splits and no `source_id` crossing splits. Exact signed gene-label signatures identify six duplicate groups inside the dataset; absolute-value signatures identify 182 groups, including potential reverse-direction relationships. Neither signature has a cross-split group. This is an exact-match audit, not proof against shared experiments processed differently or publications with different identifiers.

New models fit vocabulary, priors, residuals and candidates only on training rows. Typed query interfaces discard targets, their measured genes and post hoc notes. Same-publication donors are excluded; regression refuses overlapping publication inference. No modern external biological feature or unrestricted literature retrieval was added to the strict models.

Remaining contamination risks: curated phenotype text can disclose post hoc facts; LLM pretraining may contain target papers; the existing public test was repeatedly explored; historical fusion channels use modern annotations with incomplete per-fact dates. A metadata allowlist cannot establish historical availability. Training has only 134 publication identifiers, not millions of independent gene-label examples.

## Track B evidence

The corrected pipeline was exercised with actual installed MAGeCK and BAGEL2 on the existing deterministic planted-control integration fixture. That fixture verifies software wiring; its precision is not published as biological validation. The rejected pooled-BH variant and reason are retained.

The author-processed GSE145743 olaparib count table contains 123,411 guides and yielded 21,524 MAGeCK gene rows. Correcting selection across the two directional families reduced q<0.1 calls from 39 to 22. DrugZ pairing sensitivity was tested; unpaired mode produced 4 sensitizers/39 suppressors and paired mode 2/48. Neither mode was selected to maximize a known gene's result. CHD1L was not significant, and existing QC failed on dropout/depth criteria. No independent validation success is inferred.

Count-only read-mapping rate/total reads are now explicitly unknown rather than an invented 100%; count totals remain observed. Real-data summaries preserve the distinction. Full details and exact inputs: `POSTSCREEN_IMPLEMENTATION.md` and `artifacts/postscreen_*_audit.json`.

## Separate raw sequencing reproduction

Recounting four actual GSE145743 FASTQ files processed **26,336,701 reads**, comparing **65,383 GeCKOv2 A guides per sample** against the authors' deposited table. Median CPM ratios were 0.9691–0.9763; Spearman correlations were 0.9289–0.9548; fractions within 25% were 0.8401–0.8949. Mapping fractions were 0.8143–0.8893. These mapping fractions come from FASTQ alignment/counting and must not be assigned to count-only uploads.

The author table merges libraries A+B and is normalized/subsampled; this check compares library A CPM. It establishes observed agreement for these four files, not exact equality, universal counting accuracy, or hit-validation success. Dropout differences remain in the report. Command: `PYTHONPATH=engine engine/.tools/env/bin/python engine/tests/validate_counts.py`. Results and source hashes: `artifacts/raw_count_reproduction.json`, `artifacts/raw_count_inputs.json`; full output: `artifacts/raw_count_reproduction.log`.

## Calibration and prospective status

**No suitable independent validation-outcome cohort was established.** Therefore no Brier score, log loss, ECE, validation-success percentage, acquisition gain or laboratory-budget success rate is reported. Unvalidated candidates are not failures. The portable report and prediction output use null validation probability with an explanation.

A future blinded cohort must be collected by an independent custodian, publication/experiment/laboratory-disjoint from training and development. Freeze code, training manifests, metadata, candidate-input policy, predictions, outcome definition and analysis plan before outcomes are revealed. Register all attempted candidates, including negative and inconclusive outcomes and selection reasons. Use study/laboratory grouping, paired comparisons and predeclared budgets. Do not keep calling an exposed cohort prospective after its labels have been used for model decisions.

The implemented exclusive-create SHA256 receipt supports this workflow but does not create new biological data or provide trusted external timestamps. **Independent prospective validation remains outstanding.** The public 19-screen LaTest set was already inspected historically and is not relabeled as a new prospective set.

## Engineering gates and limits

Baseline and final test results are recorded in `10_FINAL_RESULTS.md` and machine-readable test logs. Adversarial regressions cover sparse matrix ownership, missing-versus-negative exposure, target-label poisoning, forbidden context fields, publication exclusion, exact evaluation coverage, top-k no-backfill behavior, bootstrap grouping, immutable receipts, count parsing, directional statistics, modality-aware artifacts and real-workspace data isolation.

Synthetic fixtures are clearly test-only. Published measurements use actual downloaded benchmark/GEO records. Source-level and isolated-session frontend tests establish behavior under those adapters, not a live production-tenant security audit. No deployment, production database write, destructive migration or fresh external model call occurred. No claim of error-free software, perfect biology or fully implemented advertised workflows is supported.

## 2026-09-28 addendum: two further prediction experiments, both negative

Two preregistered experiments were run after the 2026-09-27 checkpoint and are
published here under contract `20260928-research-addendum`. **Neither is
promoted, neither changes any public-test number above, and neither accessed the
334-screen public test.** They were scored once on the 2021 validation split
(218 screens, 34 publications). Full configurations, per-screen results and
hashes are registered in [the experiment registry](06_EXPERIMENT_REGISTRY.md)
as experiments D and E.

| Experiment | Selected by publication-grouped CV | 2021 validation AnDCG@100 | Result |
|---|---|---:|---|
| D — gene-level LambdaRank, 57 features | `E2_history_lambdarank` | 0.180985 | −0.005452 [−0.016147, +0.010805] vs ensemble 0.186437 |
| E — requested-effect polarity | `P0_baseline_D3` — the baseline won | 0.099450 | polarity prior −0.007931 [−0.023172, +0.004531] vs that baseline |

Experiment D tested whether a regularized LambdaRank over smoothed rates,
measured exposure, publication support, donor transfer and independently
generated expert ranks beats the published ensemble. Its paired interval
contains zero and its point estimate is lower, over 10,000 publication-cluster
resamples. Fourteen configurations were compared, so the cross-validation
estimate is not unbiased and is recorded as such.

Experiment E tested whether parsing the requested outcome polarity from fine
phenotype text helps. The parser works: it separates all 47 metadata-matched
increase/decrease comparisons that every previous feature set collapsed into
identical rankings. Conditioning the estimator on it made ranking slightly
worse, so cross-validation selected the unconditioned baseline. The useful
distinction is between a **representation** gap, which this closed, and a
**ranking** gap, which it did not.

Two runs of experiment D were discarded rather than reported: one for a
gene-alias defect that treated `P53` as unmeasured although the official
evaluator maps it to `TP53` (3,931 training prediction entries affected,
including 1,216 positive-hit entries), and one aborted by a type-guard review.
Both are preserved and labelled INVALID, and excluded from every aggregate.

## 2026-09-28: which hits reproduce (post-screen replication)

A different task from every table above. Those predict a screen's hits from its
description, before it is run. This one asks the product question: **given the
screen a lab actually ran, which of its candidates reproduce in an independent
screen?** The benchmark is the cross-screen replication set documented in
`docs/07-replication-benchmark.md` — screen pairs from different publications,
first authors and libraries, in the same cell line, unperturbed proliferation.

Held out, **scored once**, model frozen beforehand, 124 screen pairs that share no
publication and no cell line with anything used to fit it.

| ranking | average precision | precision@10 |
|---|---:|---:|
| **SplicR reliability ranking** | **0.3538** | **0.915** |
| the screen's own effect size | 0.2464 | 0.696 |
| the screen's own hit call | 0.1334 | 0.276 |
| chance | 0.0298 | 0.030 |

Paired and resampled by screen pair: **+0.1074 [+0.1020, +0.1128]**, Wilcoxon
p = 4.3e-22. On the 11 pairs outside the dominant Behan-2019 / Meyers-2017 library
comparison, which was declared as a separate stratum in advance:
**+0.0721 [+0.0474, +0.0979]**, p = 9.8e-04.

Four checks were run against it rather than argued. The model was selected by
leave-one-publication-out cross-validation inside development and then amended,
before any held-out label was read, to a DepMap-free feature set — because DepMap
`CRISPRGeneEffect` *is* the Broad Avana experiment and Meyers 2017 is the Avana
publication, the label side of 113 of the 124 pairs. The clean model then scored
*higher* on held out (0.3538 against 0.3464). Removing a second common-essential
list retains 95% of the gain, so this is not textbook essentiality. The leakage
assertion passes over all 248 units. An independently written bootstrap
reproduces the headline to six decimal places.

**Promotion status: research_only.** Cross-screen replication is a proxy for
reproducibility, not proof that a candidate passes an independent biological
validation assay, and this is a ranking rather than a calibrated probability.
`research/15_PROSPECTIVE_VALIDATION_PROTOCOL.md` is the blinded design that would
convert it.

