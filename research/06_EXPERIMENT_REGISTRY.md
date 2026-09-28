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

## Track B corrective experiments

Count parser, DrugZ tails/pairing, MAGeCK directional family selection, MLE dispatch, assay-specific QC and artifact flags, risk classification, failure stages and report provenance were corrected. A pooled-BH alternative passed arithmetic checks but failed an existing planted-control integration gate; it was rejected in favor of a conservative two-family union correction. Details, failed variant, exact real-data output hashes and pairing sensitivity are retained in `POSTSCREEN_IMPLEMENTATION.md`.

GSE145743 author counts ran twice under explicit paired/unpaired DrugZ assumptions. MAGeCK calls changed 39→22 under the corrected threshold. This is an error-control change, not a validated increase in biological accuracy. The highlighted gene was nonsignificant, and QC failed; both results are retained.

## Hypotheses reviewed but not presented as completed experiments

Biological foundation models, new graph/pathway channels, RDKit compound featurization, frontier API inference, calibrated validation-success prediction and adaptive laboratory acquisition were researched. Suitable time-clean inputs, independent outcomes, or justified compute/API requirements were not established. No benefit, benchmark score, implementation or calibration is invented for them. Existing graph-expansion/tree/consensus negative experiments are documented historically, but were not all independently rebuilt during this pass.

## Next justified experiments

Prioritize a genuinely blinded future cohort with laboratory-held outcomes, and an explicit supplied-library track for practical laboratories. For model development, use nested publication/experiment-grouped folds, then a locked temporal evaluation; recompute all feature transforms within folds. Investigate calibrated probability of being a hit **and measured** only as a declared assay-design model, not by querying target labels. Test historical annotation releases only after claim-level provenance and licensing checks. Many exploratory candidates were examined; all reported intervals are descriptive and no multiple-comparison-adjusted discovery claim is made.
