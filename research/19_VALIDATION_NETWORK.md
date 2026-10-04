# The SplicR Validation Network

**Status: built, unfitted.** Every component described here exists, is tested and
is wired through the engine, the database and the console. No calibrated
validation probability is stated anywhere in the product, because no cohort of
prospective outcomes exists yet. The system's current output is a refusal that
names what is outstanding, and that refusal is computed from the database rather
than written into a string.

Run `npm run validation:status` to see the live answer.

---

## 1. What this is for

Three questions get conflated whenever somebody says "accuracy":

| Question | Evidence SplicR has | What it supports |
|---|---|---|
| Can a system rank hits before a screen is run? | AssayBench, 334 public test screens | Nothing beyond the frontier ensemble, under publication-clustered uncertainty |
| Does a ranking predict which hits reproduce **in another screen**? | The replication benchmark, 138 pairs | A proxy for reproducibility, against screen A's own effect size |
| Does using SplicR let a lab **confirm more real hits per unit of bench effort**? | none | The commercial claim, and what this subsystem exists to earn |

`research/15_PROSPECTIVE_VALIDATION_PROTOCOL.md` specifies the study. This
document describes the machinery that study needs, which is now built.

## 2. Why four numbers and never one

A CRISPR hit can validate genetically and fail pharmacologically.

The kinome screen in African-ancestry patient-derived breast cancer organoids
([doi:10.1158/0008-5472.CAN-24-0775](https://doi.org/10.1158/0008-5472.CAN-24-0775),
PMID 39891928) is the clean worked example, and it is the reason the registry is
a registry. The authors called hits at *"a reduction of at least 50% (log2 fold
change < −1) and a p value < 0.05"*, then tested CDK2, PTK2 and PRKDC with
individual gRNAs. All three reduced organoid growth. The pharmacology then
disagreed with itself:

* **CDK2** — both lines sensitive to AUZ-454.
* **PTK2** — GSK2256098 had no effect on either line; ICSBCS007 partially
  responded to PF-573228.
* **PRKDC** — LTURM34 and AZD7648 *"did not show potent activity against the
  PDTOs at the tested concentrations in contrast to the individual gRNA
  validation results"*.

PRKDC validated and did not validate in the same paper. The only thing that
makes both statements compatible is naming the endpoint each was measured
against. A single "validation probability" would have to average them.

So SplicR estimates four separate things, each with its own cohort, calibration
and availability:

```
reproduces        an independent perturbation reproduces it, same model
target_specific   the effect survives an orthogonal perturbation of the target
cross_model       it reproduces in another model or context
pharmacologic     a selective compound recapitulates it
```

Every printed probability appears inside the sentence that names its experiment.
`engine/splicr/validation/endpoints.py::QUESTION_SENTENCE` holds the wording and
`apps/web/tests/validation-contract.test.mjs` checks the console's copy is
byte-identical to it.

## 3. What was built

```
engine/splicr/validation/
├── endpoints.py     9 versioned, hashable endpoints; what "validated" means
├── outcomes.py      the record a lab contributes, failures included
├── features.py      50 evidence channels in 7 families; missing stays missing
├── splits.py        lab / study / time splits, leakage refused not warned
├── baselines.py     FDR, effect+FDR, MAGeCK, BAGEL2, the investigator
├── models.py        hierarchical logistic + gradient-boosted trees
├── calibration.py   Platt, isotonic, beta; chosen on held-out laboratories
├── coverage.py      the out-of-domain gate — the only thing that opens
├── evaluation.py    precision@k, lift, hits per budget, McNemar, abstention
├── cohort.py        the published rank-stratified validation set
├── receipts.py      content-hashed, exclusive-create prediction commitments
├── rounds.py        draft → frozen → revealed, forwards only
├── network.py       four heads; the one call a caller makes
├── store.py         the cohort is stored; the model is derived from it
├── publish.py       promote a fit to what the console reads
└── report.py        the ladder, and the console's payload
```

Database: `supabase/migrations/20261003000100_validation_network.sql` and two
follow-ups. Console: `apps/web/src/lib/validation/`,
`apps/web/src/lib/data/validation-network.ts` (reads),
`apps/web/src/lib/data/round-actions.ts` (the round lifecycle),
`apps/web/src/components/dashboard/validation/`,
`/dashboard/validation/network`.

### 3.1 What the console surfaces

The page is the round. One line of description, then the thing you do.

| | |
|---|---|
| **Set up a round** | Inline, open on arrival. Screen, name, how to pick, budget, your own pass threshold, which strategies to compare, which endpoint. A panel beside it says what the configuration will draw and what is blocking it, updating as the controls change. |
| **Rounds** | State, what is drawn, what has come back, the stamp, and the one next step for that state: Freeze, Record results, or See results. |
| **Results** | Selected by `?round=`. Four figures, a per-strategy table with rates and intervals, the discordant comparison, and every candidate with a Record link on anything outstanding. |
| **Calibration** | Absent until a question is actually calibrated. Then one collapsed line, opening to reliability, coverage by context and the endpoint registry. |

Earlier drafts put the setup in a drawer. A drawer covered the list of rounds it
was adding to, which is the one thing you want to see while adding to it.

An earlier draft also carried a permanent line saying no calibrated probability
was available and naming the thresholds. It was true and it was on the page
every single visit, and a researcher could not act on it. It is gone. The
honesty it carried did not move into softer words, it moved to where it bites:
the coverage gate still refuses to state a probability, the pipeline's score
stage still records the named shortfall on every run, and no surface anywhere
prints a number without the cohort behind it. Those are enforced in code and by
tests rather than by a banner.

Prose across the whole page is under 120 words, asserted by a test over the
rendered markup so it cannot creep back a sentence at a time. There are no long
dashes, also asserted.

A round is drawn from a screen's recorded hits, frozen into a content-addressed
receipt, and only then revealed. Each step is refused out of order by the
server action and again by a database trigger. An outcome recorded in the Truth
Loop attaches itself to whichever frozen round drew that gene, so the researcher
never has to know which round they are answering.

## 4. The design decisions that carry the weight

### 4.1 An endpoint is written down before outcomes are collected

Each endpoint declares which question it answers, which perturbations count as
independent, how many replicates it needs, which direction the effect must take,
who owns the threshold, and which controls must pass. It is content-hashed, and
a prediction receipt pins the registry hash, so a prediction frozen under one
rule cannot later be scored as if it had been made under another.

**SplicR does not own the threshold.** `threshold_owner` is `laboratory` for
every arrayed endpoint, because the effect size that counts as a response in one
organoid assay is not the one that counts in another. The 50% / p<0.05 figures
above are carried as a *published example with its DOI*, never promoted to a
default; a database constraint (`endpoints_threshold_owner_ck`) refuses a
laboratory-owned threshold that has been fixed.

### 4.2 "Not recorded" is a third state, and it is not a failure

Scoring a record against an endpoint can return a fifth value that exists
nowhere else: `insufficient_record`. It means a criterion the endpoint requires
was not written down.

It is not `failed` (the assay did not run and come out against the hit) and not
`inconclusive` (the assay did not run and fail to decide). Collapsing it into
either would put an unmeasured experiment into a rate's numerator or
denominator, which is the single easiest way to manufacture a validation
statistic. The form expresses it as a three-state select rather than a checkbox,
because an unchecked checkbox records "no" for every form filled in a hurry.

### 4.3 The gate is the only thing that can open

`coverage.py` is the single chokepoint. A probability is available only where:

| | floor |
|---|---|
| decided outcomes in the stratum | 40 |
| laboratories in the stratum | 3 |
| primary screens in the stratum | 5 |
| decided outcomes, network-wide | 100 |
| contributing laboratories | 3 |
| held-out-laboratory evaluation | on record |
| records disagreeing with their own endpoint | ≤ 15% |

A stratum is `(question, assay class, modality, phenotype family, model type)`.
Strata fall back along a declared ladder — model type, then phenotype family,
then modality — and every fallback is reported in the cohort sentence, so a
reader can see the estimate came from a broader cohort than their experiment.

`Unavailable` has **no probability field**. A caller must handle both branches,
so no code path can render a fallback value as a measurement. `network.estimate`
consults the gate *before* asking the model, so a refused candidate has no
number in memory for a later code path to find.

A head also refuses a cohort whose frozen evidence is shaped differently from
what the pipeline writes. A fit on a wall of missing values does not fail — it
succeeds and learns nothing, and a model that learned nothing still returns a
number. The refusal names the channels it did manage to read.

### 4.4 The order of operations is the design

1. split by laboratory into train / test
2. choose a model on laboratory-grouped folds of train
3. fit it on train
4. **cross-fit the calibrator inside train** — out-of-fold scores from
   laboratory-grouped folds
5. measure on test, laboratories neither the model nor the calibrator has seen
6. count coverage per stratum
7. open the gate only where every count clears its floor

Step 4 was built twice. The first version held whole laboratories back for
calibration *as well as* the test; with seven contributing laboratories that
left 48 outcomes to calibrate on, below the 60-outcome minimum, and every head
refused. Cross-fitting is the version that is both honest and affordable.

### 4.5 Boring models first

Hierarchical logistic regression with shrunk random intercepts for lab, study
and assay, fitted by penalised IRLS with the variance components re-estimated
between rounds. An unseen laboratory contributes `u = 0` — the population
average — and the estimate reports which groups were unseen.

A gradient-boosted tree is fitted alongside and used only if it wins on held-out
laboratories. On the 389 decided `reproduces` outcomes of a 920-outcome
synthetic cohort with known structure, the linear model won on
laboratory-grouped folds by 0.070 nats of log loss (0.349 against 0.419). It also decomposes **exactly** into per-family
contributions that sum to the linear predictor, which is what lets the console
answer "why did the estimate move". The tree returns `null` there rather than a
post-hoc attribution that would look identical on screen.

### 4.6 Nothing prints as certainty

One formatter, in one place, in each language. Anything ≥ 99.5% prints `>99%`
and anything ≤ 0.5% prints `<1%`. 100% asserts an experiment cannot fail and no
finite cohort evidences that.

Separately, an estimate is **censored at the edge of its evidence**: if the
calibration cohort's highest probability was 94% and the model says 98%, the
sentence reads "At least 94%" and says why. The number is censored rather than
refused because the candidates a lab most wants a number for are exactly the
ones at the top of the range.

### 4.7 The arms overlap, and the comparison is on the disagreement

The first version of the arms deduplicated by precedence: a candidate two
strategies both picked went to whichever came first. That sounded conservative
and was broken. Two rankings that mostly agree hand every good candidate to the
first strategy and leave the second with the leftovers, so the second cannot
look anything but worse whatever the bench finds.

So the arms overlap, which is what the protocol specifies. The validation set is
the union of each strategy's top k, a candidate both picked is tested once and
counted for both, and the comparison that carries information is over the
candidates only one of them picked. That last test is an exact binomial on the
discordant confirmations, pinned against scipy.

The results page reports the per-arm rates with Wilson intervals, the difference
with a Newcombe interval, and the discordant test. It says whether the interval
clears zero, and never that one strategy is better. At a budget of twenty it
usually will not clear zero, and a test greps the rendered page for the words
that would imply otherwise.

### 4.8 The validation set is the published one

A lab that validates its five favourite candidates and sees four work has
measured the five it already liked. The fix is published, not invented:

> *"Although it is common practice to cherry-pick interesting screening hits for
> validation, this approach cannot validate the screen as a whole. For a
> representative assessment of the screening hits, some hits should be selected
> for validation solely based on their ranks — for example, the top 20 hits as
> well as 10 hits each around the 5th, 10th, 25th, 50th and 75th percentiles."*
> — [doi:10.1038/s43586-022-00098-7](https://doi.org/10.1038/s43586-022-00098-7)

`cohort.rank_stratified` implements that at its published sizes (reproducing it
exactly at genome scale) and scales it proportionally to a smaller budget,
reporting where a short candidate list forces it to differ.

On top of it, `stratified_arms` draws from each strategy's own list and
deduplicates under a fixed precedence where **SplicR is last** — a candidate the
investigator also chose is credited to the investigator, so every measured lift
is conservative.

### 4.9 The prediction is frozen before the answer exists

A receipt holds the whole candidate universe (not just the picks), every rank,
every frozen evidence vector, the model and calibrator manifests, the coverage
decision, the endpoint registry hash, the feature-spec hash and the engine
revision including whether the tree was dirty. It is written with exclusive
creation and cannot be overwritten.

There is **no outcome field**, the API has no argument for one, and the payload
is searched at any depth for a key that looks like one. `prediction_receipts`
has no update policy, no delete policy and no grant for either.

It is a content commitment, not trusted timestamping — the payload and the
database row both say so. An independent custodian has to hold the hash.

A receipt can be frozen from the console, so the serialisation exists in two
languages and must produce one hash or it is worth nothing. The engine's
`canonical_bytes` normalises numbers before serialising — a whole-valued float
becomes an integer — because Python has two numeric types and JavaScript has
one, and without it the same logical payload hashed two ways depending on which
side assembled it. A whole number past 2**53 is refused outright rather than
written as bytes only one side can reproduce. Eleven payloads chosen for exactly
the places the two serialisers differ (unicode, escapes, the solidus, floats
that round-trip, exponents, signed zero, empty containers, key order) are
generated from the engine and replayed against the console.

A round moves draft → frozen → revealed and never backwards, enforced by a
database trigger rather than by application code, because the application is not
the only thing that can write to the database. A slot cannot be added to a
frozen round. An outcome cannot be attached for a gene that is not in the frozen
set.

### 4.10 Metrics that are a claim, and one that is not

Accuracy is not reported by anything in this subsystem. If 25% of candidates
validate, saying "no" to everything is 75% accurate and has found nothing.

What is reported: precision@k with its denominator and the count of untested
slots; lift against each baseline as both a ratio and a difference; confirmed
hits per fixed budget and validations per confirmation; Brier, log loss, ECE,
calibration slope and intercept with a reliability curve whose every bin carries
its *n* and a Wilson interval; abstention coverage; and McNemar on the
discordant pairs only, because concordant candidates carry no information about
which ranking is better. Uncertainty clusters by laboratory, reusing the same
`cluster_interval` the retrospective benchmark already uses.

## 5. Three layers, one vocabulary

The enums exist in Python (the engine computes with them), SQL (the database
constrains to them) and TypeScript (the console renders them).
`apps/web/tests/validation-contract.test.mjs` parses all three files and fails
naming the term and the file when they disagree — 35 tests, Node-only, no Python
environment required.

The endpoint *decision rule* also exists twice. It is pinned by generation:
`scripts/validation/export_endpoints.py` writes the registry and a stratified
1,800-case decision matrix carrying the engine's own verdict on each, and
`apps/web/tests/endpoint-decisions.test.mjs` replays every case through the
TypeScript, comparing the verdict **and every criterion's status**.

Drift was deliberately introduced in three directions to confirm each is caught:
an endpoint rule changed in the engine only, a validation type added to the
engine only, and the certainty ceiling moved in the console only. All three
failed the suite.

## 6. Verification

| | |
|---|---|
| Engine tests | 692 pass, 2 skipped (114 for this subsystem) |
| Console tests | 561 pass, 1 skipped (93 for this subsystem) |
| End-to-end, real session and database | 36 pass (11 new) |
| Production build | passes, `/dashboard/validation/network` registered |
| Lint, typecheck | clean |
| Database advisors | no new ERROR or WARN; covering indexes added |

The published PRKDC and PTK2 cases are reproduced **through the product**, end to
end, against a real signed-in session: PRKDC's ladder shows guide
reproducibility *met* and pharmacologic evidence *not met*; PTK2's two
disagreeing inhibitors leave the pharmacologic rung *mixed*, with both outcomes
kept.

Calibration was verified against a known miscalibration: a deliberately
overconfident score with ECE 0.201 calibrated to 0.025, against an oracle floor
of 0.027 — at the limit the sample supports.

The publish path was exercised against the live schema inside a rolled-back
transaction: fit, publish unpromoted (console still claims nothing), promote
(console shows three calibrated heads and the fourth still refused), republish
idempotently, retract (claims nothing again, nothing deleted).

The round lifecycle runs end to end against a real session: a set drawn from a
screen's recorded candidates, frozen into a receipt whose hash appears in the
table, and revealed — with each step refused out of order.

## 7. What this does **not** do

Stated plainly, because an honest inventory is the point of the subsystem.

* **No prospective cohort exists.** Everything above is machinery. The study in
  `research/15_PROSPECTIVE_VALIDATION_PROTOCOL.md` has not been run and no
  number in this product rests on it.
* **No adaptive experiment selection.** The cohort builder is static. Sequential
  design — choosing which candidate to test *next* given everything learned so
  far — is a separate research program. The relevant prior art is
  [arXiv:2609.11877](https://arxiv.org/abs/2609.11877) (Genentech, AssayLoop),
  which reports 5.67× enrichment over random and 27.7% hit recovery after
  assaying ~5% of the candidate library on temporally held-out screens. That is
  evidence about their system, not about SplicR, and it is cited here as a
  design target rather than a result.
* **No lab-specific calibration layer beyond the random intercept.** The
  hierarchical model shrinks a per-laboratory intercept, which is the right
  first version; a richer per-lab adaptation needs outcomes that do not exist.
* **No literature-extracted cohort has been built.** `atlas.validation_records`
  exists for it. Published outcomes are biased toward successes and can pretrain
  or shape the schema; they cannot support the calibration claim.
* **Calibration on three of four questions was demonstrated on synthetic data
  with a known generating process.** That proves the machinery recovers a
  structure it was given. It is not biological evidence and is not presented as
  any.

## 8. What would change the product's claim

| Stage | Sentence SplicR could then write |
|---|---|
| today | "SplicR does not claim validation accuracy. It records which experiment each outcome was, freezes predictions before outcomes exist, and will state a probability when a cohort can calibrate one." |
| after a retrospective corpus | "Benchmarked retrospectively against independent follow-up experiments; prospective validation under way." |
| after a blinded multi-lab round | "In a blinded prospective evaluation across N candidate validations from K laboratories, SplicR's top-ranked candidates validated in X% of follow-ups against Y% for FDR-only selection." |
| after calibration clears the gate | "SplicR reports assay-specific validation likelihoods calibrated on independent laboratory outcomes." |

The gate moves the product from the first row to the last automatically, as the
counts clear their floors. Nothing in the console has to be edited for a
probability to start appearing, and nothing can be edited to make one appear
early.
