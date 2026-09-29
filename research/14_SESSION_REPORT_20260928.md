# Session report — 2026-09-28

Two things happened in this session: the completed experiments D and E were
published through the evidence contract, and a new experiment family (F/L) was
preregistered, run and registered. **No model was promoted, no public-test
number changed, and no superiority was established.**

## 1. Published: experiments D and E

Authorized by the repository owner. Contract moved
`20260927-retrospective-checkpoint` → **`20260928-research-addendum`**, retaining
the superseded snapshot's identity and both public hashes under
`previous_snapshot`.

| | Experiment D | Experiment E |
|---|---|---|
| Selected model | `E2_history_lambdarank` | `P0_baseline_D3` (the baseline) |
| 2021 validation AnDCG@100 | 0.180985 | 0.099450 |
| Comparison | vs published ensemble 0.186437 | vs its own unconditioned baseline |
| Paired difference | **−0.005452 [−0.016147, +0.010805]** | **−0.007931 [−0.023172, +0.004531]** |
| Status | `research_only` | `research_only` |

Every figure was re-derived from the original per-screen files rather than
copied from the runner summaries (`artifacts/20260928/publication/verify_de.py`).
An independently written publication-cluster bootstrap reproduced D's recorded
interval to the last digit. Both experiments are registered through
`publish_evidence.py --register-experiment`, whose gate independently checks
cohort completeness, publication coverage, per-screen metric validity,
mean-recomputes-from-screens and prediction coverage.

The published values are **derived, not typed**: the publisher reads them from
the registered descriptors and the gate re-derives them, so a website number
cannot drift from the artifact it claims to come from.

## 2. New: experiment family F/L

Experiments D and E both *replaced* the ranking and both lost. This family asked
a narrower question — can a historical correction be **added** to a frontier base
without destroying it? — and every candidate was built so a degenerate setting
reproduces its own baseline exactly, which the regression tests assert.

A structural constraint shaped the design: the published `LLM RRF Ensemble` file
has **no training-split predictions**, so nothing can be fitted on top of it. The
reconstructible base is reciprocal-rank fusion over the five expert files.

Out-of-fold over three publication-grouped training folds, the residual is a real
effect — `F4_residual_200` at **+0.016859 [+0.004402, +0.028107]** against the
base, with four of six intervals excluding zero and the gain monotone in lambda.
Those folds are 70% fitness screens.

Scored once on the 2021 validation split:

| system | validation AnDCG@100 |
|---|---:|
| Published frontier ensemble | 0.186437 |
| **`F4_residual_200`** | **0.188284** |
| `F0_base_rrf60` (its own base) | 0.179685 |

| comparison | paired difference, 95% publication interval |
|---|---|
| `F4_residual_200` vs published ensemble | **+0.001846 [−0.014302, +0.030611]** |
| `F4_residual_200` vs its own base | +0.008599 [−0.003738, +0.036687] |
| `F0_base_rrf60` vs published ensemble | −0.006752 [−0.017570, −0.001032] |

**No superiority is established.** Both candidate intervals contain zero. With 34
publications and a selection multiplicity of 7, a +0.0018 point difference is far
inside the noise, and a validation split is development data, not a held-out
test.

What is worth keeping is narrower and still real: this is the first candidate in
this project whose validation point estimate exceeds the published ensemble; the
direction of the out-of-fold gain over its own base replicated on validation
(+0.0086 against +0.0169); and the base it corrects is *significantly worse* than
the ensemble, so the residual moved it across that line rather than starting
above it. That is a reason to run the hypothesis again properly, not a result.

Against the aggregation branch: `L1`'s fitted expert weights were unstable across
folds — `[1.5,1.5,1.0,1.5,1.0]`, `[1.0,1.0,0.25,1.0,0.0]`, `[1.0,0.5,0.25,1.0,0.5]`
— so its out-of-fold gain is not attributable to a reproducible weighting.

An independent cross-check fell out of the run: `F0_base_rrf60` scores
`0.3086595480710533` on fold 2 and `0.17968473979647556` on validation, matching
experiment D's separately implemented `C0_rrf60` on both to every printed digit.

## 3. Hypotheses assessed and not run, with reasons

Not every item in the requested family was worth the compute, and saying why is
more useful than a shallow pass at each.

- **G, biologically conditioned donor retrieval.** Deprioritised on existing
  measured evidence in this repository. `engine/analysis/assaybench_fusion`
  establishes that the best-transferring donor is effectively unidentifiable
  (median rank 815 of 1567 under the sharpest label-free similarity available
  here; it shares the query's compound 1% of the time on drug screens), and that
  a *perfect* donor-similarity function caps multi-donor transfer near the
  single-donor oracle. Retrieval has bounded upside.
- **H, masked screen–gene learning.** Partly already run: `E3_history_coverage`
  in experiment D multiplies a measurement-propensity model into the score and
  did not gain (0.305 against 0.306 for the same model without it).
- **I, contrastive learning on matched opposite-direction screens.** Only 47
  matched pairs exist across five publications — enough to test a parser, which
  experiment E did, not to train a representation.
- **K, versioned pathway and dependency evidence.** Blocked on provenance, not on
  compute: the local STRING, Reactome, Open Targets and DepMap releases are
  current, and using them in a through-2020 historical simulation needs
  claim-level date auditing that has not been done.

## 4. Verification actually executed

| check | result |
|---|---|
| `pytest engine/tests` | **290 passed, 2 skipped**, identical across **three independent runs** (166.50s / 161.39s / 188.92s). 282 before; 8 new F/L invariant tests |
| `npm run test:web` | **91 passed, 0 failed** (81 before; 10 new addendum agreement tests) |
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm run build -w apps/web -- --webpack` | pass |
| `npm run evidence:check` | `20260928-research-addendum` verified |
| evidence regeneration | **idempotent** — byte-identical on a second run |
| deterministic replay | 3 replays × 10 models, identical mean and score hash every time |
| browser verification | 7 marketing routes × {390, 768, 1440} px — zero horizontal overflow, zero console errors, unique per-route titles |
| evidence downloads | 8/8 return 200; served bytes hash-match the local files |

## 5. Limitations

- Both D/E and F/L are measured on the **2021 validation split**, which is
  development data. They are not public-test results and must not be compared
  with the 334-screen table.
- The public test was explored historically by this repository. It is not an
  untouched prospective cohort, and no amount of re-running changes that.
- The expert predictions come from models whose training data includes the
  publications behind these screens. Memorization risk is recorded in every
  descriptor's provenance and is not resolved.
- No prospective cohort exists, so no calibrated probability that a hit survives
  independent validation is available, and none is published.
- F/L was selected among 7 configurations; its cross-validation estimate is not
  unbiased.
