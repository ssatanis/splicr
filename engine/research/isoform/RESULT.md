# Result — isoform inclusion does not explain which guides work

Ran 2026-09-30 against the thresholds in `PREREGISTRATION.md`, committed first
(667bcda). **1 of 5 tests passes, and it is the one that only rules out a
confound.** Artifact: `research/artifacts/validate/isoform_benchmark.json`.

Instrument: 67,073 Avana guides that align uniquely, carry no DepMap
DropReason, place on hg38 with a verified cut, and resolve to a protein-coding
gene in Ensembl 116. Outcome: DepMap 26Q1 Chronos `guide_efficacy`.

## Pre-registered tests

| # | Test | Result | Bar | |
|---|---|---|---|---|
| 1 | Spearman(coding_fraction, efficacy) | **−0.0074** | positive, p<0.01, rho≥0.05 | FAIL |
| 2 | Beats GC content | −0.0074 vs GC **+0.0840** | rho > 0.0839 | FAIL |
| 3 | Not a GC artifact | partial −0.0159, retains 100% | ≥60% retained | pass |
| 4 | Low vs constitutive contrast | **+0.105 sd** | ≥0.2 sd, p<0.01 | FAIL |
| 5 | Filtering improves a real screen | **dNNMD +0.0127**, better on 35/100 | improves, >50% of screens | FAIL |

Test 3 passing means only that the (absent) effect is not GC-mediated. It is
the same result frameshift got and carries the same weight: none.

## The one interesting thing, and why it is not a finding

Pooled, efficacy rises monotonically across the graded range and then falls at
exactly 1.0:

| coding_fraction | n | mean efficacy | mean GC |
|---|---|---|---|
| <0.25 | 560 | 0.8290 | 0.542 |
| 0.25–0.5 | 2,857 | 0.8578 | 0.525 |
| 0.5–0.75 | 10,782 | 0.8661 | 0.526 |
| 0.75–0.9 | 16,322 | 0.8712 | 0.527 |
| 0.9–1.0 | 9,001 | 0.8736 | 0.534 |
| **=1.0** | **27,551** | **0.8654** | 0.551 |

A 4.5-point spread from worst to best band is four times what frameshift
managed, and it looks like a dose-response. It is not.

The `=1.0` bin is 41% of the data and mixes two different things: a
constitutive exon in a well-annotated 34-transcript gene, and a gene with one
annotated transcript where the fraction is 1.0 by definition. Stratifying by
transcript count (post-hoc, and labelled as such) removes the effect entirely:

| stratum | n | rho(coding_fraction, efficacy) | p | rho(GC) |
|---|---|---|---|---|
| n_transcripts = 1 | 4,492 | −0.0052 | 0.73 | +0.0895 |
| n_transcripts ≥ 2 | 62,581 | **−0.0018** | 0.66 | +0.0840 |
| n_transcripts ≥ 5 | 52,061 | +0.0035 | 0.42 | +0.0829 |
| n_transcripts ≥ 10 | 35,923 | +0.0034 | 0.52 | +0.0762 |

Flat everywhere, at n = 62,581. The band table was measuring which *genes* have
low inclusion, not what a low-inclusion cut does to a guide. GC content holds at
+0.08 in every stratum, which is the honest comparison: the free baseline beats
the annotated predictor in every subgroup.

## Test 5 in detail

Excluding guides with `coding_fraction < 0.5` removed 33 of 5,112 guides over
1,362 essential/non-essential genes (genes keeping <2 guides were dropped from
both arms, so the comparison cannot be won by dropping genes). Median NNMD moved
**+0.0127 — the wrong way** — and improved on 35 of 100 screens; AUROC improved
on 21. Baseline NNMD −6.324, AUROC 0.9799, so unlike the earlier 60-screen
averaged comparison there was real headroom here and the filter did not use it.

## What this does and does not settle

**Settles:** annotation-only isoform inclusion, computed from Ensembl 116 over
all protein-coding transcripts, does not predict guide efficacy and does not
improve screen separation. Do not weight by it, do not filter on it.

**Also settles, and worth stating on its own:** 0.0% of Avana guides cut outside
the coding sequence of every annotated transcript. The vivid version of this
failure — "the guide cuts nothing" — does not occur in a professionally designed
library. That is why the effect being looked for is small: the designers already
removed it.

**Does not settle:** the cell-line-aware claim, which is the one in the brief —
"this line predominantly expresses the exon-2-skipped isoform, so this guide
cannot work *here*". That needs transcript-level RNA-seq per line. The 26Q1 drop
on disk is the partial Chronos-only Figshare release with gene-level TPM only,
so it was never tested. `isoform.inclusion()` takes an `expression` argument and
reports `expression_weighted` so the two claims can never be confused in output.

Testing it properly needs `OmicsExpressionTranscriptsTPMLogp1Profile`, and the
matched outcome is not pooled Chronos efficacy but per-cell-line guide LFC,
compared within gene across lines that differ in isoform usage. That is a real
experiment and it is not done here.

**A prior that survives:** RS3 predicts Chronos efficacy at +0.122 — six times
frameshift, 1.5x GC. It still degraded separation when used as a weight, because
with ~4 guides per gene unequal weights cost effective sample size faster than
they remove bias. The bar for any per-guide prior is therefore not "real" but
"strong", and nothing tested so far clears it.
