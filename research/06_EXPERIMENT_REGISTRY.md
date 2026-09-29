# Experiment registry

Date: 2026-09-27. All new prediction experiments use the official metric and exclude target gene-library information. **No tested new predictor is promoted as a superior production model.** Machine-readable manifests contain configurations, source/data hashes, timings, seed 20260927 for uncertainty, and per-screen results. Existing historical experiments are retained under `engine/analysis/assaybench_fusion` and `oracle_ceiling`; their public-test exploration remains disclosed.

## Controls and iterations

1. Preserve starting revision `166cb3c` and existing uncommitted user changes; no reset or deletion.
2. Baseline suite: 112 passed, 2 skipped. Reproduce official published rankings and old SplicR scorer before new model selection.
3. Define nine training-only prior/retrieval variants before validation scoring; write `experiment_preregistration.json`.
4. Reject the first implementation run: shared SciPy CSR index buffers were mutated by `eliminate_zeros`, corrupting measured denominators. All scores were implausibly identical. Preserve outputs under `artifacts/failed_csr_alias`; they are **invalid software-debug outputs**, excluded from scientific comparisons. Give matrices independent buffers and test measured/nonhit/opposite support against hand-calculated fixtures.
5. Run the corrected nine variants on validation only. Diagnose failures and form the separate residual-regression hypothesis. Do not read new test scores during these selection rounds.
6. Test a fixed three-alpha text-regression family against the global prior on validation. Freeze alpha 10.
7. Test a simple phenotype gate among the published ensemble, global prior and phenotype prior on validation. Require three independent publication identifiers for a category-specific choice. Freeze fitness→phenotype, other categories→external ensemble.
8. Replay each frozen final candidate on the public test. This is retrospective comparison: the broader repository had already explored test labels. No further modeling adjustments were selected from these final test outcomes.
9. Independently test protocol boundaries, reconstruct baseline results, inspect subgroups and reject unsupported superiority claims.

The local preregistration JSON files are ordered records, not externally timestamped immutable registrations. Their source/data hashes and the saved prediction lists make the run inspectable. The separate prospective receipt API uses exclusive creation and needs an independent custodian for trusted timing/access control.

## A: historical priors and transfer — validation

Training: 1,349 through-2020 screens. Validation: all 218 2021 screens. Inference receives only allowlisted metadata; candidates are the training-gene union. Missing measurements do not count as nonhits. Publication balancing assigns each study one total donor unit. Shrinkage units differ between screen- and study-weighted variants and are recorded in the configuration.

| ID / hypothesis | AnDCG@100 | Decision |
|---|---:|---|
| A0 global measured-denominator prior | 0.112560 | Strongest first-round control |
| A1 phenotype-conditioned prior | 0.082801 | Rejected as universal replacement |
| A2 phenotype + shrinkage 10 | 0.081479 | No improvement |
| A3 phenotype/direction/modality hierarchy | 0.058144 | Too sparse for this cohort |
| A4 A3 + opposite-direction penalty | 0.045298 | Harmful here |
| A5 publication-balanced phenotype, shrinkage 2 | 0.061219 | No improvement |
| A6 publication-balanced direction + signed evidence | 0.046707 | No improvement |
| A7 A6 + exact compound condition | 0.047602 | No meaningful recovery |
| A8 A6 + TF–IDF donor transfer | 0.047256 | No meaningful recovery |

Artifacts: `select_summary.json`, `select_*_screens.json`, `select_*_predictions.json`, `select_cohort_audit.json`. All failed hypotheses remain implemented as research alternatives rather than silently removed. No external annotation, modern DepMap feature, LLM call or target library enters this family.

## B: multi-output text residual learning — validation and frozen replay

Rationale: a text regressor could learn gene-specific effects beyond repeated hit frequencies. Missing cells are imputed at the gene prior, giving zero residual, rather than asserted nonhits. This is a shrinkage approximation, not a fully masked likelihood. Publication weights reduce repeated-study influence.

| Candidate | Validation | Frozen public test |
|---|---:|---:|
| Global prior | 0.112560 | 0.050953 |
| Ridge alpha 0.1 | 0.106075 | Not evaluated |
| Ridge alpha 1 | 0.107636 | Not evaluated |
| Ridge alpha 10, validation-selected | 0.114912 | 0.052459 |

Test difference versus global: +0.001507; 95% publication-cluster bootstrap [−0.001993, +0.005019]. No convincing gain. Alpha 10's validation score is selection-biased. Three alpha values were specified before their outcomes; the public test was not used to choose among them. Artifacts: `residual_preregistration.json`, `final_model_freeze.json`, `residual_select_summary.json`, `residual_replay_summary.json`.

## C: dynamic routing with external knowledge

Rationale: historical fitness hits recur, whereas drug/pathogen/reporter prediction may need information absent from small historical cohorts. Use the **unchanged** published ensemble as external expert. Compare all experts on validation before freezing the gate; no library filtering/padding is performed.

Validation: ensemble 0.186437; routed 0.194849. Difference +0.008412; publication interval [−0.012499, +0.043780]. The category gate is selected here, so this is not an unbiased performance estimate.

Frozen public test: ensemble **0.163091**, router **0.160369**. Difference **−0.002722**, interval **[−0.015581, +0.006268]**. Reject a superiority/promotion claim. Artifacts: `router_preregistration.json`, `router_freeze.json`, `router_select_summary.json`, `router_replay_summary.json`.

Model-assisted replay has unknown literature-memorization risk and does not reproduce external inference cost. The router library can accept independently generated rankings for a future experiment; it raises if the required external ranking is unavailable.

## D: gene-level supervised ranking with historical context — 2026-09-28

Date: 2026-09-28, starting revision `25e0fee`. Artifacts under
`artifacts/20260928/model_development`. Hypothesis: the conditional counters fail
because sparse estimation overranks genes with almost no measured support, so a
regularized gene-level ranker over smoothed rates, measured exposure,
publication support, donor transfer and independently generated expert ranks
should beat both the counters and the published ensemble.

Fourteen configurations were preregistered and scored on three publication
`GroupKFold` partitions of the 1,349 training screens; all counters, gene
mappings and vocabulary were refit inside each fold. Only the CV-selected
candidates went to the 2021 temporal validation split.

| Candidate on validation (218 screens, 34 publications) | AnDCG@100 | Measured top-100 | Paired vs published ensemble, 10,000 publication bootstrap |
|---|---:|---:|---|
| Published frontier ensemble | **0.186437** | 79.09 | — |
| `E2_history_lambdarank` (CV-selected) | 0.180985 | 74.95 | −0.005452 [−0.016147, +0.010805] |
| `C0_rrf60` | 0.179685 | 82.32 | −0.006752 [−0.017570, −0.001032] |
| `D4_context_exposure` | 0.106348 | 53.40 | −0.080089 [−0.129780, +0.003181] |

**No improvement was established.** The selected LambdaRank candidate's interval
contains zero and its point estimate is below the ensemble; the reciprocal-rank
control is significantly worse; the pure counter is far worse. Selection
multiplicity is 14 and the CV estimate is not unbiased, both recorded in
`final_freeze.json`. `promotion_status` is `research_only` and
`frozen_before_new_test_access` is true. **The public test was not accessed in
this experiment**, so no retrospective test number exists for it and none should
be invented.

Two runs were discarded rather than reported. A regression test found that
predicted aliases such as `P53` were being treated as unmeasured although the
official evaluator maps them to `TP53`; this affected 3,931 training prediction
entries including 1,216 positive-hit entries. The pre-fix run is preserved under
`model_development_invalid_alias` and the run aborted by a type-guard review
under `model_development_invalid_guard`, both labelled INVALID and excluded from
every aggregate. The fix routes identifiers through the official mapper and is
covered by `engine/tests/test_context_ranking.py`.

## E: requested-effect polarity — 2026-09-28

Artifacts under `artifacts/20260928/direction_development`. The failure analysis
found that 47 metadata-matched increase/decrease screen pairs received
**identical rankings** from both the phenotype prior and the direction
hierarchy, because those condition on broad phenotype and selection type rather
than on the requested outcome. `engine/splicr/effect_direction.py` parses the
requested polarity from fine phenotype text only — never from dataset
identifiers such as `_inc`/`_dec`, never from measurements — and abstains on
ambiguous, negated, combined and unsupported wording. Training coverage is 972
decrease, 251 increase and 126 unknown across 1,349 rows, and it distinguishes
all 47 matched comparisons (82 screens, five publications).

Three fixed configurations were compared on the same three publication folds.

| Configuration | CV AnDCG@100 | Paired vs `P0`, 4,000 publication bootstrap |
|---|---:|---|
| `P0_baseline_D3` (no requested-effect prior) | **0.590239** | — |
| `P1_requested_effect_prior` | 0.582308 | −0.007931 [−0.023172, +0.004531] |
| `P2_requested_effect_transfer` | 0.579559 | −0.010680 [−0.024030, +0.001069] |

**Cross-validation selected the baseline.** Conditioning the counters on parsed
polarity did not improve ranking, and the transfer variant was worse still. The
selected baseline scores 0.099450 [0.031347, 0.215871] on temporal validation
with 52.47 measured genes per 100 slots. `promotion_status` is `research_only`
and the runner has no public-test phase.

This is a negative result for the *ranking* hypothesis, not for the parser: the
parser demonstrably recovers a distinction the previous features could not
express, and its 56 tests pass. What is not established is that the distinction
improves gene ordering under this estimator. An interrupted first run, stopped
when review found a nominal request with no target (`increase in`) needed
explicit abstention, is preserved under
`direction_development_incomplete_parser_guard` and is excluded from claims.

## F/L: closing the gap to the frontier ensemble — 2026-09-28

Artifacts under `artifacts/20260928/frontier_residual`; runner
`engine/analysis/frontier_residual.py`; invariants covered by
`engine/tests/test_frontier_residual.py`.

Experiments D and E both *replaced* the ranking and both lost. This family asks
the narrower question: can a historical correction be **added** to a frontier
base without destroying it? Every candidate has a degenerate setting that
reproduces its own baseline exactly, which the regression tests assert rather
than assume:

* **F** blends a learned historical score into the reciprocal-rank base with
  weight `lambda` over {0, 0.25, 0.5, 1.0, 2.0}. `lambda = 0` *is* the base.
* **L** re-weights individual experts and adds a standardised prior term inside
  the same aggregation. Uniform weights with no prior *is* the base.

One structural constraint shaped the design and is worth recording: the
published `LLM RRF Ensemble` file contains only validation, test and novel
records — **it has no training-split predictions**, so nothing can be fitted on
top of it. The reconstructible base is reciprocal-rank fusion over the five
expert files, which do cover training. Results are reported against both that
same-input base and the published ensemble.

Protocol: three publication-grouped folds inside the 1,349 training screens
select one configuration by pooled out-of-fold mean; the selection is confirmed
once on the 2021 validation split. The runner has **no public-test phase at
all**, and a regression test asserts that it cannot load the test split.

### F/L results

Pooled out-of-fold over the three training folds, paired against the base:

| configuration | out-of-fold mean | paired vs base, 95% publication interval |
|---|---:|---|
| `F4_residual_200` (lambda 2.0) | **0.631903** | **+0.016859 [+0.004402, +0.028107]** |
| `F3_residual_100` | 0.631411 | +0.016366 [+0.006067, +0.025048] |
| `F2_residual_050` | 0.628637 | +0.013592 [+0.006851, +0.019579] |
| `L1_weighted_rrf` | 0.626897 | +0.011853 [−0.002417, +0.018243] |
| `F1_residual_025` | 0.624612 | +0.009567 [+0.005150, +0.012811] |
| `L0_uniform_prior_small` | 0.617720 | +0.002675 [+0.000867, +0.003565] |
| `F0_base_rrf60` (base) | 0.615045 | — |

Cross-validation selected `F4_residual_200`. On the training folds the residual
is a real effect: four of the six intervals exclude zero, and the gain is
monotone in lambda up to about 1.0. Those folds are 70% fitness screens, so this
is not a claim about the test mixture.

**The 2021 confirmation, scored once:**

| system | validation AnDCG@100 | measured top-100 |
|---|---:|---:|
| Published frontier ensemble | 0.186437 | 79.09 |
| **`F4_residual_200`** | **0.188284** | 78.05 |
| `F0_base_rrf60` (its own base) | 0.179685 | 82.32 |

| comparison | paired difference, 95% publication interval |
|---|---|
| `F4_residual_200` vs published ensemble | **+0.001846 [−0.014302, +0.030611]** |
| `F4_residual_200` vs its own base | +0.008599 [−0.003738, +0.036687] |
| `F0_base_rrf60` vs published ensemble | −0.006752 [−0.017570, −0.001032] |

**No superiority is established, and nothing is promoted.** Both of the
candidate's intervals contain zero. What the run does show, and what makes it
worth keeping, is narrower: this is the first candidate in this project whose
validation point estimate exceeds the published ensemble, the direction of the
cross-validated gain over its own base replicated on validation (+0.0086 against
+0.0169 out of fold), and the base it is built on is *significantly worse* than
the ensemble — so the residual moved it across that line rather than starting
above it. With 34 publications and a selection multiplicity of 7, a +0.0018
point difference is far inside the noise.

A stability caveat that argues against the aggregation branch: `L1`'s fitted
expert weights were unstable across folds — `[1.5, 1.5, 1.0, 1.5, 1.0]`,
`[1.0, 1.0, 0.25, 1.0, 0.0]` and `[1.0, 0.5, 0.25, 1.0, 0.5]` — so its
out-of-fold gain is not attributable to a reproducible weighting.

An independent cross-check fell out of this run: `F0_base_rrf60` scores
`0.3086595480710533` on fold 2 and `0.17968473979647556` on validation, matching
experiment D's separately implemented `C0_rrf60` on both to every printed digit.

Registered as `20260928_experiment_FL`; receipt in `research/evidence_registry/`.
Not added to the public evidence addendum, which the owner authorized for D and E
only.

## R: post-screen replication reliability — 2026-09-28

Artifacts under `artifacts/20260928/replication_selection`,
`.../replication_heldout` and `.../replication_verify`. Runners
`engine/analysis/replication_selection.py`, `replication_heldout.py`,
`replication_verify.py`.

This is a different task from A–F. Those predict a screen's hits from its
description, before it is run. This one asks the product question: **given the
screen a lab actually ran, which of its hits reproduce in an independent screen?**
The benchmark is `docs/07-replication-benchmark.md` — 138 metadata-matched screen
pairs from different publications, first authors and libraries, in the same cell
line, restricted to unperturbed proliferation. Primary space excludes common
essentials, because on the full space a common-essentials lookup table matches
the screen's own effect size and the headline would be a literature-recall test.

**Selection, development only.** `simple.py` fits its combinations on development
labels and then reports development numbers, so its `lr_*` rows are in-sample.
Model choice was therefore made by leave-one-publication-out cross-validation
inside development (9 folds, 14 pairs). Out-of-fold and in-sample agreed to
0.001 for the selected model, so the 2-3 feature logistic models are not
overfitting 14 pairs.

**An amendment made before any held-out label was read.** The rule selected
`lr_effect_freq_depmap` on out-of-fold score. On provenance grounds that model
cannot carry a headline: DepMap `CRISPRGeneEffect` *is* the Broad Avana
experiment, and Meyers 2017 is the Avana publication, which is the label side of
113 of the 124 held-out pairs. `depmap_features` drops the unit's own model so
there is no per-cell-line leak, but a breadth summary over ~1,177 other Avana
lines is the same experiment aggregated. The headline was restricted to
**`lr_effect_freq`** — screen A's own effect size plus a frequent-hitter prior
fitted only on `allowed_background_screens`, which excludes both pair screens,
both publications and every screen in the pair's cell line. It retained 89% of
the out-of-fold gain, and the amendment is recorded in `selection.json`.

**Held out, scored once** (248 units, 124 screen pairs, publication- and
cell-line-disjoint from the fit; `evaluating=True` passed by one script only):

| method | AP | P@10 | P@20 | P@50 |
|---|---:|---:|---:|---:|
| **`lr_effect_freq`** (frozen) | **0.3538** | **0.915** | 0.824 | 0.687 |
| `lr_effect_freq_depmap` (secondary) | 0.3464 | 0.669 | — | 0.621 |
| `effect_score1` (comparator) | 0.2464 | 0.696 | 0.679 | 0.606 |
| `a_hit` | 0.1334 | 0.276 | — | 0.323 |
| marginal | 0.0298 | 0.030 | — | 0.030 |

| comparison, paired by screen pair | difference, 95% interval | Wilcoxon |
|---|---|---|
| AP, all 124 pairs | **+0.1074 [+0.1020, +0.1128]** | p = 4.3e-22 |
| P@10, all 124 pairs | **+0.2190 [+0.2004, +0.2383]** | p = 5.7e-22 |
| AP, 113 hub pairs (Behan x Meyers) | +0.1109 [+0.1059, +0.1158] | p = 2.8e-20 |
| **AP, 11 non-hub pairs** | **+0.0721 [+0.0474, +0.0979]** | p = 9.8e-04 |
| P@10, 11 non-hub pairs | +0.2545 [+0.1773, +0.3364] | p = 9.8e-04 |

The non-hub stratum matters more than its size suggests: it is the only evidence
that the result is not an artefact of one library comparison, and it was declared
in advance. The clean model also *beat* the DepMap variant on held-out
(0.3538 against 0.3464), so the provenance restriction cost nothing.

**Promotion status: `research_only`.** What this establishes is a ranking claim
against screen A's own effect size on a cross-screen replication proxy. It does
not establish that a gene passes an independent biological validation assay, and
it is not a calibrated probability. See
`research/15_PROSPECTIVE_VALIDATION_PROTOCOL.md` for the design that would.

## Track B corrective experiments

Count parser, DrugZ tails/pairing, MAGeCK directional family selection, MLE dispatch, assay-specific QC and artifact flags, risk classification, failure stages and report provenance were corrected. A pooled-BH alternative passed arithmetic checks but failed an existing planted-control integration gate; it was rejected in favor of a conservative two-family union correction. Details, failed variant, exact real-data output hashes and pairing sensitivity are retained in `POSTSCREEN_IMPLEMENTATION.md`.

GSE145743 author counts ran twice under explicit paired/unpaired DrugZ assumptions. MAGeCK calls changed 39→22 under the corrected threshold. This is an error-control change, not a validated increase in biological accuracy. The highlighted gene was nonsignificant, and QC failed; both results are retained.

## Hypotheses reviewed but not presented as completed experiments

Biological foundation models, new graph/pathway channels, RDKit compound featurization, frontier API inference, calibrated validation-success prediction and adaptive laboratory acquisition were researched. Suitable time-clean inputs, independent outcomes, or justified compute/API requirements were not established. No benefit, benchmark score, implementation or calibration is invented for them. Existing graph-expansion/tree/consensus negative experiments are documented historically, but were not all independently rebuilt during this pass.

## Next justified experiments

Prioritize a genuinely blinded future cohort with laboratory-held outcomes, and an explicit supplied-library track for practical laboratories. For model development, use nested publication/experiment-grouped folds, then a locked temporal evaluation; recompute all feature transforms within folds. Investigate calibrated probability of being a hit **and measured** only as a declared assay-design model, not by querying target labels. Test historical annotation releases only after claim-level provenance and licensing checks. Many exploratory candidates were examined; all reported intervals are descriptive and no multiple-comparison-adjusted discovery claim is made.
