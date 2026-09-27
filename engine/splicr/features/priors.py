"""Stratified hit-frequency priors for AssayBench screens -- the backbone family.

WHAT THIS IS
------------
For every (screen, gene) pair this module emits a small set of *label-free* prior
scores: "given only this screen's metadata and its library, how likely is this gene
to be one of its top hits?".  Everything is estimated from the AssayBench **train**
split (``yearfold0 == "train"``, 1349 screens) by hierarchical empirical-Bayes
pooling.  Nothing here ever reads validation or test labels; :meth:`StratifiedPrior.fit`
refuses a fitting set that contains a non-train screen.

THE ONE IDEA THAT MATTERS
-------------------------
AssayBench's ``phenotype`` field always opens with one of five verbs --
``decreases`` / ``increases`` / ``either`` / ``impacts`` -- and that verb says which
way the screen's own hits point.  It covers 100% of train and validation and is the
most shifted axis between the splits::

    direction   train              validation
    decreases    975 (72.3%)        67 (30.7%)
    increases    256 (19.0%)       100 (45.9%)
    either        74 ( 5.5%)        42 (19.3%)
    impacts       44 ( 3.3%)         9 ( 4.1%)

A hit-frequency prior pooled over all of train is therefore, in effect, an
*essentiality* prior -- and on an ``increases`` screen essentiality is close to the
worst ranking available, because a gene whose knockout kills the cell cannot be
enriched.  Upstream's global-hit-freq scores **0.02536** on the 100 ``increases``
screens in validation, against 0.25691 on the 67 ``decreases`` ones.  That one
subgroup is where the entire headroom of this family lives.

So the estimator is deliberately asymmetric:

    score(g | decreases / either / impacts) = p_base(g)
    score(g | increases)                    = p_inc(g) - lam * p_dec(g)

``p_base`` is the unstratified, Beta-smoothed hit rate -- essentially the upstream
baseline, which is already near-optimal for ``decreases`` screens.  The
``increases`` branch is the hierarchical prior for that direction *minus* the
opposite-direction prior: ``decreases`` and ``increases`` records built from the same
BioGRID screen have disjoint positive sets (median Jaccard 0.000 over the 116 sibling
pairs in train+validation) and each carries the other's hits as *negative* relevance,
which the metric's numerator does not clip.  Subtracting the opposite direction both
demotes the wrong genes and avoids the active subtraction.

THE RANK BLEND: THE SECOND IDEA, AND WHERE THE NON-`increases` GAIN COMES FROM
------------------------------------------------------------------------------
The estimator above leaves ``decreases`` / ``either`` / ``impacts`` screens -- 118 of
the 218 validation screens and 556 of the 724 holdout screens -- on the unstratified
base, i.e. at upstream parity.  Routing them to the stratum estimate instead does not
work: it is worth +0.0010 to +0.0023 on validation with a CI that crosses zero, and it
*loses* 0.0019 to 0.0046 on the holdout with a CI that does not.  Both endpoints of
that choice are therefore bad, but for opposite reasons: the base is well estimated and
coarse, the stratum is finer and noisier.

Blending them as **within-library percentiles** beats both, on both splits at once::

    p_blend(g) = (1 - w) * pct( p_base(g) )  +  w * pct( p_stratum(g) )

    w        0.0      0.3      0.4      0.5      0.6      0.7      1.0
    val   0.21218  0.21389  0.21445  0.21467  0.21354  0.21528     --
    hold  0.50915  0.51093  0.51176  0.51325  0.51231  0.51215  0.50473(*)

    (*) w=1 is the pure stratum; measured separately, and the only column that is
        worse than w=0 on the holdout.

The whole interior of the interval wins.  ``w = 0.5`` -- equal weight, the round
midpoint, not the argmax (0.7 is higher on validation, 0.5 on the holdout) -- is the
pre-registered value.

Why percentiles rather than probabilities?  Because the two estimates are not on a
common scale: the base is a genome-wide hit rate, the stratum's mean shifts with its
own cell's hit rate, so a probability-space mixture is dominated by whichever happens
to be numerically larger.  The probability blend does still work (+0.00217 val /
+0.00227 hold at w=0.25) but it is worth about half as much and its useful range is
much narrower.  The direction of that comparison is specific to the *blend*: the
opposite-direction **contrast** wants the opposite treatment and is strictly worse in
rank space (-0.019 to -0.023) than in probability space, because there the two terms
*are* commensurable -- both are hit rates for the same gene under mirrored phenotypes,
and their difference is meaningful while their rank difference is not.

Tie handling in ``pct`` is load-bearing; see :func:`_tied_percentile`.

WHY ASYMMETRIC, AND HOW IT WAS SELECTED
---------------------------------------
Selecting on the 218 validation screens alone gives a different and *worse* answer.
Every configuration was therefore scored on two splits at once:

* **validation** -- 218 screens, ``yearfold0 == "validation"`` (2021),
* **internal temporal holdout** -- fit on the 625 train screens from <=2018, score the
  724 train screens from 2019-2020.  This costs nothing (it lives entirely inside
  train) and it is dec-dominated like train, so it catches damage that validation's
  inc-heavy mix hides.

The selection rule, fixed in advance: among configurations that beat upstream
global-hit-freq on **both** splits, take the best sum of the two means.

That rule overturned two choices that validation alone had endorsed:

1. *Symmetric contrast.*  Applying the contrast to ``decreases`` screens too scored
   0.21309 on validation -- higher than the gated version -- but **lost** on the
   holdout (0.48827 vs upstream's 0.49578), with a tight negative CI on the dec
   subgroup (-0.00705 [-0.00858, -0.00556]).  The opposite of ``decreases`` is the
   thin ``increases`` stratum (256 train screens); subtracting it is mostly
   subtracting noise.  Gate the contrast to ``increases``, where the subtrahend is
   estimated from 975 screens, and both splits improve.
2. *Relevance-rank evidence.*  Pooling each donor's within-screen relevance
   percentile instead of its binary hit flag is worth +0.0064 on validation
   (0.18302 vs 0.17662) and **-0.0073 on the holdout** (0.48852 vs 0.49578).  It does
   not replicate, so the pre-registered config uses the binary flag.  ``evidence=
   "relrank"`` remains available; inside the final gated design it scores 0.20829 on
   validation, i.e. it is no longer even a validation win.

Zero of the 210 symmetric-contrast variants beat upstream on both splits.  1255 of the
1260 direction-gated variants do.  The difference is the gate, not the tuning.

MEASURED RESULTS (mean AnDCG@100, from ``assaybench.benchmark.metrics.RankingMetrics``)
--------------------------------------------------------------------------------------
::

    feature                                  validation(218)   holdout(724)
    prior_global_raw   upstream global-hit-freq   0.17662          0.49567
    prior_pheno_exact  upstream coarse-phenotype  0.16907            --
    prior_global       + Beta smoothing a=300     0.17755          0.50089
    prior_direction    + direction stratum        0.17927            --
    prior_stratum      + (phenotype x direction)  0.19372          0.49679
    prior_contrast_sym ungated symmetric contrast 0.21071          0.44647
    prior_directed     probability branch only    0.21218          0.50915
    prior_blended      PRE-REGISTERED DEFAULT     0.21467          0.51325

``prior_directed`` with ``evidence="hit"``, which was the previous shipped default,
measures 0.21112 / 0.50904; every "vs the previous default" comparison below is against
that.  ``prior_blended`` with ``evidence="hit"`` is 0.21466 / 0.51274, i.e. the blend
carries the gain and the evidence switch is a rounding error on validation (see below).

::

    prior_blended vs upstream global-hit-freq
      validation   delta=+0.03805  95% CI [+0.02151,+0.05688]  Wilcoxon p=1.3e-06
    prior_blended vs upstream coarse-phenotype-hit-freq
      validation   delta=+0.04560  95% CI [+0.02300,+0.06962]  Wilcoxon p=9.1e-03
    prior_blended vs the previous default (prior_directed, evidence="hit")
      validation   delta=+0.00355  95% CI [+0.00070,+0.00634]  Wilcoxon p=8.6e-02
      holdout      delta=+0.00421  95% CI [+0.00295,+0.00548]  Wilcoxon p=8.0e-10

    per direction        validation                     holdout
                      ours     upstream            ours     upstream
      decreases      0.26047    0.25691  (n=67)   0.72670    0.71425  (n=471)
      increases      0.10106    0.02536  (n=100)  0.06880    0.03303  (n=168)
      either         0.44685    0.43653  (n=42)   0.19680    0.18960  (n=59)
      impacts        0.05250    0.04666  (n=9)    0.23260    0.22006  (n=26)

Note the honesty caveat on that first pair of deltas: the **bootstrap CI excludes zero
on validation but the Wilcoxon does not** (p = 0.086).  The blend's gain is concentrated
on a minority of screens rather than being a broad shift, which is exactly the situation
where those two tests disagree.  On the 724-screen holdout the same change is decisive
by both (p = 8e-10), and the win holds across the whole w interval 0.3-0.8, so the
claim rests on the holdout's power and the plateau's width, not on validation's p-value.

The ``increases`` subgroup is still where most of it comes from: 4.0x upstream on
validation, 2.1x on the holdout.  What the blend adds is that the other three subgroups
are no longer ties -- ``either`` +0.0103 and ``decreases`` +0.0036 on validation,
+0.0072 and +0.0125 on the holdout.
57 of the 218 validation screens are still clamped to 0 by the metric, so a quarter of
the split contributes nothing to anyone's mean, and that count is unchanged by the
blend: it improves screens that already scored above random rather than rescuing any.

**The gate costs nothing and buys nothing on validation -- it buys robustness.**
``prior_contrast_sym``, the ungated symmetric version, scores 0.21069 against the
gated 0.21112: delta +0.00043, CI [-0.00466, +0.00577], Wilcoxon p = 0.82.  Validation
cannot tell them apart.  On the temporal holdout the same pair is 0.44647 vs 0.50904,
delta +0.0626, p = 2e-75.  So validation alone would have licensed a configuration that
is catastrophically wrong under a dec-dominated mix, and would have reported it as the
same number.  That asymmetry -- invisible upside, visible downside -- is the whole
argument for the second split.

WHAT DID NOT WORK (measured, not assumed)
-----------------------------------------
* **Per-screen mass normalisation.**  Down-weighting a donor by its hit count, so a
  5000-hit fitness screen cannot outvote a 16-hit drug screen, cost 0.030 AnDCG on
  validation (0.16095 vs 0.19090 at the same structure); ``1/sqrt(n_hits)`` was a
  wash.  Screens with many hits genuinely are more informative about which genes hit.
  Normalising *within* the screen instead (evidence divided by the screen's own hit
  fraction, so every donor's mean evidence is 1) was also no better.
* **Every stratum axis other than direction.**  ``cell_type`` (99 levels),
  ``cell_line`` (681), ``library_type``, ``library_methodology``,
  ``screen_category``, ``experimental_setup``, ``screen_type`` -- each landed within
  0.002 of the *unstratified* prior once shrinkage was fitted, and each is available
  in :data:`LEVEL_KEYS` if you want to re-measure.  A third hierarchy level on
  (phenotype x direction x cell_type) gained +0.0024 on validation with a bootstrap CI
  of [+0.00051, +0.00453] but Wilcoxon p = 0.25 -- the gain sits on a handful of
  screens, so it is not shipped.  Re-measured as a third level under the shipped chain,
  with shrinkage swept over ``{10, 30, 100, 300, 1000}``, every one of them is negative
  or a null on validation: ``cell_type`` -0.0121 to -0.0001, ``screen_type`` -0.0108 to
  +0.0004 (best CI [-0.00052,+0.00131]).
* **Library-size buckets, the one stratum the metric's shape argues for, lose.**  The
  metric is library-restricted and validation is split almost evenly between
  genome-wide screens (106) and focused libraries of 300-1500 genes (97), with 1103 and
  114 train donors respectively -- so the donor pools exist, and a focused library is a
  curated candidate set whose hit population is genuinely different.  It still does not
  work.  As a third level under (phenotype x direction) it runs -0.0048 (alpha=10) to
  -0.0002 (alpha=1000) on validation; as a *replacement* for phenotype it is far worse
  (direction x libsize -0.0071, libsize-first -0.0159 to -0.0321), and both splits agree.
  Buckets tried: <300 / <1500 / <6000 / <14000 / >=14000.  The phenotype field already
  encodes most of what library size encodes -- focused libraries are drug screens -- and
  it encodes it without fragmenting the counts.
* **Drug identity, which should have been the big one, has no coverage.**  72% of
  validation is "Drug / Chemical / Environmental Response", and ``condition_name`` names
  the compound, so pooling donors that used the *same* compound looks like the obvious
  win.  After normalising the field (lowercase, dosages, units and parentheticals
  stripped) only 54 of 218 validation screens have a compound that occurs in train at
  all, and only 19 have three or more train donors.  Measured as a third level, the best
  cell was +0.00100 on validation, CI [-0.00165, +0.00425], and at the shrinkage where
  the CI tightens the level is effectively switched off.  Not a modelling failure, a
  sample-size one: the temporal split puts almost every 2021 compound in its own cell.
* **Time-decay weighting** of donors by publication year (parsed from ``author``):
  monotonically worse as the decay sharpens -- 0.21418 at no decay, 0.21241 at a
  10-year constant, 0.20095 at 1 year.  There is no usable recency signal here.
* **Library-overlap soft strata.**  Weighting donors by Jaccard overlap between the
  query's library and the donor's, which is legitimate (the library is the candidate
  pool the metric restricts to) and which neighbour-selection analysis suggested
  should help, hurt monotonically: 0.20169 at ``jaccard^1``, 0.17557 at ``jaccard^4``,
  against 0.21418 unweighted.  Restricting to the top-100 most library-similar donors
  was worse still (0.19470).  Down-weighting the genome-wide screens throws away most
  of the counting evidence.
* **The library-restriction correction is right but makes no measurable difference.**
  Dividing by *times measured* rather than *times screened* is worth +0.003 to +0.004
  at an unstratified, unsmoothed structure, but the paired bootstrap CI crosses zero
  (p = 0.17-0.38); and inside the shipped design it is a dead wash --
  ``measured_denominator=False`` scores 0.21180 against the default's 0.21112, delta
  -0.00068 [-0.00397, +0.00263].  With Beta smoothing at alpha=300 the two
  denominators differ only for genes with almost no data, whose estimates are pinned to
  the parent either way.  It stays the default because it is the correct estimator, not
  because either split can tell the difference.
* **Asymmetric contrast weights per direction** beyond the on/off gate: sweeping
  ``lam_dec`` and ``lam_inc`` independently bought +0.0007 over the gate on
  validation, inside the noise, so the gate is binary.
* **Rank-based pooling, the natural alternative to counting, loses badly.**  Replacing
  each donor's contribution with a reciprocal-rank weight ``1/(60 + rank)`` -- the RRF
  rule the LLM ensemble baseline uses, applied to donor screens inside a stratum -- costs
  -0.0079 on validation and **-0.0507** on the holdout.  Borda (linear rank weight) is
  -0.0009 / -0.0135.  Both concentrate a donor's vote on its own few strongest hits, and
  the evidence that a gene hits *at all*, across many donors, is what carries the signal.
  The same conclusion as the earlier ``relrank`` finding, from the opposite direction and
  much more sharply.
* **Specificity (lift) instead of probability.**  Dividing the stratum estimate by the
  global one, ``p_stratum / p_global**beta``, to ask "is this gene unusually hit *here*"
  rather than "is it hit here": -0.0027 at beta=0.25, -0.0071 at 0.5, -0.0226 at 1.0.
  Under a top-100 metric the genes that are hit everywhere are the right answer; asking
  for specificity throws away the strongest genes to promote noisy rare ones.
* **A second subtrahend from the within-donor negative mask.**  Same-direction donors
  carry 31,821 negative-relevance genes in train, a different quantity from the mirrored
  record: pooling those separately and subtracting them too is worth +0.00079 on
  validation at weight 0.5, CI [-0.00082, +0.00249], and +0.00016 on the holdout.  The
  mirrored-record contrast already captures it.
* **Giving the ``increases`` branch a base or own-stratum component.**  Rank-blending the
  contrast with the unstratified base costs -0.0030 to -0.0093 on validation; blending it
  with its own unsubtracted stratum estimate reads +0.0037 on validation (CI
  [-0.00030,+0.00760]) but gives back most of the holdout gain (0.50988 vs 0.51325).
  The blend belongs on the branch that has no contrast, and only there.
* **Blending the base against a coarser or a third estimate.**  Against the
  direction-level estimate instead of the full (phenotype x direction) stratum:
  -0.0005 / -0.0015, so the blend needs the *fine* stratum, not just any second opinion.
  An equal three-way blend of base, direction and stratum is positive (+0.0023 / +0.0025)
  but strictly below the two-way at w=0.5 on both splits.
* **Beta-Binomial MLE shrinkage works, and is barely worse than tuning.**  Fitted on
  train alone the marginal likelihood gives ``alpha_global = 4.805``,
  ``alpha_direction = 13.002``, ``alpha_pheno_direction = 5.147``.  Inside the shipped
  gated design that scores **0.21035** on validation against the tuned 0.21112 --
  delta +0.00077 [-0.00187, +0.00330], a tie.  So the headline does not depend on
  having tuned the alphas at all: pass ``alphas="eb"`` and you get the same number
  from an estimator that never saw validation.  (The AnDCG-optimal alphas are still an
  order of magnitude larger, because the metric only looks at the top 100, where
  over-shrinking rare genes is nearly free.)
* **Lifting ``either`` / ``impacts`` screens off the base** with
  ``either_contrast_weight=0.25`` costs 0.005 on validation (0.20633).  Those screens
  count both directions as positive, so there is nothing to subtract.
* **Out-of-vocabulary genes are a non-issue, and were briefly a bug.**  Only 326 of the
  2,077,228 validation (screen, gene) rows name a gene the train split never assayed
  (0.016%; worst single screen 3.24%), so the choice of fallback moves the headline by
  ~0.0006 -- tie-break noise.  An earlier revision scaled the fallback by
  ``1 - contrast_weight`` even on screens that take the uncontrasted base branch, which
  scored 0.0006 *higher*; the shipped value is the consistent one (a gene with zero
  counts shrinks to the pooled rate at every level), not the higher one.

ONE SMALL THING THAT DID WORK, AND IS ALMOST A NULL
--------------------------------------------------
``evidence="pos"`` (relevance > 0) rather than upstream's ``hit`` flag.  These are not
the same field: 3081 of train's 52,763 ``increases``-direction positive-relevance genes
carry ``hit=False``, and 133 negative-relevance genes carry ``hit=True``.  ``rel > 0``
is what the metric actually rewards, so it is the better-specified estimator.  It is
also, on validation, a dead tie: +0.00001, CI [-0.00145, +0.00148], Wilcoxon p = 0.56.
On the 724-screen holdout it is +0.00051, CI [+0.00030, +0.00072], p = 6e-20 -- tiny but
unambiguous, and non-negative at every ``lam`` and ``w`` tested.  It is the default on
the correctness argument, with the measurement recorded as the near-null it is.

(Unrelated data note found while checking this: four records -- ``U_1389_inc``,
``U_1633_inc``, ``U_1636_inc`` in train and ``U_1718_inc`` in validation -- ship a
``hit`` list 1-3 entries *longer* than ``relevance_genes``.  ``zip`` in
:meth:`StratifiedPrior._encode_donor` truncates to the shortest, so only the trailing
extras are dropped and no gene is lost.  Worth knowing before anyone indexes those
columns in parallel.)

HONEST TUNING NOTE
------------------
Hyperparameters were selected on validation plus the train-internal holdout; the test
split was never loaded.  A split-half check on validation (tune the whole 1260-variant
grid on 109 screens, score the other 109, 600 resamples) puts the honestly-held-out
value of a validation-only selection at **0.2071 +/- 0.0188** against a full-validation
tuned maximum of 0.21276 -- so roughly 0.005 of any validation-tuned headline is
selection optimism.  Two things bound that risk here: the winning region is broad
(1255 of 1260 direction-gated variants beat upstream on both splits, spanning
0.1779-0.2128 on validation and 0.4959-0.5096 on the holdout), and the untuned
``alphas="eb"`` estimator lands within 0.0008 of the tuned default.

The same check run on ``blend_weight`` alone (grid ``{0, 0.2, ..., 0.8, 1.0}``, tune on
109 validation screens, score the other 109, 400 resamples) is the one number in this
file that should temper the headline: the honestly-held-out value of tuning ``w`` is
**+0.00096** over ``w = 0``, against the +0.00249 that full-validation tuning shows --
so about 0.0015 of the blend's validation gain is selection optimism, and on validation
alone the honest gain is about a third of the apparent one.  That is why the holdout
matters here rather than being a formality: it is 724 screens, it was not used to pick
``w = 0.5``, and it puts the same change at +0.00421 with CI [+0.00295, +0.00548].  The
grid's own preference is also worth stating plainly -- across those 400 resamples the
half-sample argmax landed on w=0.7 (170x) or w=0.8 (152x), not on the shipped 0.5, and
w=0 won only 5 times.  Shipping the midpoint of a flat interval rather than its argmax
costs ~0.0006 on validation and gains ~0.0011 on the holdout.

The shipped default is not literally the argmax of the selection rule.  The rule's
argmax mixes hierarchy depths -- own estimate at the direction level, subtrahend at
(phenotype x direction) -- for 0.21157 / 0.50867 in the sweep harness.  The shipped
uniform-depth configuration measures 0.21112 / 0.50904, i.e. 0.0005 lower on validation
and 0.0004 higher on the holdout, which is a tie on the selection criterion with one
fewer structural degree of freedom.  ``contrast_own_depth`` exists if you want the
mixed-depth form.  The deviation is recorded here rather than quietly taken.

Nothing in this module has ever been evaluated on ``yearfold0 == "test"``.  The
numbers above are the complete set of splits this family has been scored on.

USAGE
-----
    from splicr.features.priors import screen_gene_priors, FEATURE_NAMES
    feats = screen_gene_priors(my_screens)            # fits on train automatically
    feats["U_1234_dec"]["POLR2A"]["prior_directed"]   # -> float

    python -m splicr.features.priors                  # self-check on validation
"""

from __future__ import annotations

import math
import os
import sys
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Mapping, Sequence

import numpy as np

# --------------------------------------------------------------------------- #
# public surface
# --------------------------------------------------------------------------- #

#: Every feature this module emits, in a stable order.
FEATURE_NAMES: list[str] = [
    "prior_blended",             # THE feature: rank-blended branch (see BEST_FEATURE)
    "prior_directed",            # the previous default: probability-space branch only
    "prior_global_raw",          # upstream global-hit-freq: hits / times_measured
    "prior_global",              # the same, Beta-smoothed -- the `p_base` branch
    "prior_pheno_exact",         # upstream coarse-phenotype-hit-freq (no backoff)
    "prior_direction",           # hierarchy at the screen's own direction
    "prior_direction_opposite",  # hierarchy at the flipped direction verb
    "prior_stratum",             # hierarchy at (direction, phenotype x direction)
    "prior_stratum_opposite",    # the same, mirrored
    "prior_contrast_sym",        # symmetric contrast: better on validation, worse elsewhere
    "gene_log_times_measured",   # log1p(train screens that assayed the gene)
    "gene_never_hit",            # 1.0 when assayed >= 20 times and never a hit
]

#: Features whose value depends on the *query library*, not only on the gene, because
#: they are computed as within-library percentiles.  These cannot be expressed as a
#: vocabulary-length vector; :meth:`StratifiedPrior.library_column` produces them.
LIBRARY_FEATURES: frozenset[str] = frozenset({"prior_blended"})

#: The feature whose standalone validation AnDCG@100 the self-check reports.
BEST_FEATURE = "prior_blended"

#: Pre-registered configuration.  Selected on validation *and* on the train-internal
#: temporal holdout; see "WHY ASYMMETRIC" and "THE RANK BLEND" above.  The test split
#: was never loaded.
DEFAULT_CONFIG: dict[str, Any] = {
    "evidence": "pos",
    "levels": ("direction", "pheno_direction"),
    "alphas": (30.0, 100.0, 30.0),
    "base_alpha": 300.0,
    "contrast_weight": 0.8,
    "contrast_directions": ("inc",),
    "contrast_own_depth": None,
    "either_contrast_weight": 0.0,
    "measured_denominator": True,
    "min_donors": 1,
    "blend_weight": 0.5,
}

TRAIN_SPLIT = "train"
_NEVER_HIT_MIN_MEASURED = 20

_MISSING = {"", "-", "none", "n/a", "na", "null", "not specified", "unknown", "nan",
            "not applicable", "unspecified"}

_DIRECTION_VERB = {
    "decreases": "dec", "decrease": "dec", "decreased": "dec",
    "increases": "inc", "increase": "inc", "increased": "inc",
    "either": "either",
    "impacts": "impacts", "impact": "impacts",
}
#: Canonical verb to write back when mirroring a screen's direction.
_FLIP_VERB = {"dec": "increases", "inc": "decreases"}
_CANON_VERB = {"dec": "decreases", "inc": "increases",
               "either": "either", "impacts": "impacts"}


class LeakageError(RuntimeError):
    """Raised when the prior is asked to fit on a non-train screen."""


# --------------------------------------------------------------------------- #
# metadata helpers
# --------------------------------------------------------------------------- #

def _clean(value: Any) -> str:
    """Normalize a metadata field, mapping AssayBench's null sentinels to ``""``."""
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() in _MISSING else text


def _field(screen: Mapping[str, Any], name: str) -> str:
    """One metadata field, with ``"unknown"`` for missing (so it forms a real stratum)."""
    return _clean(screen.get(name)) or "unknown"


def direction_of(screen: Mapping[str, Any]) -> str:
    """Which way the screen's own hits point: ``dec`` / ``inc`` / ``either`` / ``impacts``.

    Read off the first word of ``phenotype``, which AssayBench always fills with one of
    five verbs.  Ordinary metadata -- the same string the LLM baselines are shown --
    and it covers 100% of the train and validation splits.  ``"na"`` when the field is
    empty or the verb is unrecognised; such screens take the unstratified branch.
    """
    parts = _clean(screen.get("phenotype")).lower().split()
    if not parts:
        return "na"
    return _DIRECTION_VERB.get(parts[0].strip(".,;:"), "na")


def mirror_screen(screen: Mapping[str, Any], verb: str | None = None) -> dict | None:
    """The same screen with its direction verb replaced, or ``None`` if it has none.

    Only ``phenotype`` changes, so every other stratum key is preserved: the mirrored
    screen lands in the *same* phenotype cell of the hierarchy, one direction over.
    """
    target = verb or _FLIP_VERB.get(direction_of(screen))
    if target is None:
        return None
    parts = _clean(screen.get("phenotype")).split()
    out = dict(screen)
    out["phenotype"] = " ".join([target] + parts[1:])
    return out


#: Stratum key builders.  Each must refine the one before it.
LEVEL_KEYS: dict[str, Callable[[Mapping[str, Any]], tuple]] = {
    "direction": lambda s: (direction_of(s),),
    "pheno": lambda s: (_field(s, "cleaned_phenotype"),),
    "pheno_direction": lambda s: (_field(s, "cleaned_phenotype"), direction_of(s)),
    "pheno_direction_screentype": lambda s: (
        _field(s, "cleaned_phenotype"), direction_of(s), _field(s, "screen_type")),
    "pheno_direction_celltype": lambda s: (
        _field(s, "cleaned_phenotype"), direction_of(s), _field(s, "cell_type")),
    "pheno_direction_libmeth": lambda s: (
        _field(s, "cleaned_phenotype"), direction_of(s), _field(s, "library_methodology")),
    "pheno_direction_setup": lambda s: (
        _field(s, "cleaned_phenotype"), direction_of(s), _field(s, "experimental_setup")),
}


# --------------------------------------------------------------------------- #
# evidence definitions: what one donor screen contributes per gene
# --------------------------------------------------------------------------- #

def _ev_hit(rel: np.ndarray, hit: np.ndarray) -> np.ndarray:
    """Upstream's binary significance flag.  The pre-registered choice."""
    return hit.astype(np.float64)


def _ev_pos(rel: np.ndarray, hit: np.ndarray) -> np.ndarray:
    """1 where relevance is positive (a same-direction hit)."""
    return (rel > 0.0).astype(np.float64)


def _ev_relrank(rel: np.ndarray, hit: np.ndarray) -> np.ndarray:
    """Within-screen percentile of positive relevance, 0 for non-hits.

    Scale-free: AssayBench relevance is ``|effect|`` in each screen's own units
    (Z-score, CRISPR score, -log10 p, ...), so magnitudes are not comparable across
    screens but within-screen ranks are.  nDCG is dominated by the highest-relevance
    genes, so this preserves *which* hits were strongest.  Worth +0.006 on validation
    and -0.007 on the temporal holdout, i.e. it does not replicate; see the module
    docstring.
    """
    out = np.zeros(len(rel), dtype=np.float64)
    pos = rel > 0.0
    n = int(pos.sum())
    if n:
        v = rel[pos]
        order = np.argsort(v, kind="stable")
        ranks = np.empty(n, dtype=np.float64)
        ranks[order] = np.arange(1, n + 1, dtype=np.float64) / n
        out[pos] = ranks
    return out


def _ev_relmag(rel: np.ndarray, hit: np.ndarray) -> np.ndarray:
    """Positive relevance divided by the screen's own maximum."""
    out = np.maximum(rel, 0.0)
    mx = float(out.max()) if len(out) else 0.0
    return out / mx if mx > 0 else out


EVIDENCE: dict[str, Callable[[np.ndarray, np.ndarray], np.ndarray]] = {
    "hit": _ev_hit,
    "pos": _ev_pos,
    "relrank": _ev_relrank,
    "relmag": _ev_relmag,
}


# --------------------------------------------------------------------------- #
# symbol normalization
# --------------------------------------------------------------------------- #

class _Normalizer:
    """Upper-cases and synonym-maps gene symbols, memoised.

    Uses ``assaybench.utils.gene_mapper.GeneMapper`` when importable -- the same mapper
    the metric applies to both sides -- so a train screen's ``KIAA0101`` and a test
    screen's ``PCLAF`` pool into one gene.  Falls back to upper-casing.
    """

    def __init__(self, use_gene_mapper: bool = True) -> None:
        self._cache: dict[str, str] = {}
        self._mapper: Any = None
        self._want = use_gene_mapper

    def _lazy(self) -> Any:
        if self._mapper is None and self._want:
            try:
                from assaybench.utils.gene_mapper import GeneMapper

                self._mapper = GeneMapper(verbose=False)
            except Exception:                                    # pragma: no cover
                self._want = False
                self._mapper = None
        return self._mapper

    def __call__(self, gene: str) -> str:
        got = self._cache.get(gene)
        if got is not None:
            return got
        upper = gene.strip().upper()
        out = upper
        mapper = self._lazy()
        if mapper is not None:
            try:
                mapped = mapper.map_gene(upper)
            except Exception:                                    # pragma: no cover
                mapped = None
            if mapped:
                out = mapped
        self._cache[gene] = out
        return out


# --------------------------------------------------------------------------- #
# the estimator
# --------------------------------------------------------------------------- #

def _shrink(num: np.ndarray, den: np.ndarray, alpha: float,
            parent: np.ndarray | float) -> np.ndarray:
    """``(num + alpha*parent) / (den + alpha)``, falling back to ``parent`` with no data.

    The fallback matters: with ``alpha == 0`` a gene the stratum never assayed gives
    ``0/0``.  Upstream's stratified baselines resolve that to ``0.0``, which throws the
    gene to the bottom of the ranking on no evidence at all; backing off to the parent
    estimate is the better estimator and is what this family uses.
    """
    par = np.asarray(parent, dtype=np.float64)
    if par.ndim == 0:
        par = np.full(len(num), float(par))
    total = den + alpha
    with np.errstate(divide="ignore", invalid="ignore"):
        est = (num + alpha * par) / np.where(total > 0, total, 1.0)
    return np.where(total > 0, est, par)


def _tied_percentile(x: np.ndarray) -> np.ndarray:
    """Within-library percentile in ``[0, 1]``, with **tied values sharing one rank**.

    Tie handling is load-bearing, not cosmetic.  The Beta-smoothed base pins every
    gene the train split never hit to the same number -- a median 13.8% of a
    validation library, up to 58.5% -- so a plain ``argsort`` percentile would hand
    those tied genes *distinct* ranks in ``relevance_genes`` order and silently turn
    the parquet's gene order into a predictor.  (That order is measured to be at
    chance: 0.02074 forward vs 0.01880 for a constant score on validation, 0.00788 vs
    0.01111 on the temporal holdout, against 0.01893 for random.  So it would be noise
    rather than leakage -- but noise dressed as signal, and it would move the blend's
    headline.  Averaging ties removes the question: ties stay ties and are broken by
    :meth:`StratifiedPrior.rank`'s seeded jitter, exactly as in the unblended branch.)
    """
    n = len(x)
    if n == 0:
        return x.astype(np.float64)
    order = np.argsort(x, kind="stable")
    xs = x[order]
    out = np.empty(n, dtype=np.float64)
    i = 0
    while i < n:
        j = i + 1
        while j < n and xs[j] == xs[i]:
            j += 1
        out[order[i:j]] = (i + j - 1) / 2.0
        i = j
    return out / max(n - 1, 1)


@dataclass
class _Cell:
    """Pooled evidence for one stratum: per-gene numerator and denominator."""

    num: np.ndarray
    den: np.ndarray
    n_donors: int


class StratifiedPrior:
    """Direction-gated hierarchical empirical-Bayes hit-frequency prior over genes.

    The pooling is a chain of Beta shrinkages, coarse to fine::

        p_global(g)    = (sum_s e_s(g) + a_0 * pooled) / (sum_s m_s(g) + a_0)
        p_level(g|key) = (sum_{s in key} e_s(g) + a_l * p_parent(g))
                         / (sum_{s in key} m_s(g) + a_l)

    where ``e_s(g)`` is donor ``s``'s evidence for gene ``g`` (see :data:`EVIDENCE`) and
    ``m_s(g)`` is 1 **iff donor s measured g** -- the library-restriction correction: a
    gene cannot hit in a screen that never assayed it, so the denominator is
    times-measured, not times-screened.

    The final score is gated on the screen's direction verb::

        direction in contrast_directions:  p_stratum(g) - lam * p_stratum_mirrored(g)
        otherwise:                         p_base(g)        [unstratified, smoothed]

    See the module docstring for why that asymmetry is the shipped default and what the
    symmetric alternative costs.

    Args:
        evidence: key into :data:`EVIDENCE`.  ``"hit"`` (default, pre-registered)
            reproduces upstream's binary counting; ``"relrank"`` pools each donor's
            within-screen relevance percentile -- better on validation, worse on the
            temporal holdout.
        levels: stratum keys from :data:`LEVEL_KEYS`, coarse to fine.  Each must refine
            the previous one.
        alphas: ``len(levels) + 1`` Beta pseudo-counts.  ``alphas[0]`` shrinks the
            global prior toward the pooled scalar rate; ``alphas[i+1]`` shrinks level
            ``i`` toward level ``i-1``.  Pass the string ``"eb"`` to fit them on train
            alone by Beta-Binomial marginal likelihood instead.
        base_alpha: shrinkage for the unstratified ``p_base`` branch.  Kept separate
            because that branch is the whole prediction for ``decreases`` screens.
        contrast_weight: ``lam``.  0 disables the contrast entirely.
        contrast_directions: which direction verbs get the contrast.  ``("inc",)`` is
            the pre-registered gate; ``("inc", "dec")`` is the symmetric variant.
        either_contrast_weight: optional lift applied to ``either`` / ``impacts``
            screens, which otherwise take ``p_base`` unchanged.
        measured_denominator: False switches to times-*screened*, the common mistake;
            kept so the ablation is runnable.
        min_donors: skip a stratum with fewer donors than this and keep the parent.
        blend_weight: weight on the stratum estimate inside the non-contrast branch's
            within-library rank blend, ``0`` for the pure unstratified base (the
            previous default, i.e. ``prior_directed``) and ``1`` for the pure stratum.
            ``0.5`` is pre-registered; see "THE RANK BLEND" in the module docstring.
            Affects ``prior_blended`` only.
        use_gene_mapper: normalize symbols through AssayBench's ``GeneMapper``.

    Deterministic and picklable after :meth:`fit`.
    """

    def __init__(
        self,
        evidence: str = DEFAULT_CONFIG["evidence"],
        levels: Sequence[str] = DEFAULT_CONFIG["levels"],
        alphas: Sequence[float] | str = DEFAULT_CONFIG["alphas"],
        base_alpha: float = DEFAULT_CONFIG["base_alpha"],
        contrast_weight: float = DEFAULT_CONFIG["contrast_weight"],
        contrast_directions: Sequence[str] = DEFAULT_CONFIG["contrast_directions"],
        contrast_own_depth: int | None = DEFAULT_CONFIG["contrast_own_depth"],
        either_contrast_weight: float = DEFAULT_CONFIG["either_contrast_weight"],
        measured_denominator: bool = DEFAULT_CONFIG["measured_denominator"],
        min_donors: int = DEFAULT_CONFIG["min_donors"],
        blend_weight: float = DEFAULT_CONFIG["blend_weight"],
        use_gene_mapper: bool = True,
    ) -> None:
        if evidence not in EVIDENCE:
            raise ValueError(f"unknown evidence {evidence!r}; choose from {sorted(EVIDENCE)}")
        bad = [lv for lv in levels if lv not in LEVEL_KEYS]
        if bad:
            raise ValueError(f"unknown level(s) {bad}; choose from {sorted(LEVEL_KEYS)}")
        bad_dir = [d for d in contrast_directions if d not in _FLIP_VERB]
        if bad_dir:
            raise ValueError(
                f"contrast_directions must be a subset of {sorted(_FLIP_VERB)}, got {bad_dir}"
            )
        self.evidence = evidence
        self.levels = tuple(levels)
        self.alphas_spec = alphas
        self.base_alpha = float(base_alpha)
        self.contrast_weight = float(contrast_weight)
        self.contrast_directions = tuple(contrast_directions)
        if contrast_own_depth is not None and not 0 <= contrast_own_depth <= len(levels):
            raise ValueError(
                f"contrast_own_depth must be in 0..{len(levels)}, got {contrast_own_depth}"
            )
        self.contrast_own_depth = contrast_own_depth
        self.either_contrast_weight = float(either_contrast_weight)
        self.measured_denominator = bool(measured_denominator)
        self.min_donors = int(min_donors)
        if not 0.0 <= float(blend_weight) <= 1.0:
            raise ValueError(f"blend_weight must be in [0, 1], got {blend_weight}")
        self.blend_weight = float(blend_weight)
        self._norm = _Normalizer(use_gene_mapper)
        self.fitted = False

        # filled by fit()
        self.vocab: dict[str, int] = {}
        self.alphas: tuple[float, ...] = ()
        self.n_train: int = 0
        self.pooled_rate: float = 0.0
        self._root: _Cell | None = None
        self._cells: list[dict[tuple, _Cell]] = []
        self._times_measured: np.ndarray | None = None
        self._times_hit: np.ndarray | None = None
        self._pheno_exact: dict[str, np.ndarray] = {}
        self._cache: dict[tuple, np.ndarray] = {}

    # -- fitting ----------------------------------------------------------- #

    def fit(self, train: Sequence[Mapping[str, Any]] | None = None,
            allow_non_train: bool = False) -> "StratifiedPrior":
        """Pool the training screens.  Train split only.

        Args:
            train: AssayBench records.  ``None`` loads ``yearfold0 == "train"`` from the
                local parquet snapshot.
            allow_non_train: bypass the split guard.  Only for deliberate experiments on
                a re-split corpus (e.g. the train-internal temporal holdout used to
                select the defaults); never for a benchmark run.

        Raises:
            LeakageError: if any record is marked validation or test.
        """
        if train is None:
            from splicr.assaybench_io import load_split

            train = load_split(TRAIN_SPLIT)
        train = list(train)
        if not train:
            raise ValueError("empty training set")
        if not allow_non_train:
            bad = [str(s.get("dataset_name")) for s in train
                   if str(s.get("yearfold0", s.get("split", TRAIN_SPLIT))) != TRAIN_SPLIT]
            if bad:
                raise LeakageError(
                    f"refusing to fit on {len(bad)} non-train screen(s), e.g. {bad[:5]}. "
                    "The prior must never see validation or test labels."
                )

        ev_fn = EVIDENCE[self.evidence]
        self.vocab = {}
        rows: list[tuple[np.ndarray, np.ndarray, np.ndarray, Mapping[str, Any]]] = []
        for s in train:
            gi, ev, hitv = self._encode_donor(s, ev_fn)
            rows.append((gi, ev, hitv, s))
        nv = len(self.vocab)
        self.n_train = len(rows)

        root_num = np.zeros(nv)
        root_den = np.zeros(nv)
        hits = np.zeros(nv)
        for gi, ev, hitv, _s in rows:
            np.add.at(root_num, gi, ev)
            np.add.at(root_den, gi, 1.0)
            np.add.at(hits, gi, hitv)
        self._times_measured = root_den.copy()
        self._times_hit = hits
        self.pooled_rate = float(root_num.sum() / max(root_den.sum(), 1e-12))
        if not self.measured_denominator:
            root_den = np.full(nv, float(len(rows)))
        self._root = _Cell(root_num, root_den, len(rows))

        self._cells = []
        for name in self.levels:
            keyfn = LEVEL_KEYS[name]
            cells: dict[tuple, _Cell] = {}
            for gi, ev, _hitv, s in rows:
                key = keyfn(s)
                cell = cells.get(key)
                if cell is None:
                    cell = cells[key] = _Cell(np.zeros(nv), np.zeros(nv), 0)
                np.add.at(cell.num, gi, ev)
                np.add.at(cell.den, gi, 1.0)
                cell.n_donors += 1
            if not self.measured_denominator:
                for cell in cells.values():
                    cell.den = np.full(nv, float(cell.n_donors))
            self._cells.append(cells)

        # upstream's coarse-phenotype-hit-freq, for reference and for ensembling
        pheno: dict[str, list[np.ndarray]] = {}
        for gi, _ev, hitv, s in rows:
            key = _field(s, "cleaned_phenotype")
            acc = pheno.get(key)
            if acc is None:
                acc = pheno[key] = [np.zeros(nv), np.zeros(nv)]
            np.add.at(acc[0], gi, hitv)
            np.add.at(acc[1], gi, 1.0)
        self._pheno_exact = {
            k: np.divide(h, m, out=np.zeros(nv), where=m > 0) for k, (h, m) in pheno.items()
        }

        self.alphas = (tuple(self._fit_alphas_eb())
                       if isinstance(self.alphas_spec, str)
                       else tuple(float(a) for a in self.alphas_spec))
        if len(self.alphas) != len(self.levels) + 1:
            raise ValueError(
                f"need {len(self.levels)+1} alphas for {len(self.levels)} level(s), "
                f"got {len(self.alphas)}"
            )
        self._cache = {}
        self.fitted = True
        return self

    def _encode_donor(self, s: Mapping[str, Any], ev_fn: Callable
                      ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Normalised gene indices, evidence and hit flags for one donor.

        Duplicate symbols are collapsed later-wins, exactly as the metric's
        ``dict(zip(normalized_gt, relevance_scores))`` does, so pooling and scoring
        agree on what "one gene" means.
        """
        rel_table: dict[str, float] = {}
        hit_table: dict[str, bool] = {}
        for g, r, h in zip(s["relevance_genes"], s["relevance_scores"], s["hit"]):
            n = self._norm(g)
            rel_table[n] = float(r)
            hit_table[n] = bool(h)
        names = list(rel_table)
        for n in names:
            if n not in self.vocab:
                self.vocab[n] = len(self.vocab)
        gi = np.fromiter((self.vocab[n] for n in names), dtype=np.int64, count=len(names))
        rel = np.fromiter((rel_table[n] for n in names), dtype=np.float64, count=len(names))
        hit = np.fromiter((hit_table[n] for n in names), dtype=bool, count=len(names))
        return gi, ev_fn(rel, hit), hit.astype(np.float64)

    def _fit_alphas_eb(self, cap: float = 1e5) -> list[float]:
        """Fit one shrinkage strength per level by Beta-Binomial marginal likelihood.

        Train only.  Uses the binary hit counts, for which the Beta-Binomial is the
        exact marginal; non-integer evidence would need a continuous analogue, so these
        alphas are reused for whichever evidence is configured.  On the AssayBench train
        split this returns ``[4.805, 13.002, 5.147]`` for the default two-level chain.
        """
        from scipy.optimize import minimize_scalar
        from scipy.special import gammaln

        assert self._times_measured is not None and self._times_hit is not None
        nv = len(self._times_measured)

        def mle(num: np.ndarray, den: np.ndarray, parent: np.ndarray) -> float:
            m = np.round(den).astype(float)
            h = np.minimum(np.round(num).astype(float), m)
            keep = m > 0
            m, h = m[keep], np.clip(h[keep], 0.0, None)
            pi = np.clip(np.asarray(parent, float)[keep], 1e-6, 1 - 1e-6)

            def nll(log_a: float) -> float:
                a = math.exp(log_a)
                ap, aq = a * pi, a * (1.0 - pi)
                return -float(np.sum(
                    gammaln(h + ap) + gammaln(m - h + aq) - gammaln(m + a)
                    - gammaln(ap) - gammaln(aq) + gammaln(a)))

            res = minimize_scalar(nll, bounds=(math.log(1e-3), math.log(cap)),
                                  method="bounded")
            return float(math.exp(res.x))

        pooled = float(self._times_hit.sum() / max(self._times_measured.sum(), 1e-12))
        a0 = mle(self._times_hit, self._times_measured, np.full(nv, pooled))
        parent = _shrink(self._times_hit, self._times_measured, a0, pooled)
        out = [a0]
        for cells in self._cells:
            if not cells:
                out.append(0.0)
                continue
            nums = np.concatenate([c.num for c in cells.values()])
            dens = np.concatenate([c.den for c in cells.values()])
            pars = np.concatenate([parent] * len(cells))
            out.append(mle(nums, dens, pars))
        return out

    # -- scoring ----------------------------------------------------------- #

    def _require(self) -> None:
        if not self.fitted:
            raise RuntimeError("StratifiedPrior.fit() must be called first (train only)")

    def _global_vector(self, alpha: float) -> np.ndarray:
        assert self._root is not None
        key = ("global", alpha)
        got = self._cache.get(key)
        if got is None:
            got = _shrink(self._root.num, self._root.den, alpha, self.pooled_rate)
            self._cache[key] = got
        return got

    def _level_vector(self, screen: Mapping[str, Any], depth: int) -> np.ndarray:
        """Hierarchy estimate after shrinking through the first ``depth`` levels."""
        chain = tuple(LEVEL_KEYS[name](screen) for name in self.levels[:depth])
        key = ("level", depth, chain)
        got = self._cache.get(key)
        if got is not None:
            return got
        cur = self._global_vector(self.alphas[0])
        for lv in range(depth):
            cell = self._cells[lv].get(chain[lv])
            if cell is None or cell.n_donors < self.min_donors:
                continue
            cur = _shrink(cell.num, cell.den, self.alphas[lv + 1], cur)
        self._cache[key] = cur
        return cur

    def _pheno_exact_vector(self, screen: Mapping[str, Any]) -> np.ndarray:
        got = self._pheno_exact.get(_field(screen, "cleaned_phenotype"))
        if got is None:
            m, h = self._times_measured, self._times_hit
            assert m is not None and h is not None
            got = np.divide(h, m, out=np.zeros(len(m)), where=m > 0)
        return got

    def feature_vectors(self, screen: Mapping[str, Any]) -> dict[str, np.ndarray]:
        """All features for one screen as vocab-length vectors (the fast path).

        Reads ``phenotype`` and the other :data:`LEVEL_KEYS` fields.  Never touches
        ``relevance_scores`` or ``hit`` on the passed screen.
        """
        self._require()
        m, h = self._times_measured, self._times_hit
        assert m is not None and h is not None
        nv = len(m)
        depth = len(self.levels)
        base = self._global_vector(self.base_alpha)
        glob = self._global_vector(self.alphas[0])
        stratum = self._level_vector(screen, depth)
        dirn = self._level_vector(screen, 1) if depth >= 1 else glob

        mir = mirror_screen(screen)
        if mir is None:
            # `either` / `impacts` / `na` screens have no opposite direction.  The
            # neutral value is the unstratified base, not 0 -- a 0 would read as
            # "never a hit anywhere" to a downstream ranker.
            stratum_opp = base
            dirn_opp = base
        else:
            stratum_opp = self._level_vector(mir, depth)
            dirn_opp = self._level_vector(mir, 1) if depth >= 1 else glob

        d = direction_of(screen)
        if d in self.contrast_directions and mir is not None:
            own = (stratum if self.contrast_own_depth is None
                   else self._level_vector(screen, self.contrast_own_depth))
            directed = own - self.contrast_weight * stratum_opp
        elif d in ("either", "impacts") and self.either_contrast_weight:
            directed = stratum - self.either_contrast_weight * base
        else:
            directed = base

        # The symmetric variant, for the ablation: contrast on every screen that has an
        # opposite direction at all, i.e. `dec` as well as `inc`.  Screens with no
        # opposite keep the plain stratum estimate, exactly as measured.
        contrast_sym = (stratum - self.contrast_weight * stratum_opp
                        if mir is not None else stratum)

        return {
            "prior_directed": directed,
            "prior_global_raw": np.divide(h, m, out=np.zeros(nv), where=m > 0),
            "prior_global": base,
            "prior_pheno_exact": self._pheno_exact_vector(screen),
            "prior_direction": dirn,
            "prior_direction_opposite": dirn_opp,
            "prior_stratum": stratum,
            "prior_stratum_opposite": stratum_opp,
            "prior_contrast_sym": contrast_sym,
            "gene_log_times_measured": np.log1p(m),
            "gene_never_hit": ((m >= _NEVER_HIT_MIN_MEASURED) & (h == 0)).astype(np.float64),
        }

    def library_column(self, screen: Mapping[str, Any], idx: np.ndarray,
                       name: str = "prior_blended") -> np.ndarray:
        """One library-length column for a feature in :data:`LIBRARY_FEATURES`.

        ``idx`` is the screen's vocab indices from :meth:`_library_index` (``-1`` for a
        symbol the train split never assayed).  The return value is aligned with it.

        ``prior_blended`` keeps the ``increases`` contrast branch exactly as
        :meth:`feature_vectors` builds it and replaces the other branch with a rank
        blend of the unstratified base and the stratum estimate::

            increases:  pct( p_stratum(g) - lam * p_stratum_mirrored(g) )
            otherwise:  (1-w) * pct( p_base(g) )  +  w * pct( p_stratum(g) )

        Both branches come out as within-library percentiles in ``[0, 1]``, so the
        feature is on one comparable scale across screens -- which a downstream ranker
        needs and which the raw probabilities, whose scale shifts with the stratum's
        own hit rate, do not provide.  Wrapping the contrast branch in ``pct`` is a
        monotone transform, so it leaves that branch's ranking (and therefore its
        AnDCG) bit-identical; the self-check asserts this.
        """
        self._require()
        if name not in LIBRARY_FEATURES:
            raise ValueError(f"{name!r} is not a library feature; use feature_vectors()")
        vecs = self.feature_vectors(screen)
        safe = np.maximum(idx, 0)
        known = idx >= 0
        pooled = self.pooled_rate

        def col(vec: np.ndarray, oov: float) -> np.ndarray:
            return np.where(known, vec[safe], oov)

        d = direction_of(screen)
        if d in self.contrast_directions and mirror_screen(screen) is not None:
            raw = col(vecs["prior_directed"], pooled * (1.0 - self.contrast_weight))
            return _tied_percentile(raw)
        base = _tied_percentile(col(vecs["prior_global"], pooled))
        if self.blend_weight <= 0.0:
            return base
        stratum = _tied_percentile(col(vecs["prior_stratum"], pooled))
        w = self.blend_weight
        return (1.0 - w) * base + w * stratum

    def gene_index(self, gene: str) -> int:
        """Vocab index for a symbol, or ``-1`` when the train split never assayed it."""
        self._require()
        return self.vocab.get(self._norm(gene), -1)

    def _out_of_vocab(self, name: str, screen: Mapping[str, Any]) -> float:
        """Value for a gene the train split never assayed, for this screen.

        Every prior backs off to its own parent estimate rather than to a hard 0, so an
        unseen gene sits mid-ranking instead of at the bottom.  A gene with zero counts
        everywhere shrinks to the pooled rate at every level, so the fallback is the
        pooled rate put through the same arithmetic the screen's branch uses -- which is
        why this has to know the screen's direction.
        """
        if name in LIBRARY_FEATURES:
            raise ValueError(
                f"{name!r} is library-dependent; its out-of-vocabulary value is folded "
                "into library_column(), which percentiles the whole library at once"
            )
        p = self.pooled_rate
        if name in ("prior_global_raw", "prior_pheno_exact",
                    "gene_log_times_measured", "gene_never_hit"):
            return 0.0
        d = direction_of(screen)
        has_mirror = d in _FLIP_VERB
        if name == "prior_directed":
            if d in self.contrast_directions and has_mirror:
                return p * (1.0 - self.contrast_weight)
            if d in ("either", "impacts") and self.either_contrast_weight:
                return p * (1.0 - self.either_contrast_weight)
            return p
        if name == "prior_contrast_sym":
            return p * (1.0 - self.contrast_weight) if has_mirror else p
        return p

    def transform(
        self,
        screens: Sequence[Mapping[str, Any]],
        features: Iterable[str] | None = None,
    ) -> dict[str, dict[str, dict[str, float]]]:
        """``{dataset_name: {gene_symbol: {feature_name: value}}}``.

        Keys are each screen's own symbols exactly as they appear in
        ``relevance_genes`` (so the caller can rank the screen's library directly); the
        lookup itself happens on the normalized symbol, and symbols that normalize
        together appear once.

        Labels are not read: only ``dataset_name``, ``relevance_genes`` and the metadata
        fields in :data:`LEVEL_KEYS`.  Safe on validation and test records.

        For large libraries prefer :meth:`transform_dense`, which holds the same values
        in about 1% of the memory.
        """
        self._require()
        names = self._check_features(features)
        out: dict[str, dict[str, dict[str, float]]] = {}
        for s in screens:
            genes, cols = self._columns(s, names)
            out[str(s["dataset_name"])] = {
                gene: {n: float(cols[n][i]) for n in names}
                for i, gene in enumerate(genes)
            }
        return out

    def transform_dense(
        self, screens: Sequence[Mapping[str, Any]], features: Iterable[str] | None = None
    ) -> dict[str, tuple[list[str], np.ndarray]]:
        """``{dataset_name: (gene_symbols, array[n_genes, n_features])}``.

        Same values and column order as :meth:`transform`; use this when feeding a
        ranker.  Column order is ``features`` if given, else :data:`FEATURE_NAMES`.
        """
        self._require()
        names = self._check_features(features)
        out: dict[str, tuple[list[str], np.ndarray]] = {}
        for s in screens:
            genes, cols = self._columns(s, names)
            mat = np.empty((len(genes), len(names)), dtype=np.float64)
            for c, n in enumerate(names):
                mat[:, c] = cols[n]
            out[str(s["dataset_name"])] = (genes, mat)
        return out

    def rank(self, screen: Mapping[str, Any], feature: str = BEST_FEATURE,
             k: int | None = 100, seed: int = 42) -> list[str]:
        """The screen's own library ranked by one feature, best first.

        Library-restricted by construction, which is a real structural advantage under
        this metric: a predicted gene outside the screen's library consumes a top-100
        slot and is then deleted by the condensed evaluation, so a library-restricted
        predictor gets 100 scoring slots where an unrestricted one gets fewer.

        Ties are broken by a fixed permutation of the library (seeded, so runs are
        reproducible) rather than by input order, which would otherwise hand a
        systematic edge to whatever order the parquet happens to store.
        """
        self._require()
        genes, cols = self._columns(screen, [feature])
        score = cols[feature]
        jitter = np.random.default_rng(seed).permutation(len(genes)).astype(np.float64)
        order = np.lexsort((jitter, -score))
        if k is not None:
            order = order[:k]
        return [genes[i] for i in order]

    def _columns(self, screen: Mapping[str, Any], names: Sequence[str]
                 ) -> tuple[list[str], dict[str, np.ndarray]]:
        """Deduped library symbols and one library-length column per feature.

        The single place that knows how a vocabulary-length feature and a
        library-dependent one (:data:`LIBRARY_FEATURES`) are both turned into a column,
        so :meth:`transform`, :meth:`transform_dense` and :meth:`rank` cannot drift.
        """
        idx, genes = self._library_index(screen)
        safe = np.maximum(idx, 0)
        known = idx >= 0
        cols: dict[str, np.ndarray] = {}
        vecs: dict[str, np.ndarray] | None = None
        for n in names:
            if n in LIBRARY_FEATURES:
                cols[n] = self.library_column(screen, idx, n)
                continue
            if vecs is None:
                vecs = self.feature_vectors(screen)
            cols[n] = np.where(known, vecs[n][safe], self._out_of_vocab(n, screen))
        return genes, cols

    def _check_features(self, features: Iterable[str] | None) -> list[str]:
        names = list(features) if features is not None else list(FEATURE_NAMES)
        unknown = [n for n in names if n not in FEATURE_NAMES]
        if unknown:
            raise ValueError(f"unknown feature(s) {unknown}; choose from {FEATURE_NAMES}")
        return names

    def _library_index(self, s: Mapping[str, Any]) -> tuple[np.ndarray, list[str]]:
        """Deduped library symbols (raw spelling, first occurrence) and vocab indices."""
        seen: dict[str, str] = {}
        for g in s["relevance_genes"]:
            seen.setdefault(self._norm(g), g)
        genes = list(seen.values())
        idx = np.fromiter((self.vocab.get(self._norm(g), -1) for g in genes),
                          dtype=np.int64, count=len(genes))
        return idx, genes


# --------------------------------------------------------------------------- #
# the documented one-shot entry point
# --------------------------------------------------------------------------- #

def screen_gene_priors(
    screens: Sequence[Mapping[str, Any]],
    train: Sequence[Mapping[str, Any]] | None = None,
    features: Iterable[str] | None = None,
    dense: bool = False,
    **config: Any,
) -> dict[str, Any]:
    """Prior features for a list of AssayBench screen records.

    Args:
        screens: records to featurise.  Only ``dataset_name``, ``relevance_genes`` and
            metadata are read -- never ``relevance_scores`` or ``hit``.  Safe to call on
            validation or test records.
        train: fitting corpus.  ``None`` loads the ``train`` split from the local
            parquet snapshot.  Non-train records raise :class:`LeakageError`.
        features: subset of :data:`FEATURE_NAMES`; ``None`` means all of them.
        dense: return ``{dataset_name: (genes, array)}`` instead of nested dicts.
        **config: overrides for :class:`StratifiedPrior` (see :data:`DEFAULT_CONFIG`),
            e.g. ``alphas="eb"`` for untuned shrinkage or
            ``contrast_directions=("inc", "dec")`` for the symmetric variant.

    Returns:
        ``{dataset_name: {gene_symbol: {feature_name: value}}}``, or the dense form.

    Deterministic: the same records and config always produce the same floats.
    """
    prior = StratifiedPrior(**{**DEFAULT_CONFIG, **config})
    prior.fit(train)
    return (prior.transform_dense(screens, features) if dense
            else prior.transform(screens, features))


# --------------------------------------------------------------------------- #
# self-check
# --------------------------------------------------------------------------- #

def validation_andcg(prior: StratifiedPrior, feature: str,
                     screens: Sequence[Mapping[str, Any]], k: int = 100) -> np.ndarray:
    """Per-screen AnDCG@k from the upstream metric -- never a reimplementation."""
    from assaybench.benchmark.metrics import RankingMetrics

    metric = RankingMetrics(k_values=[k], metric_groups=["adjusted_ndcg"])
    vals = []
    for s in screens:
        res = metric.evaluate(predicted_genes=prior.rank(s, feature=feature, k=k),
                              ground_truth_genes=s["relevance_genes"],
                              relevance_scores=s["relevance_scores"])
        vals.append(res[f"adjusted_ndcg@{k}"])
    return np.asarray(vals, dtype=np.float64)


def _paired(a: np.ndarray, b: np.ndarray, seed: int = 0, n: int = 10000):
    d = a - b
    rng = np.random.default_rng(seed)
    boot = d[rng.integers(0, len(d), size=(n, len(d)))].mean(axis=1)
    lo, hi = np.percentile(boot, [2.5, 97.5])
    try:
        from scipy.stats import wilcoxon

        p = float(wilcoxon(a, b, zero_method="wilcox").pvalue)
    except Exception:                                            # pragma: no cover
        p = float("nan")
    return float(d.mean()), float(lo), float(hi), p


def _main() -> int:
    from splicr.assaybench_io import load_split

    print("splicr.features.priors -- self-check (validation only; test never loaded)")
    train = load_split(TRAIN_SPLIT)
    val = load_split("validation")
    print(f"  train {len(train)} screens, validation {len(val)} screens")

    prior = StratifiedPrior().fit(train)
    print(f"  config: evidence={prior.evidence} levels={prior.levels} "
          f"alphas={prior.alphas} base_alpha={prior.base_alpha:g}")
    print(f"          contrast={prior.contrast_weight:g} on {prior.contrast_directions}, "
          f"blend_weight={prior.blend_weight:g}")
    print(f"  vocabulary {len(prior.vocab)} genes, pooled hit rate {prior.pooled_rate:.5f}")

    order = ["prior_global_raw", "prior_pheno_exact", "prior_global", "prior_direction",
             "prior_stratum", "prior_contrast_sym", "prior_directed", "prior_blended"]
    per: dict[str, np.ndarray] = {}
    for name in order:
        per[name] = validation_andcg(prior, name, val)
        print(f"    {name:<24} validation AnDCG@100 = {per[name].mean():.5f}")

    # The contrast branch is wrapped in a monotone percentile, so on `increases`
    # screens prior_blended and prior_directed must rank identically.
    inc = [s for s in val if direction_of(s) in prior.contrast_directions]
    same_rank = all(prior.rank(s, "prior_blended") == prior.rank(s, "prior_directed")
                    for s in inc)
    print(f"  contrast branch unchanged by the percentile wrap "
          f"({len(inc)} inc screens rank identically): {same_rank}")

    best = max(per, key=lambda n: float(per[n].mean()))
    print(f"\n  BEST SINGLE FEATURE: {best}  validation AnDCG@100 = {per[best].mean():.5f}")
    if best != BEST_FEATURE:
        print(f"  NOTE: BEST_FEATURE is declared as {BEST_FEATURE!r} "
              f"({per[BEST_FEATURE].mean():.5f}); it is the pre-registered choice and was "
              "selected on validation AND the train-internal temporal holdout, so a "
              "validation-only winner here does not override it.")

    d, lo, hi, p = _paired(per[BEST_FEATURE], per["prior_global_raw"])
    print(f"  {BEST_FEATURE} vs upstream global-hit-freq: delta={d:+.5f} "
          f"95% CI [{lo:+.5f}, {hi:+.5f}]  Wilcoxon p={p:.3e}")
    d, lo, hi, p = _paired(per[BEST_FEATURE], per["prior_pheno_exact"])
    print(f"  {BEST_FEATURE} vs upstream coarse-phenotype:  delta={d:+.5f} "
          f"95% CI [{lo:+.5f}, {hi:+.5f}]  Wilcoxon p={p:.3e}")

    dirs = np.array([direction_of(s) for s in val])
    print("\n  per-direction breakdown (this is where the family's gain lives)")
    for g in ("dec", "inc", "either", "impacts", "na"):
        m = dirs == g
        if not m.any():
            continue
        print(f"    {g:<9} n={int(m.sum()):>4}  ours={per[BEST_FEATURE][m].mean():.5f}  "
              f"upstream={per['prior_global_raw'][m].mean():.5f}")
    print(f"  screens the metric clamps to 0: "
          f"{int((per[BEST_FEATURE] == 0).sum())}/{len(val)}")

    nested = prior.transform(val[:1])
    name0 = str(val[0]["dataset_name"])
    g0 = next(iter(nested[name0]))
    print(f"\n  transform() sample: {name0} / {g0}")
    for kk, vv in nested[name0][g0].items():
        print(f"      {kk:<26} {vv:+.6f}")
    dense = prior.transform_dense(val[:3])
    print(f"  transform_dense() shapes: {[(k, v[1].shape) for k, v in dense.items()]}")

    # determinism
    again = StratifiedPrior().fit(train).transform(val[:1])
    same = all(abs(again[name0][g][f] - nested[name0][g][f]) == 0.0
               for g in nested[name0] for f in FEATURE_NAMES)
    print(f"  determinism (refit + retransform bit-identical): {same}")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__)))))
    raise SystemExit(_main())
