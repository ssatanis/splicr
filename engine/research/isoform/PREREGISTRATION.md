# Pre-registration — does isoform inclusion explain which guides work?

Written 2026-09-30, **before any outcome was computed**. The predictor's own
distribution was inspected first (see "Power", below) because the thresholds
have to be set against a real sample size; no efficacy, fold change or screen
data was touched until this file was committed.

This is the second claim in the same family to be tested, and the first one
failed. That history is the reason for the bar set here.

## What already failed, and why this is not the same claim

`engine/research/frameshift/` tested whether a *repair-outcome* prediction
explains which guides deplete. Two independent instruments say no:

- predicted frameshift vs DepMap Chronos empirical guide efficacy, 67,225
  uniquely-aligning Avana guides: Spearman **+0.0108**. Plain GC content scores
  **+0.0839** on the same guides — eight times better. Controlling for GC the
  residual is +0.0142, so it is real and not a composition artifact; it is
  simply ~0.02% of variance.
- within-gene guide LFC over 60 Avana-4 screens: the pre-declared *null* test
  (non-essential genes, expected ~0) came out at **+0.105**, larger than the
  mechanism test's −0.072. A signal smaller than its own control is not a signal.

A third result bounds the whole approach: rank-normalised weighting of per-gene
guide means was tested on 100 individually-scored Avana-4 screens with three
priors, and **all three degrade** essential/non-essential separation — including
RS3, which genuinely predicts efficacy (Spearman +0.122 vs Chronos, ~6x
frameshift). With ~4 guides per gene, unequal weights cost effective sample size
faster than they remove bias.

The best available explanation is that a 21-day pooled screen integrates repair
outcome away: Cas9 re-cuts an in-frame-repaired site until the frame shifts or
the site is destroyed, so the per-cut in-frame fraction stops mattering.

**Isoform evasion is a different object.** It does not predict how a break was
repaired; it asks whether protein-coding sequence was present at the cut at all.
Re-cutting cannot rescue it — cutting a skipped exon a thousand times leaves the
expressed protein unchanged. And it is a *filter*, not a weight: it proposes to
remove guides that cannot produce a coding change, which does not pay the
variance cost that sank the weighting layer.

None of that makes it true. It makes it worth one honest test.

## Instrument and predictor

Same instrument as the failed test, deliberately, so the results are comparable:
**DepMap 26Q1 Chronos `guide_efficacy.csv`**, an empirical per-guide efficacy
inferred from 1,208 cell lines, joined to the 67,225 Avana guides that align
uniquely, carry no DepMap DropReason, and place on hg38 with a verified cut.

Predictor: `splicr.validate.isoform.inclusion()`. For a cut at `chrom:pos` in
gene G, over every protein-coding transcript of G in Ensembl 116:

    coding_fraction = transcripts whose CDS covers the cut / all transcripts
    exonic_fraction = transcripts whose exons cover the cut / all transcripts

This is the **annotation-only** version. The cell-line-aware version weights
each transcript by its expression in that line and is the claim that names a
cell line; it needs transcript-level RNA-seq, and the 26Q1 drop on disk is the
partial Chronos-only Figshare release with gene-level TPM only. Chronos efficacy
is itself pooled across lines, so the annotation-only predictor is the matched
one for this test. **A null here does not refute the cell-line-aware claim**,
and a positive result here does not establish it.

## Power

Measured before setting thresholds, outcome-blind:

- 67,225 guides, 17,639 genes; 99.77% of gene symbols resolve in Ensembl 116.
- `coding_fraction`: 40.1% exactly 1.0 (constitutive), median 0.92,
  **3.3% below 0.5** (~2,200 guides), **0.0% exactly 0**.

The zero-percent matters and is reported as a finding regardless of what
follows: no Avana guide cuts outside the coding sequence of every transcript.
The dramatic version of this failure mode — "the guide cuts nothing" — does not
occur in a professionally designed library. Whatever is being tested here is the
graded version, on ~2,200 guides against ~27,000 constitutive ones.

## Tests and thresholds, fixed now

**1. Mechanism.** Spearman(`coding_fraction`, Chronos efficacy) across all
joined guides. Direction: **positive** (a cut in more of the gene's coding
output is a more effective guide).

Passes only if all three hold:

1. the correlation is positive
2. p < 0.01
3. rho >= 0.05

Threshold 3 is the same floor the frameshift pre-registration used, for
comparability.

**2. Beats the free baseline.** rho must exceed **+0.0839**, GC content's score
on the identical guide set. A predictor that needs a genome annotation, an exon
model and a transcript set, and loses to counting G and C, is not worth a
pipeline stage. This is the bar that decides whether anything ships.

**3. Not a composition artifact.** Partial Spearman controlling for GC must
retain >= 60% of the raw rho. (The frameshift residual survived this and was
still useless, so passing is necessary, not sufficient.)

**4. Contrast.** Mean efficacy of `coding_fraction < 0.5` vs `== 1.0`,
Mann-Whitney. Expected: the low group lower. Reported with effect size in sd;
**>= 0.2 sd** to count as practically meaningful.

**5. The product claim — does filtering help?** On individually-scored Avana-4
screens, essential/non-essential separation (NNMD and AUROC, Hart CEGv2/NEGv1)
computed from a plain per-gene mean of guide LFCs, with and without guides whose
`coding_fraction < 0.5` excluded. A gene keeps at least 2 guides after filtering
or it is dropped from both arms. Passes only if the median change improves NNMD
**and** it improves on **> 50%** of screens. This is the only test whose result
determines whether the pipeline changes.

Test 5 can fail while 1-4 pass — removing 3.3% of guides costs sample size, the
same arithmetic that sank the weighting layer. If it does, the honest output is
annotation shown to a reader, not a filter applied to a count matrix.

## Known limits, stated now

- **Annotation-only, one library, one efficacy estimate.** See above.
- **Ensembl annotates transcripts, it does not weight them.** A gene with 34
  annotated transcripts, most of them lowly expressed fragments, gets a
  `coding_fraction` that reflects the annotation's granularity as much as the
  cell's biology. This is the single largest weakness of the annotation-only
  version and it biases toward the null in an unknown amount.
- **Avana's designers already avoided this.** Guides were selected against CDS,
  so the range being tested is narrow by construction. A null here is evidence
  about well-designed libraries, not about custom ones — which is exactly where
  the Phase 2 extractor will send us, and where the check may matter more.
- **Confounded with exon position.** Alternative exons are enriched at gene
  ends, and cuts near the stop codon are weak for an unrelated reason (NMD
  escape). `protein.locate()` returns CDS fraction; if test 1 passes, this
  confound must be controlled before anything is built on it.

## What each outcome means

| Result | Reading |
|---|---|
| 1-4 pass and 5 passes | Filter ships, behind the measured numbers. |
| 1-4 pass, 5 fails | Real, and annotation only. Show it in the hit report; do not touch the counts. |
| 1 or 2 fails | Annotation-only isoform inclusion does not explain guide efficacy. Says nothing about the cell-line-aware version, which needs data not on disk. |

A null is a real result and will be reported as one.
