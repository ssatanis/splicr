# 18 · Biophysical guide validation: what was built, and what the data said

Status 2026-09-30. Code: `engine/splicr/validate/`. Artifacts:
`research/artifacts/validate/{benchmark_avana,weighting_comparison}.json`.
Reproduce with the commands at the end.

## The proposal

Replace read-count statistics with a deterministic biophysical layer. For every
guide, predict how the cell repairs the Cas9 break; where repair is predicted to
restore the reading frame, check whether the surviving protein keeps its active
site; down-weight guides that were predicted not to destroy the protein; and
report a "TrueKnockout" score that tells a lab which of its MAGeCK calls are
artifacts of poor reagents rather than biology.

The premise, stated plainly, is that a substantial share of screen results are
wrong because in-frame repair left the protein intact.

**The premise was tested against the largest dataset available and it did not
hold.** The infrastructure was built, the test was pre-specified, and the result
is negative. This document records it, because the alternative is shipping a
score that sounds authoritative and changes nothing.

## What was built

| Module | What it does | State |
|---|---|---|
| `validate/genome.py` | Places a guide on hg38 by searching for its own sequence near the stated coordinate, then cuts the 60 bp window a repair model needs. Refuses rather than guesses when the guide or its NGG PAM is not found. | Verified |
| `validate/repair.py` | Lindel (Chen et al. 2019, MIT, commit `fdcad58`), vendored and pinned. Returns the frameshift fraction and the in-frame deletion spectrum. | Verified |
| `validate/protein.py` | MANE Select CDS from the Ensembl 116 GTF turns a cut into a codon index; UniProt curated residue features say whether an in-frame deletion removes a catalytic or structural residue. | Verified |
| `validate/benchmark.py` | The falsification harness: a mechanism test, a specificity test with an expected-null, and a practical test. | The point of the exercise |

Correctness checks that passed, and are worth keeping regardless of the verdict:

- Guide placement reproduces the library's own annotation exactly. Brunello
  76,441/76,441 placed, cut position exact for all, and Brunello's published
  30 bp context reproduced for all. Avana 67,225/67,225 uniquely-aligning guides.
- CDS mapping reproduces canonical protein lengths: TP53 393 aa, PARP1 1014 aa,
  BRCA1 1863 aa, ERBB2 1255 aa.
- UniProt joins land on the right residues: PARP1's catalytic site at E988,
  TP53's zinc-coordinating C176/H179/C238/C242.

## Test 1 — repair prediction against measured guide efficacy

DepMap fits a per-guide efficacy term inside Chronos from thousands of screens.
It is the best empirical estimate available of how well each guide actually
worked, and it is independent of anything computed here. 67,225 uniquely
aligning Avana guides, merged on sequence.

| Predictor | Spearman vs measured efficacy |
|---|---|
| Lindel predicted frameshift | **+0.0108** (p = 5e-3) |
| Guide GC content | +0.0839 |
| Rule Set 3 on-target activity | **+0.1220** (p = 2.4e-21) |

Mean efficacy across frameshift deciles moves from 0.8614 to 0.8710: one
percentage point across the model's entire range. Comparing the extremes,
frameshift < 0.55 (n = 1,047, mean efficacy 0.8667) against frameshift > 0.90
(n = 3,029, 0.8739), gives Mann-Whitney p = 0.70 and a difference of 0.045
standard deviations.

Plain GC content predicts real guide efficacy roughly eight times better than
the repair model does.

The residual correlation is real rather than a composition artifact: partial
Spearman controlling for GC is +0.0142 (p = 2.3e-4), slightly larger than the
raw value. It is detectable because n is 67,000, and it is two orders of
magnitude too small to move a gene call.

## Test 2 — does weighting by any prior improve a real screen?

The question a lab cares about is not whether a prior correlates with something,
but whether using it makes their screen better. 100 individual Avana-4 screens,
each scored on its own against the matched plasmid pool, essential (CEGv2)
versus non-essential (NEGv1) separation before and after weighting the per-gene
mean of guide fold changes. Each prior is rank-normalised so only its ordering
matters. Baseline: NNMD −6.28, ROC AUC 0.9788.

| Prior | ΔNNMD (median) | Screens improved | ΔAUROC (median) | Screens improved |
|---|---|---|---|---|
| Rule Set 3 | +0.239 | 18/100 | −0.0020 | 6/100 |
| Lindel frameshift | +0.192 | 16/100 | −0.0047 | 2/100 |
| GC content | +0.378 | 2/100 | −0.0041 | 3/100 |

NNMD is better when more negative, so every entry is a degradation. **All three
priors make the average screen worse, on both metrics, on the large majority of
screens** — including Rule Set 3, the one prior that genuinely predicts measured
efficacy.

This is the ordinary bias-variance trade. An Avana gene has about four guides.
Unequal weights shrink the effective sample size immediately, while the bias
they remove is proportional to how well the prior ranks guides. At Spearman
≈ 0.12 the prior is far too noisy to repay the variance it costs. The bar for
shipping per-guide weighting is therefore not "the prior is real" but "the prior
is strong", and Rule Set 3 is real and still not strong enough.

## Why the premise fails, mechanistically

Cas9 is not a single event. A site repaired in-frame is still a substrate: the
protospacer and PAM survive, so Cas9 cuts it again, and again, across three
weeks and many divisions, until the frame shifts or the site is destroyed. A
pooled screen reads out a whole population integrated over that entire period.
The per-cut in-frame fraction is therefore largely saturated away by the time
anything is measured, which is exactly what the measured efficacy data show.

What limits a guide is whether it cuts well at all — chromatin state, guide
expression, on-target activity — not how a given break is resolved. That is why
Rule Set 3 and even bare GC content outrank the repair model here.

This argument does not apply to every use of repair prediction. It applies to
21-day pooled dropout screens, which is what SplicR ingests. Short-timecourse
experiments, single-cut editing and base editing are different regimes.

## What this does not say

- It does not say Lindel is wrong. Lindel predicts repair outcome distributions
  and was validated for that; it is being asked here for something else.
- It does not say in-frame repair never matters. It says the effect is not
  detectable in the outcome of a pooled screen at n = 67,000 guides.
- The 60-screen averaged comparison in `benchmark_avana.json` is reported for
  completeness but carries no weight in either direction: its baseline ROC AUC
  is 0.9980, leaving 0.002 of range, so it could not have shown an improvement
  had there been one. The load-bearing evidence is Test 1 and Test 2.
- The specificity failure in the averaged run (Spearman +0.105 on non-essential
  genes, where the expectation is zero, larger than the +0.072 mechanism signal)
  is unexplained. It is fatal to the weighting proposal either way, but the
  confound behind it has not been isolated.

## What is worth keeping

- **The falsification harness.** SplicR can now take any proposed per-guide
  correction and measure it against 67,225 guides with independent ground truth
  and 100 screens with real endpoints, in minutes. That is the durable asset
  from this work: most labs cannot refute their own method at this scale, and
  this one refuted a method its own authors wanted to be true.
- **Guide placement and the repair/protein annotation layer**, which are correct
  and are inputs to anything sequence-aware: off-target analysis, isoform
  reasoning, and explaining a hit to a reader. They are annotation, not a
  correction to the statistics.
- **Rule Set 3 as a design-time tool.** It predicts efficacy well enough to rank
  guides when *designing* a library, which is a different job from re-weighting
  an experiment that already happened.

## Test 3 — the filter version is null too (isoform evasion)

Run by the parallel Engineer 3 session, pre-registered, artifact
`research/artifacts/validate/isoform_benchmark.json`. If a guide cuts an exon
the cell does not include in its transcripts, it cannot change the protein, and
re-cutting cannot rescue it. That is a filter rather than a weight, so the
bias-variance argument above does not automatically apply.

It is still null. Spearman(coding fraction, measured efficacy) = −0.0074 over
67,073 guides, against GC's +0.0840 on the identical set. Excluding guides with
transcript inclusion below 0.5 from 100 individually scored screens moved median
NNMD by +0.0127, the wrong direction, improving only 35/100 — and here there was
headroom (baseline NNMD −6.324, AUROC 0.9799). Removing 33 of 5,112 guides still
cost more than it bought. **Filters lose here for the same reason weights do.**

One fact stands on its own: **0.0% of Avana guides cut outside the coding
sequence of every annotated transcript.** The vivid failure mode does not occur
in a professionally designed library. That is why the remaining headroom is
small — and why this check may still matter for the custom, unvetted libraries
the library extractor will ingest.

### The trap in this family of claims

Pooled, measured efficacy rises monotonically with transcript inclusion: 0.829,
0.858, 0.866, 0.871, 0.874. A 4.5-point spread, four times what frameshift
managed, and it reads exactly like a dose-response. It is entirely between-gene.
The inclusion = 1.0 bin holds 41% of the data and silently mixes constitutive
exons in well-annotated genes with single-transcript genes where the fraction is
1.0 by definition. Stratify by transcript count and the effect is −0.0018
(p = 0.66, n = 62,581), flat in every stratum, while GC holds at +0.08
throughout.

A banded table with a monotone trend and no stratification is how this whole
family of claim keeps surviving. That is the general lesson, and it is why every
test in this document is specified with an expected direction, a null arm, and a
within-gene comparison before it is run.

## What to try instead

A filter is not a weight. The result above is specifically about re-weighting a
noisy average. A categorical statement that a particular guide *cannot* have
produced protein loss in a particular cell line — it cuts an exon that line does
not express, or a transcript it does not use — removes a guide that carries no
signal rather than down-weighting one that carries some. That is a different
statistical object and is not refuted by anything here. It was tested
separately under the same discipline, and Test 3 above reports the result: also
null, on an annotation-only version. A cell-line-aware version, which is the
claim as originally stated, is still open.

## Reproduce

```bash
scripts/data/fetch-genome.sh                                    # hg38 + faidx
engine/.tools/env/bin/python scripts/data/build-guide-validation.py avana
engine/.tools/env/bin/python scripts/research/validate-benchmark.py --samples 60
engine/.tools/env/bin/python scripts/research/validate-weighting.py --screens 100
```

## Credit

The replication of Test 1 on an independent code path, the partial-correlation
correction that showed the residual is not a GC artifact, the observation that
the 60-screen arm is at ceiling, and the BLAS-oversubscription finding in
`predict_many` are all from the parallel Engineer 3 session.
