# Final results and implementation status

Date: 2026-09-27. **Substantial reliability, reproducibility and product corrections were implemented. A new benchmark leader, perfect accuracy, and prospective generalization were not demonstrated.** No underperforming new predictor was promoted as a production improvement.

## Measured prediction results

| Comparison / input contract | Original or comparator | Final measured candidate | Absolute difference | Relative difference | Conclusion |
|---|---:|---:|---:|---:|---|
| Original SplicR phenotype prior, train+validation and supplied measured library | Reported ~0.136 | Reproduced 0.136052 | Reproduction, not improvement | Not applicable | Eight tie seeds, official evaluator |
| Existing archived library-aware router vs equally processed ensemble | 0.219324 | 0.219952 | +0.000627 | +0.29% | Pre-existing result, reproduced; no significant advantage |
| New metadata-only router vs unchanged published ensemble | 0.163091 | 0.160369 | −0.002722 | −1.67% | No improvement; not promoted |
| New metadata-only text ridge vs same-input global prior | 0.050953 | 0.052459 | +0.001507 | +2.96% | Small, statistically unresolved gain; not promoted |

The new router's paired **publication** bootstrap interval is **[−0.015581, +0.006268]**. The ridge interval is **[−0.001993, +0.005019]**. The archived library-aware comparison has only the historical **screen** bootstrap interval **[−0.008032, +0.008718]** from its replay script. None establishes superiority. Do not turn AnDCG into a percentage of biological accuracy.

The six supplied reference scores reproduce directly: oracle 0.291784, ensemble 0.163091, Gemini 3 Pro 0.156991, GPT-5.4 0.146976, phenotype frequency 0.133440 and embedding kNN 0.064600. The oracle reads target answers and is not a deployable model or universal ceiling. See [exact reproduction](05_BENCHMARK_REPRODUCTION.md).

Dataset: official AssayBench `biogrid/yearfold0`, cached revision `bc37bf8f4842b43abcd6e9f781423d478b9aee4b`, 1,349/218/334 screens. Installed official metric version 0.2.0 is byte-identical to the metric file in the checked-out official revision `640c68be02700efb5e032b6cea5c356e05c21051`. Data, metric, prediction and source hashes are retained with artifacts.

## What changed

### Prediction and research infrastructure

- Added typed metadata-only historical ranking, measured-gene denominators, publication exclusion/weighting, signed evidence, conditional shrinkage and optional TF–IDF transfer.
- Added regularized text residual regression and transparent phenotype routing as independently tested research candidates. Negative results remain recorded.
- Added strict complete-cohort official evaluation, secondary diagnostics, per-screen exports, publication-cluster paired intervals, fixed selection/replay manifests and a split/duplicate/novel-context audit.
- Fixed portable snapshot paths and made the AssayBench iterator genuinely stream bounded batches. Missing fold columns now fail instead of silently loading all rows.
- Made missing predictions fail by default in both evaluation helpers; partial scoring needs explicit opt-in.
- Added a local prediction CLI with evidence counts, input/code hashes and null validation probability, plus exclusive-create prospective prediction receipts.
- Independently refit the frozen ridge model and regenerated **all 334 rankings identically**. This proves deterministic replay in this environment, not biological correctness.

### Observed screen analysis

- Reject malformed, missing, negative, nonfinite and fractional counts instead of turning them into zeros or truncated observations.
- Preserve both MAGeCK directional statistics and conservatively control selection across their two families. Native values stay inspectable.
- Correct DrugZ's FDR tail and exact-zero handling; require explicit biological pairing instead of inferring it from array order.
- Execute requested MLE with an explicit design/coefficient, rather than silently ignoring the request.
- Restrict essentiality checks and DNA-cutting toxicity warnings to appropriate experiment/modality contexts.
- Treat critical artifact warnings as uncertainty rather than proof that a dependency is false.
- Report count-only mapping rate and sequenced read count as unknown; preserve observed count totals and data-source fields.
- Record the actual failing pipeline stage and write portable post-screen evidence reports without inventing calibrated confidence.

The real GSE145743 processed-count audit ran MAGeCK and DrugZ on **123,411 guide rows**. Correcting the two-family threshold changed q<0.1 discoveries **39→22**. This is a statistical interpretation change, not evidence of higher validation precision. CHD1L was nonsignificant in this analysis and QC failed; those limitations are prominently retained. [Detailed audit and rejected alternative](POSTSCREEN_IMPLEMENTATION.md).

A separate raw sequencing replay processed **26,336,701 reads from four actual FASTQ files**, comparing 65,383 guides per sample against the authors' normalized counts. Spearman correlations were **0.9289–0.9548**, median CPM ratios **0.9691–0.9763**, and **84.01–89.49%** of guides were within 25%. This is substantial, imperfect agreement on one study; it does not establish universal accuracy. The A+B author table and library A FASTQs require the documented CPM comparison. Results, input hashes and logs are retained in `artifacts/raw_count_*`.

### Product truthfulness and data isolation

- Real workspace screen details now query actual authenticated organization/run records and show recorded effects, FDR, guide evidence, flags and provenance.
- Demo data require explicit demo context; real sessions receive records, honest empty states or an unavailable state.
- Unsupported available-calibration, automatic-retraining, power, MCP and uniform Atlas reanalysis claims were corrected in source. Earlier benchmark values are labeled by their actual library inputs and archived status.
- Existing application schema/reference data and historical experiments remain intact. No production database write, destructive migration, API spending or deployment was performed.

The repository's **public console disable gate remains enabled**. Source implementation and a successful production build do not mean the live console is available or these changes are deployed. Connected uploading, workspace report export, complete outcome entry and prospective calibration are still outstanding where documented in the audit.

## Test evidence from the original research checkpoint

The subsequent [website consistency update](12_WEBSITE_CONSISTENCY.md) records the expanded 56-test frontend suite, browser checks, corrected API precision and public Evidence page. The results below preserve the original checkpoint.

- **197 Python tests passed**, with the installed toolchain on PATH and no skips.
- **39 frontend tests passed**, no failures or skips.
- TypeScript check, full ESLint and webpack production build passed.
- Frozen-model determinism check regenerated every one of 334 test rankings identically.
- Actual MAGeCK/BAGEL2 tool execution and the separate real published MAGeCK/DrugZ audits completed; biological limitations are stated above.

Final command results are recorded under `artifacts/` and summarized in [verification.json](artifacts/verification.json). The final Python suite includes unit, boundary, integration and real-reference checks. Separate frontend tests exercise unauthorized/cross-org behavior, real versus demo data paths, unavailable versus empty states, and server rendering with exact recorded numeric values. TypeScript, ESLint and the webpack production build are checked after the frontend changes.

The default Turbopack build failed with an environment subprocess-port `EPERM`; the documented webpack build passed. That failure is retained rather than described as a universal clean default build. Browser/live-database tenant testing and clean Linux environment recreation were not performed. Synthetic fixtures prove software invariants only; they are not reported as measured biology.

## Runtime, cost and resources

The new historical corpus fit took approximately **12.6 seconds** in the final residual replay. Fitting the selected ridge component took **0.81 seconds**, and generating 334 rankings took **1.39 seconds** (~4.2 ms per screen), excluding evaluation and data loading. Baseline prediction took ~0.51 seconds for the same cohort. Timings are single observed runs on this 16 GB local machine, not service latency guarantees; peak memory was not instrumented.

Published expert rankings were replayed from existing files with **no new paid model API calls**. Their original inference price, current model availability and live end-to-end latency are not reproduced by a cache replay. Real paired/unpaired post-screen audits took approximately 15.5/14.6 seconds on the processed count file. Large references and tool tables remain local/ignored; compact results, configurations and provenance are retained.

## What proves generalization?

**Nothing here establishes independent prospective generalization.** Validation-selected models were frozen before this session's final test replays, but the public test had already been explored in historical work. The measured training/validation/test shift and subgroup failures argue against broad performance claims. Exact duplicate checks found no cross-split label/publication matches, but cannot rule out every shared experiment, text clue or pretraining exposure.

No adequate independent validation-outcome dataset was established. Consequently there is no empirical basis here for a validation-success percentage, calibration chart, Brier score, laboratory ROI claim, or adaptive acquisition benefit. Public LaTest data are also already exposed. Those values have not been invented.

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

## Outstanding blockers and next experiments

1. **Independent biological outcomes:** a laboratory/custodian must supply a blinded, consented future cohort, with predictions and assay success criteria frozen before reveal. The receipt interface supports this; it does not create the cohort.
2. **Experiment independence:** resolve shared accessions, technical replicates, derivatives and alternate processing beyond publication-ID/exact-label matching. Use nested study/experiment folds for further model selection.
3. **Historical external evidence:** version/date/license every annotation claim before testing pathways, cell dependencies or foundation-model representations in a strict historical simulation.
4. **Practical supplied-library evaluation:** compare every model under identical supplied-library inputs and a separate description-only contract. Do not silently gain score by target-aware filtering/backfill.
5. **Product operations:** complete actual upload/worker/report/outcome integration, then test with a private development workspace before changing the public console gate or deploying.
6. **Post-screen generalization:** compare applicable established tools across multiple independent real experiments with prespecified contrasts, controls and validation endpoints. A single published case and planted-control tests cannot establish a superior scientific method.

The useful result of this work is a more honest, testable platform and a reproducible record of what failed as well as what worked. The requested claims of “best across all benchmarks,” “100% accurate,” and “no errors whatsoever” remain unsupported and should not be published.
