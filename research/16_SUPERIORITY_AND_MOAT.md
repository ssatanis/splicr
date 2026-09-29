# Where SplicR's superiority actually is, and what defends it

Written 2026-09-28, after the held-out replication measurement. Every number
here traces to an artifact under `research/artifacts/20260928/`. Nothing in this
file is a marketing claim that the evidence does not carry.

## 1. The reframe that matters

For three sessions this project tried to win at AssayBench: rank a screen's hits
**from its description, before anyone runs it**. It does not win there, and the
reason is structural rather than a modelling failure. That task rewards recalling
which genes the literature already associates with a phenotype, which is what
frontier language models are best at and what a screen atlas is worst at. The
honest record is in `research/06_EXPERIMENT_REGISTRY.md`: experiments C, D, E and
F/L all fail to beat the published ensemble by a margin that survives
publication-clustered uncertainty.

The commercial question is the opposite one, and it was sitting in the repository
the whole time:

> A lab has run its screen. It has 300 candidates and budget to validate 10.
> Which 10?

That is `docs/07-replication-benchmark.md` — 138 screen pairs from different
publications, first authors and libraries, in the same cell line, unperturbed
proliferation, with the pairing rule mechanical and the pair set provably built
without reading the agreement between the two sides.

## 2. What was measured

Held-out split, **scored once**, model frozen beforehand, 124 screen pairs that
share no publication and no cell line with anything used to fit it.

| ranking | average precision | precision@10 | precision@20 | precision@50 |
|---|---:|---:|---:|---:|
| **SplicR `lr_effect_freq`** | **0.3538** | **0.915** | 0.824 | 0.687 |
| the screen's own effect size | 0.2464 | 0.696 | 0.679 | 0.606 |
| the screen's own hit call | 0.1334 | 0.276 | — | 0.323 |
| chance | 0.0298 | 0.030 | — | 0.030 |

| comparison, paired and resampled by screen pair | difference | Wilcoxon |
|---|---|---|
| average precision, all 124 pairs | **+0.1074 [+0.1020, +0.1128]** | 4.3e-22 |
| precision@10, all 124 pairs | **+0.2190 [+0.2004, +0.2383]** | 5.7e-22 |
| average precision, 113 hub pairs | +0.1109 [+0.1059, +0.1158] | 2.8e-20 |
| **average precision, 11 non-hub pairs** | **+0.0721 [+0.0474, +0.0979]** | 9.8e-04 |
| precision@10, 11 non-hub pairs | +0.2545 [+0.1773, +0.3364] | 9.8e-04 |

In the units a lab buys in: **at a 10-candidate validation budget, 9.2 of 10
reproduce in an independent screen instead of 7.0 of 10.**

Decomposed for a prospective study: at *k* = 10 the two rankings disagree about
**6.6 of the 10** candidates, and among exactly those, SplicR's picks reproduce at
**0.898** against the comparator's **0.585** — about **two extra confirmed
candidates per screen** for six extra validations.

## 3. Why this survives the obvious attacks

Each of these was run, not argued.

**"You picked the model on the test set."** The model was chosen by
leave-one-publication-out cross-validation inside development, nine folds, before
any held-out label was read. Out-of-fold and in-sample agreed to 0.001, so the
two-feature logistic is not fitting 14 pairs. `selection.json` is hashed and the
held-out runner refuses to proceed if that hash changed.

**"Your best feature is DepMap, and DepMap is the Broad experiment."** Correct,
and that is why the headline does not use it. DepMap `CRISPRGeneEffect` *is* Broad
Avana, and Meyers 2017 is the Avana publication — the label side of 113 of the 124
held-out pairs. The selection rule had picked `lr_effect_freq_depmap`; it was
amended on provenance grounds to the DepMap-free `lr_effect_freq` **before**
held-out was touched, retaining 89% of the out-of-fold gain. On held-out the clean
model then scored *higher* (0.3538 against 0.3464). The restriction cost nothing.

**"You are just recovering genes that are essential in every cell line."** The
primary space already excludes CEGv2 ∪ CRISPRInferredCommonEssentials. Removing a
*second*, different list — DepMap's AchillesCommonEssentialControls — as well
moves the gain from +0.1074 to **+0.1018 [+0.0969, +0.1065]**, retaining 95%. The
advantage is not textbook essentiality.

**"The frequency prior saw the answer."** `allowed_background_screens` removes
both pair screens, both publications and every screen in the pair's cell line.
Because it excludes by publication, every Behan screen and every Meyers screen is
absent from the background of every hub unit. Asserted over all 248 units in
`replication_verify.py`; passes.

**"Your own code computed your own result."** The headline was re-aggregated by an
independently written cluster bootstrap over the saved per-unit rows. It
reproduces the runner to six decimal places on all three metrics.

**"It only works on one library comparison."** This is the benchmark's real
weakness and the docs say so first: 113 of 124 held-out pairs are Behan 2019
against Meyers 2017. The stratification was declared in advance, and the 11
non-hub pairs independently clear zero (+0.0721 [+0.0474, +0.0979]). Eleven pairs
is not many. It is the honest evidence that exists.

## 4. What this is not

- It is **not** proof that a gene passes a wet-lab validation assay. Cross-screen
  agreement is a proxy. B's hit call is a threshold under B's significance
  criteria, and a true effect can fail to replicate because B's threshold was
  stricter.
- It is **not** a calibrated probability. SplicR must not tell a scientist a gene
  has an 87% chance of validating; no admissible outcome cohort exists to
  calibrate against, and `research/evidence_contract.json` records
  `independent_validation_probability: null` with the gate enforcing it.
- It is **not** established for drug-modifier, host-pathogen or reporter screens.
  The benchmark is unperturbed proliferation, deliberately, because that is the
  one phenotype ORCS's vocabulary pins down well enough to pair.
- It is **retrospective**. The screens are published; literature memorisation by
  any component is not ruled out.

`research/15_PROSPECTIVE_VALIDATION_PROTOCOL.md` is the design that would convert
this into a prospective claim, sized from these measurements.

## 5. The moat, honestly assessed

A benchmark number is not a moat; anyone can fit a logistic regression. Four
things here are harder to copy, in increasing order of durability.

**The benchmark itself.** A leakage-controlled, publication-disjoint,
cell-line-disjoint cross-screen reproducibility benchmark built from ORCS, with a
mechanical pairing funnel, a test proving the pair set was constructed without
reading agreement, and a documented list of its own weaknesses. Nobody else has
published one. It is also the artifact that makes every future claim cheap to
defend — and it took the hard judgement calls (excluding 136 phenotype-matched
pairs that would have flattered the numbers) that a competitor in a hurry will not
make.

**The task distinction.** Most of this field reports pre-screen prediction numbers
because a public benchmark exists for them. SplicR can show, with measurements on
both, that pre-screen prediction is literature recall and post-screen
prioritisation is the product. That is a positioning nobody else has earned the
right to state.

**The verification apparatus.** A publication contract with hashed pins, an
experiment registry with exclusive-creation receipts, gates that refuse to publish
a number that drifts from its source artifact, and a documented history of
refusing to weaken a check to get a green run. For a scientific buyer — and for a
partner lab deciding whether to run the prospective study — this is the difference
between a vendor and a collaborator.

**The outcome flywheel, which does not exist yet.** Every validation outcome a
customer logs is a labelled example of the thing no public dataset contains:
whether a specific candidate, from a specific screen, confirmed in a specific
assay. That is the only durable moat in this space, and the retrospective work
above is what earns the right to ask for the first ones.

## 6. What to do next, in order

1. **Get the prospective study started.** The protocol is written and sized. One
   partner lab that is neither Sanger nor Broad, running proliferation screens in
   cell lines those two already cover, simultaneously serves the study and repairs
   the benchmark's biggest structural weakness.
2. **Ship the reliability score in the product**, labelled as a ranking and not a
   probability, with its evidence visible per candidate.
3. **Instrument outcome capture** from day one, with provenance and consent, so
   the flywheel starts turning before there is anything to train on.
4. **Extend the registration gate to post-screen claims.** The current
   `validateExperiment` is pre-screen only: it requires `task ==
   pre_screen_prediction` and per-screen rows keyed by `dataset_name`. The
   replication result does not fit it and was deliberately *not* forced through
   it. That is a real gap and it should be closed properly rather than by
   loosening the existing validator.
