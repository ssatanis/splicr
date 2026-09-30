# Pre-registration — does predicted repair outcome explain which guides work?

Written 2026-09-30, **before any result was computed**. Committed first on purpose: a
correlation this small is findable in noise if the threshold is chosen after looking.

## The question

Sahaj's proposal is that CRISPR cuts DNA and the cell repairs it badly, so "we cut the
gene" is not "we broke the gene", and screen analysis should account for which cuts
actually broke something.

The testable version: **does a sequence-derived prediction of frameshift repair explain
which guides deplete?**

## The instrument, and why not the 124 pairs

The replication benchmark cannot test this. `engine/splicr/replication/dataset.py:505`
requires every pair to use a **different library**, with the stated reason that "two
screens with the same library share guide sequences, so a seed or off-target artifact of
a particular guide replicates. Requiring different libraries means guide-level artifacts
do NOT replicate." It is built to be blind to guide-level properties. Testing a
guide-level signal on it would be a category error, and its ORCS source is gene-level
with no guide sequences at all.

The instrument is instead GSE145743, the one real screen in the database: HeLa,
GeCKOv2 Set A, with plasmid / T0 / DMSO×2 / olaparib×2 samples and 1,550,112 guide-count
rows that join to a sequence at 100% coverage.

## Ground truth

`atlas.gene_stats.is_common_essential` marks 1,034 genes. A cell cannot lose a common
essential gene and keep growing, so **a guide that truly disrupts one must deplete**.
A guide targeting such a gene that does not deplete is a failed knockout — most often
because the repair left the reading frame intact.

That gives a label without needing a second screen.

## The prediction

Sequences here are bare 20bp protospacers. `atlas.guides.cut_pos` is 0 for every GeCKOv2
guide, so there is no flanking genomic context, and proper microhomology scoring
(Bae et al. 2014) is **not possible** — it needs ~60bp around the cut.

What is possible from 20bp is the strongest single published rule: the identity of the
nucleotide immediately 5' of the blunt cut, position 17 of the protospacer. inDelphi,
FORECasT and Lindel all report it as the dominant driver of 1bp insertions, which are
frameshifts by definition. A/T there favours insertion; G/C favours deletion.

This is a **weak proxy for a real repair model, and the result must be read as one.**
A null tells us this proxy carries no signal; it does not prove a full model would fail.

## Primary analysis, fixed now

Per guide: LFC = log2(mean DMSO / mean T0), pseudocount 1, guides with T0 count < 30
dropped as too noisy to interpret.

Restrict to guides targeting `is_common_essential` genes.

**Test:** Spearman correlation between predicted frameshift score and depletion
(negative LFC), across guides.

**Success is declared only if all three hold:**

1. correlation is in the predicted direction — higher frameshift, more depletion
2. p < 0.01
3. |rho| >= 0.05

Threshold 3 exists because with ~3,000 guides a rho of 0.02 will be "significant" and
mean nothing. 0.05 is the floor at which reweighting a hit caller could plausibly move a
gene call.

## Secondary analysis

Within genes whose guides disagree, is the dud guide's predicted score lower than its
siblings'? Wilcoxon signed-rank, paired within gene. Reported regardless of the primary.

## Known confounds, stated now and not controlled

- **Exon position.** Guides in early exons deplete more regardless of repair outcome.
  `cut_pos` is unpopulated for this library so this cannot be controlled. If the primary
  result is positive, position is the first alternative explanation and must be ruled out
  before anything is built on it.
- **Guide efficiency.** Cutting efficiency and repair outcome both depend on sequence.
  A positive result may be measuring efficiency, which is already handled by existing
  tools (JACKS, MAGeCK-NEST).
- **One screen, one cell line, one library.** Nothing here generalises without replication.

## What each outcome means

| Result | Reading |
|---|---|
| Passes all three | The proxy carries signal. Worth testing a real model, and worth a column in the guide chart. |
| Direction right, too small | The effect exists and is not actionable. Do not build. |
| Null or wrong direction | This proxy is empty. Says nothing about a full repair model, but removes the cheap route to it. |

A null is a real result and will be reported as one.
