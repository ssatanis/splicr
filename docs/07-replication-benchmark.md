# The replication benchmark

SplicR's product claim is: given a screen's data, which of its hits are real.
Nobody benchmarks that, because there is no public dataset recording which hits
later validated. This is the closest honest proxy, built from data already in
the repository.

**The task.** Given only screen A's own measurements, rank A's gene space by the
probability that the gene is also called a hit in screen B, an independent
screen of the same phenotype in the same cell line by a different lab with a
different library. B's hit calls are the label and a predictor never sees them.

If two labs screen the same thing independently and a gene hits in both, it is
far more likely to be real than one that hits in only one. So this is the
benchmark where being right about artifacts, guide agreement, effect size and QC
should pay, and where a literature-recall method has nothing to recall.

```bash
export PATH="engine/.tools/env/bin:$PATH"
python -m splicr.replication.dataset build    # rebuild the artifact
python -m pytest engine/tests/test_replication_benchmark.py
```

| | |
|---|---|
| Source | BioGRID ORCS 2.0.18, human, 1,953 screens in the archive |
| Safe under the AssayBench boundary | 1,574 |
| Eligible screens | 795 |
| Screen pairs | 138 |
| Evaluation units (ordered pairs) | 276 |
| Development / held out | 14 pairs, 9 publications / 124 pairs, 5 publications |
| Primary metric | average precision over non-common-essential genes |
| Loader | `engine/splicr/replication/dataset.py` |
| Artifact | `engine/splicr/replication/_pairs_v1.json` |

## Why the pairing rule is what it is

This is the decision the benchmark will be attacked on, so every condition is
mechanical, applied to metadata BioGRID ships, and recorded in the built
artifact as a funnel. Two screens form a pair only if all of the following hold.

**Different publication, and different first author.** One paper's two screens
are one experiment. Two papers with the same first author are one lab, so they
are not independent labs. First author is a proxy for lab, and an imperfect one;
see the objections.

**Different library.** This is the condition that gives the label its meaning.
Two screens using the same library share guide sequences, so a seed effect or an
off-target artifact of a particular guide would replicate. Requiring different
libraries means guide-level artifacts do *not* replicate, so failure to
replicate is evidence about the hit rather than about the shared reagent.

**Same library type.** A CRISPRa hit and a CRISPRn hit are not the same claim.

**Same cell line**, under a deliberately strict key: lowercase, alphanumerics
only. It merges `HEK293T` with `HEK-293T` and keeps `HEK293T`, `HEK293` and
`HEK293-A` apart, and `HeLa` apart from `HeLa S3`. A dependency that is real in
one line and absent in another is biology, not a failure to replicate, so
allowing different lines would silently change what the label means. Missing a
true match costs one pair; inventing one corrupts the label, so the key errs
toward missing matches.

**Unperturbed proliferation only.** `PHENOTYPE = "cell proliferation"`,
`EXPERIMENTAL_SETUP = "Timecourse"`, `CONDITION_NAME = "-"`,
`SCREEN_TYPE = "Negative Selection"`. This is the one judgement in the
construction that is not purely mechanical, and it is the single largest
reduction in the funnel.

The ORCS `PHENOTYPE` vocabulary is too coarse outside proliferation to establish
that two screens measure the same thing. Five HEK293T screens all carry
`protein/peptide accumulation` while, per their own `NOTES`, reading out
GFP-PARKIN levels (screen 182), ERAD of a GFP-CYP51A1TM substrate (1461),
autophagy deficiency (1618), the GFP-LC3-RFP autophagic flux reporter (1686) and
readthrough translation of an AMD1 reporter (2134). Screen 182 pairs with all
four of the others under every other condition above.

Relaxing to a `PHENOTYPE` match alone, with every other rule unchanged, admits
136 further pairs: 101 `response to chemicals`, 29 `protein/peptide
accumulation`, 6 `response to virus`. Those pairs match on phenotype while
comparing different perturbations: GSK983 against formaldehyde, resveratrol
against ONC201, cisplatin against olaparib, SARS-CoV-2 against influenza A.
Non-replication in such a pair means the two labs did different experiments, not
that a hit was an artifact. Run `dataset.excluded_phenotype_audit()` to
re-derive that list with each side's condition and notes.

A handful of those pairs would survive a careful reading of the notes. Keeping
them would mean hand-picking pairs after seeing them, which is the "you chose
the pairs" objection in its purest form, so none are kept.

### The funnel

Eligibility, from the 1,574 safe screens:

| Filter | Surviving |
|---|---|
| E0 safe human ORCS screens | 1,574 |
| E1 high throughput | 1,567 |
| E2 pooled | 1,553 |
| E3 genome-scale background reported | 1,355 |
| E4 at least 10,000 genes measured | 1,143 |
| E5 at least 10 hits, hit fraction at most 0.20 | 1,088 |
| E6 phenotype is cell proliferation | 871 |
| E7 setup is timecourse | 853 |
| E8 unperturbed | 825 |
| E9 negative selection | 795 |

Pairing, over the 315,615 pairs of eligible screens:

| Filter | Surviving |
|---|---|
| P1 different publication | 204,359 |
| P2 different first author | 204,296 |
| P3 same library type | 202,710 |
| P4 different library | 201,037 |
| P5 same cell line | 181 |

Then the overlap and power guards, and the split:

| Filter | Surviving |
|---|---|
| O1 at least 10,000 shared genes | 181 |
| O2 shared space covers at least 60% of each side | 181 |
| O3 at least 50 hits per side, full space | 181 |
| O4 at least 50 hits per side, primary space | 175 |
| dropped for crossing the publication split | 37 |
| **pairs in the benchmark** | **138** |

The cell-line condition is doing nearly all the work, which is expected: most
pairs of proliferation screens are in different lines.

## Which thresholds are real choices

Most of these are guards that never bind, and saying which is which matters more
than the numbers.

`MIN_SHARED_GENES = 10,000` and `MIN_SHARED_COVERAGE = 0.60` never bind. The
smallest shared space among the 181 candidates is 16,220 genes and the lowest
per-side coverage is 0.862. They exist so a future ORCS release cannot quietly
introduce a badly overlapping pair.

`MIN_MEASURED_GENES = 10,000` sits in a sparse band rather than an empty one.
Among the 1,355 full-background pooled screens, 207 measure at most 3,000 genes,
1,141 measure at least 14,500, and 7 fall between: one at 4,568, four at 7,111,
and two at 11,465 and 11,466. At 10,000 the first five are excluded and the last
two admitted. None of the seven is eligible on other grounds, so the cut does
not change the benchmark, but the band is empty of *pairable* screens rather
than empty of screens, and the earlier draft of this spec claimed the stronger
thing.

`MAX_HIT_FRACTION = 0.20` and `MIN_HITS = 10`. Over the 1,143 full-background
screens with at least 10,000 genes the hit fraction has median 0.0862 and
standard deviation 0.0449, so 0.20 sits 2.5 standard deviations above the median.
It excludes 5 screens; `MIN_HITS` excludes 50.

`REQUIRE_FULL_BACKGROUND` uses the ORCS `FULL_SIZE_AVAILABLE` flag, which is
exact here: all 134 safe screens with `SIGNIFICANCE_INDICATOR = "All
Significant"` have the flag set to `No` and a measured hit fraction of exactly
1.000, while the 1,372 screens with the flag set to `Yes` have a median hit
fraction of 0.0823. A hit-list-only deposit cannot serve as either side, because
its non-hits are absent rather than negative.

`MIN_SHARED_HITS = 50` is enforced on both gene spaces. On the full space it
never binds, since the weakest side of any candidate has 61 hits. On the primary
space it removes 6 of the 181 candidates, whose weaker side calls only 15, 29,
30, 30, 32 and 15 non-common-essential hits. Average precision over 15 positives
is not a measurement.

### Which label-derived quantities may gate a pair

`MIN_SHARED_HITS` reads each side's own marginal hit count, which is
unavoidable: a ranking task with no positives cannot be scored. It must never
read the *agreement* between the two sides, because agreement is exactly what
the benchmark measures, and selecting pairs on it would manufacture the result.
No filter in the module touches `n_both`. The test
`test_pair_set_is_reproducible_without_reading_agreement` rebuilds the surviving
pair set from quantities that exclude `n_both` and asserts the shipped set is
contained in it.

## One row per gene

The parsed ORCS cache is one row per ORCS record, and ORCS records are not
unique per gene within a screen. Of the 1,574 safe screens, 1,213 carry at least
one repeated gene; 23,557 (screen, gene) groups have more than one row; and the
repeats share the same `ENTREZ_GENE` id, so they are repeated measurements of
one gene and not two genes sharing a symbol. Screen 930 reports NAA38 twice,
once `HIT=YES` with `SCORE.1` 3.495 and once `HIT=NO` with `SCORE.1` -0.719.

Left alone this breaks the benchmark three ways. The shared gene space is
counted in rows rather than genes, so it is overstated. A repeated gene
contributes several times to every hit count and to average precision, so it is
silently upweighted. Worst, joining inputs to labels on `gene`, the obvious
thing for a caller to do, is a many-to-many join that inflates both sides: for
pair 420/930 it turns 17,151 genes into 17,208 rows. That trap caught the first
verification pass of this benchmark.

So every read goes through one deduplicating query and the gene key is unique by
construction. Where the repeated rows agree on `HIT`, they collapse and `SCORE.1`
is averaged. Where they disagree, the gene is dropped from that screen: 1,290 of
the 23,557 groups contradict themselves, and for those the screen asserts both
that the gene is a hit and that it is not, so on the A side we cannot say what A
claimed and on the B side the label is undefined. Dropping is the neutral
choice; taking the OR would manufacture hits and bias every measured replication
rate upward, which is the direction that flatters the benchmark. The cost is
1,290 gene-screen observations out of 21,453,742.

## The split

Development and held out are disjoint **by publication**, not by pair, so no
publication appears on both sides. The rule, fixed before any result was looked
at: hold out the two publications appearing in the most pairs, plus every
publication that pairs only with those two; everything else is development;
pairs whose two publications land on opposite sides are dropped. That costs 37
pairs.

The publication graph is one connected component and is hub-dominated. Behan
2019 and Meyers 2017 appear in 143 and 131 of the 175 surviving candidate pairs
and mostly in pairs with each other, so no publication-disjoint partition is both
balanced and large. The best balanced partition, found by exhaustive search over
all assignments of the publications, keeps only 45 pairs, 23 development against
22 held out, and discards 130. This rule keeps 138.

It puts the large homogeneous block on the evaluation side and the small
heterogeneous tail on development, which is the direction that makes tuning
harder rather than easier: anything tuned on development is tuned against a
mixture of 9 publications, libraries and significance thresholds, then has to
work on a block it has never seen. `dataset.balanced_split()` returns the
balanced partition too, because a claim that holds only on the large block
should be reported that way.

The split also turns out to be **cell-line disjoint**: the 9 development cell
lines and the 124 held-out cell lines do not intersect. That is not required by
the rule but it closes a second leak channel, and
`test_split_is_also_cell_line_disjoint` will fail if a future build loses it.

Held out is dominated by one comparison: 113 of its 124 pairs are Behan 2019
(Sanger, KY library) against Meyers 2017 (Broad, Avana), in 113 different cell
lines. See the objections.

## Leakage

B's hit calls are the answer, so three channels are closed structurally rather
than by convention.

1. `load_pair_inputs` selects no column of the target screen, so the frame
   handed to a predictor cannot contain the label. It returns `gene`, `a_hit`,
   `a_score1` and `is_common_essential`, and a test asserts exactly that set.
2. `load_pair_labels` raises `PermissionError` on a held-out unit unless the
   caller passes `evaluating=True`. That is a tripwire, not a security boundary:
   a tuning loop that reaches for held-out labels fails instead of quietly
   succeeding, and any call that does pass the flag is visible in a diff.
3. `allowed_background_screens(unit)` is the only sanctioned screen set for
   fitting anything not specific to the pair. It removes both pair screens,
   every screen from either publication, since a same-paper sibling is a
   technical replicate of the label, and every screen in the pair's cell line
   from any publication, since another lab's fitness screen of the same line is
   a third measurement of the same quantity. A frequency prior, co-essentiality
   graph or neighbour set fitted over the screens it returns, between 130 and 786
   of them depending on how well covered the pair's cell line is, cannot contain
   B.

`forbidden_external(unit)` names what is off limits outside ORCS. DepMap
`CRISPRGeneEffect` and `CRISPRGeneDependency` *are* the Broad Avana experiment.
130 of the 133 cell lines here are DepMap models and 270 of the 276 units
resolve to one, so for almost every unit DepMap holds a fitness measurement of
the same cell line, and where the target screen is an Avana screen it is a later
release of the label itself. Any per-cell-line DepMap feature for that model is
forbidden.

The cell-line-independent DepMap products, such as the inferred common essentials
list, are *not* forbidden, because they are gene-level summaries over about a
thousand lines and do not identify this unit's label. That is a judgement rather
than a proof, and it is listed again under the objections.

All of this sits inside the existing AssayBench boundary. Only screens that
`splicr.orcs_safe` marks safe under the publication-level policy are considered,
and gene rows come from the safe-only parsed cache, which physically does not
contain the AssayBench validation and test screens. No screens outside that
boundary were used.

## Base rates

The quantity a method has to beat. `marginal` is P(hit in B) over the shared
space; `precision` is P(hit in B | hit in A); `lift` is their ratio. Per-unit
values, averaged over units.

| Split | Space | Marginal | Precision | Lift | Positives |
|---|---|---|---|---|---|
| development | non-common-essential (primary) | 0.0453 | 0.3596 | 8.08 | 728 |
| development | all genes | 0.0955 | 0.5585 | 5.87 | 1,676 |
| held out | non-common-essential (primary) | 0.0298 | 0.3209 | 11.17 | 466 |
| held out | all genes | 0.0940 | 0.6859 | 7.38 | 1,614 |

Lift is 5.9 to 11.2, nowhere near 1, so the benchmark is measuring something: a
gene that A calls a hit is roughly 8 to 11 times likelier to hit in B than a
gene drawn at random from the same space.

Stratified, the picture is sharper and less flattering:

| Split | Stratum | Marginal | Precision | Lift | Share of A's hits |
|---|---|---|---|---|---|
| development | common essential | 0.6369 | 0.7087 | 1.11 | 58% |
| development | non-common-essential | 0.0453 | 0.3596 | 8.08 | 42% |
| held out | common essential | 0.7738 | 0.8268 | 1.07 | 72% |
| held out | non-common-essential | 0.0298 | 0.3209 | 11.17 | 28% |

Common essentials are most of A's hits and they replicate almost
unconditionally, at lift 1.07 to 1.11. There is essentially no signal to
recover there, because nearly everything in that stratum replicates whatever a
method says.

## Why the primary metric excludes common essentials

Measured on development only, average precision over the full shared space:

| Ranking | Mean AP |
|---|---|
| A's effect size (`SCORE.1`, signed by `SCORE.1_TYPE`) | 0.4750 |
| "is this gene a known common essential", a lookup table | 0.4366 |
| A's binary hit call | 0.3646 |
| random | 0.0955 |

The lookup table never opens the screen, and it is not distinguishable from the
screen's own effect size: +0.0383 for effect size, 95% CI [-0.0255, +0.0989],
Wilcoxon p = 0.30 over 14 screen pairs. A headline computed over the full gene
space would therefore be largely a test of whether a method can recall a
published gene list.

Restricted to non-common-essential genes the shortcut dies, as it must:

| Ranking | Mean AP | vs random | vs A's hit call |
|---|---|---|---|
| A's effect size | 0.2517 | +0.2065, CI [0.1465, 0.2670] | +0.0827, CI [0.0445, 0.1187] |
| A's binary hit call | 0.1691 | | |
| common-essential lookup | 0.0436 | | |
| random | 0.0453 | | |

Here the lookup table is worthless, and the screen's own data carries real
signal: effect size beats random by a wide margin and beats A's own binary hit
call significantly, which means the continuous evidence in a screen says more
about replication than the published hit call does. That is headroom a method
can compete for, so this is the primary space. `PRIMARY_SPACE` is applied inside
`dataset.evaluate()` rather than left to the caller, so the headline cannot drift
back to the full space by accident. The full-space number is reported alongside,
never instead.

Every number in this section is development-only. No held-out label was read to
produce any of it.

## The required test

`dataset.paired_test(scores_a, scores_b)` returns the mean difference, a
percentile bootstrap 95% CI and a Wilcoxon signed-rank p. **A difference whose
CI crosses zero is not an improvement.**

The bootstrap resamples `pair_key`, not `unit_id`, and the Wilcoxon runs on the
per-pair mean of the two directions. The two directions of one screen pair are
the same experiment scored twice and are strongly dependent, so resampling units
would roughly halve the interval and overstate significance. That makes n the
number of screen pairs: 14 on development, 124 held out.

## Known objections

**"You chose the pairs."** Every filter is mechanical and applied to shipped
metadata, and the funnel is in the artifact. No filter reads the agreement
between the two sides; a test enforces that. What remains is that the phenotype
restriction was a judgement, and it was made before any base rate was computed
but it was still made by us. The audit function exists so a reader can see the
136 pairs it excluded and disagree.

**"The phenotype match is loose."** It is the tightest ORCS supports. All pairs
are unperturbed negative-selection proliferation timecourses in the same cell
line, which is the one category where the vocabulary pins the assay down. The
residual looseness is real: duration, MOI, timepoint and analysis method differ
within a pair, and `DURATION` is not matched on.

**"It only works on essentials."** This is the objection the benchmark takes
most seriously, and it is why the primary metric excludes common essentials
entirely. Measured, not assumed: on the full space a lookup table matches the
screen's own effect size; on the primary space it drops to chance.

**"Effect size alone does this."** Partly true and reported as such. Effect size
reaches 0.2517 on the development primary space against a 0.0453 floor, so any
method must beat effect size, not random. The margin to beat is published above
so it cannot be quietly replaced with an easier baseline.

**Held out is dominated by one comparison.** 113 of 124 held-out pairs are Behan
2019 against Meyers 2017. The 113 are different cell lines, so they are
different biological samples, but they are one library pair, one pair of
analysis pipelines and one pair of significance criteria. The effective n for
"does this generalise across libraries" is close to 1, not 124. A result here
should be read as "holds across 113 cell lines for the Sanger KY against Broad
Avana comparison", and the development side, which spans 9 publications, is the
only evidence about heterogeneity. This is the benchmark's single biggest
weakness and no amount of statistics fixes it; only more independent screen
pairs in shared cell lines would.

**The label is a hit call, not truth.** B's hit call depends on B's
significance criteria, which vary across pairs and are recorded per unit as
`target_criteria`. A gene can fail to replicate because B's threshold was
stricter, not because the hit was an artifact. Replication is a proxy for real,
and a gene that both labs miss is invisible to it.

**First author is a weak proxy for lab.** Two papers from the same senior lab
with different first authors pass the independence filter. Aguirre 2016 and
Meyers 2017 are both Broad and would pair if they shared a cell line and library,
and they land on opposite sides of the split so they never form a pair here, but
the rule that prevented it was the split and not the independence test. A
correspondence-author or affiliation field would be better; ORCS does not ship
one.

**Same-consortium screens are not excluded as such.** The rule excludes same
publication, same first author and same library, which catches the cases that
matter most, but not two screens from one consortium using different libraries.

**Cell-line-independent DepMap products are allowed.** The common-essentials
list is used to define the primary space, and a method may consult gene-level
DepMap summaries. The argument is that a summary over a thousand lines does not
identify a single unit's label. It is a judgement, not a proof, and a reader who
rejects it should read the primary-space numbers only, where common-essential
membership is constant and so carries no information at all.

**Two directions per pair.** Each screen pair yields two units, A predicting B
and B predicting A, which doubles the unit count without doubling the
information. `paired_test` resamples by `pair_key` to avoid counting one
experiment twice; any other analysis must do the same.

**Development is small.** 14 pairs and 9 publications. Interval estimates on
development are wide, and a method tuned there can overfit 14 pairs. That is the
price of a publication-disjoint split on a hub-dominated graph, and it is the
right direction for the error to run: the small, heterogeneous side is the one
used for tuning.

## The loader

```python
from splicr.replication import dataset

bench = dataset.load()
for unit in bench.units("development"):
    inputs = dataset.load_pair_inputs(unit)        # gene, a_hit, a_score1, is_common_essential
    allowed = dataset.allowed_background_screens(unit)
    score = my_method(inputs, allowed)             # one number per gene, higher = more likely
    print(dataset.evaluate(unit, score))           # primary space by default
```

| Function | Purpose |
|---|---|
| `load()` | the built benchmark, metadata and counts only |
| `pairs(split)` | evaluation units for a split |
| `load_pair_inputs(unit)` | everything a predictor may see |
| `load_pair_labels(unit, evaluating=)` | the label; refuses held-out without the flag |
| `allowed_background_screens(unit)` | the only sanctioned screen set for fitting |
| `forbidden_external(unit)` | DepMap models and ORCS screens that are off limits |
| `evaluate(unit, score, space=)` | AP plus the random and A's-hit-call baselines |
| `paired_test(a, b)` | bootstrap CI and Wilcoxon, resampled by screen pair |
| `base_rates(split)` | the table above |
| `excluded_phenotype_audit()` | re-derives the 136 excluded pairs |
| `dedup_cost()` | what the one-row-per-gene rule removes |
| `describe()` | the whole funnel as text |

`SCORE.1` sign convention is read from the `SCORE.1_TYPE` metadata, never
inferred from a screen's own hit calls, because inferring it would mean touching
the label whenever that screen is the B side. `CasTLE Score` is left `unknown`
rather than guessed, since its sign carries no direction and no screen here
states a `SCORE.1` criterion for it. A unit whose direction is `unknown` should
not be scored on raw `SCORE.1`.

## What would make this better

More pairs, from a source that records cell line and assay well enough to pair
perturbed screens. Failing that, the single highest-value addition is any second
genome-scale proliferation screen, from a lab that is neither Sanger nor Broad,
in a cell line those two already cover, which would break the held-out block's
dependence on one library comparison.
