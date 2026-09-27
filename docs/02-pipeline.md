# The pipeline

Nine stages. The same nine run on an uploaded screen and on every public screen
in the Atlas, which is what makes the numbers comparable.

Each stage reads the previous stage's artifact, writes its own, and records a
row in `run_stages`. Nothing is recomputed unless its inputs changed.

---

## 01 Ingest

**In:** FASTQ(.gz), a count table, MAGeCK output, or an SRA accession.
**Out:** a screen with files, samples and a proposed design.

Files go straight to object storage in 6 MB resumable chunks, so a dropped
connection costs one chunk and not the whole upload. Checksums are recorded on
arrival; the engine verifies them before counting.

## 02 Detect

**In:** the first 200,000 reads of each file, or the guide column of a table.
**Out:** a library call with a match rate, guide offset and strand.

Library identification is by **sequence-set overlap, not file name**. Guides are
matched against every library in the Atlas and ranked by what fraction of the
candidate library was hit. Ranking by coverage rather than raw intersection
matters because composite libraries such as MinLibCas9 borrow guides from four
parents and would otherwise outrank all of them.

Guide position is found by scanning for the vector anchor upstream of the
spacer, not by assuming a fixed offset. Staggered primers shift the spacer by
0, 1, 2, 3, 4, 6, 7 or 8 bases, so a hardcoded trim loses most reads. Note that
TKOv3's pLCKO2 backbone uses a different anchor from lentiGuide, and that a
plain `--trim-5` will silently fail on it.

*Validated: 500 random Brunello guides fingerprint to Brunello at 100%, with
every decoy library under 2%.*

## 03 Count

**In:** reads plus the detected library.
**Out:** a guide by sample count matrix, plus a mapping summary.

Exact match first, then a single-mismatch fallback. Mismatch tolerance is
deliberately limited: several libraries contain duplicate or near-duplicate
sequences, and a permissive aligner assigns those reads arbitrarily.

Counts are produced once and stored as Parquet. Every later stage reads the
same matrix, so two stages can never disagree about a count.

## 04 QC

**In:** the count matrix, the design, and essential/nonessential gene sets.
**Out:** per-sample and per-screen verdicts.

| Metric | Definition | Guide |
|---|---|---|
| Gini index | Inequality of guide counts, on `log(count+1)` | ~0.1 plasmid, 0.2 to 0.3 at endpoint |
| Zero fraction | Guides with no reads | Under 1% |
| Mapping rate | Reads assigned to a guide | At least 60% |
| Skew ratio | 90th over 10th percentile guide count | Under 10 |
| Replicate r | Pearson on log counts | Compare against the Atlas, not a fixed number |
| NNMD | `(median(ess) - median(non)) / MAD(non)` | At most -1.25 |
| AUROC | Essential vs nonessential separation | Higher is better |

The Gini definition matters: MAGeCK computes it on `log(count+1)`, so a Gini
computed on raw counts is much higher and not comparable to the usual
thresholds.

Every metric is also compared against the Atlas distribution **for the same
library**, so "high" means high for that library rather than in the abstract.
This matters more than it sounds: across cell lines screened with more than one
library, library choice has been reported to outweigh both cell line and
culture medium in its effect on gene scores, and guides that were
under-represented in the plasmid pool produce more extreme and more variable
results (*BMC Genomics* 2026). Per-guide plasmid abundance is therefore carried
forward as a scoring covariate, not just used as a QC filter.

## 05 Call hits

**In:** the count matrix, design and control guides.
**Out:** one consensus table with each method's statistics side by side.

MAGeCK RRA and MLE, BAGEL2 Bayes factors, DrugZ where the design is
chemogenetic, and CRISPRcleanR copy-number correction when guide coordinates
are known. Methods run in parallel and are never silently overwritten: each
gets its own columns, and disagreement between them is a signal worth showing.

## 06 Flag artifacts

**In:** the hit table, guide coordinates and Atlas hit frequencies.
**Out:** named flags with evidence.

| Flag | What it catches |
|---|---|
| Copy-number cluster | Neighbouring genes in an amplified segment depleting together |
| Single guide | One guide carrying most of the gene-level effect |
| Promiscuous guide | A guide with many perfect genomic matches |
| Multi-gene guide | A guide that perfectly targets more than one gene |
| Frequent hitter | A gene that hits across many unrelated screens |
| Bottleneck | Signal concentrated in a replicate that lost guides |

Copy-number artifacts are real and large: guides in amplified regions deplete
because of DNA damage, not biology, and unexpressed genes in those regions
score as lethal. About 5.4% of Avana guides perfectly target more than one
gene, so a gene-level call can belong to its neighbour.

## 07 Atlas context

**In:** screen metadata and the hit profile.
**Out:** nearest public screens, plus each hit's history and novelty.

This is the stage that justifies the whole product. On a public benchmark,
retrieving the right past screen scores about 1.8 times the best language
model, while retrieving by text similarity scores far below both. The
information is in the screens; the difficulty is finding the right one.

## 08 Score

**In:** statistics, flags, Atlas features and logged validation outcomes.
**Out:** a calibrated chance, a band, and the reasons behind it.

Calibration is the point. When the model says 80%, about 8 in 10 of those hits
should validate. The model is trained on outcomes labs logged, and retrained as
more arrive. A score without a calibration curve is not shipped.

**Validation probability is conditional, not a single number.** An LDL-uptake
screen found that the secondary-screen validation rate was strongly correlated
with the strength of the primary signal, reported stratified by FDR tier
(*PLoS Genet* 2021, PMC7875399). So the model fits a curve against primary
effect size and FDR, never one global rate. Published rates vary widely for
exactly this reason: 66% in an arrayed dynein-transport screen against 50% for
a prior screen using a subset of the same library (*J Cell Biol* 2024,
PMC10916854), and 88% for HIV-1 host factors (*mBio* 2023, PMC9973025).

The honest baseline to beat: between two well-run genome-wide screens of the
same gene in the same cell line, a dependency called by one is confirmed by the
other only about a quarter of the time at matched recall (precision 0.255 at
recall 0.781, Cohen's kappa 0.737 over 1,031 jointly called dependencies).
That is a *marginal* figure across all effect sizes. The conditional curve is
what the model actually fits, and it sits well above that floor at the top of
the ranking.

## 09 Report

**In:** everything above.
**Out:** an interactive report, a PDF, a CSV, and a validation plan.

Reports are versioned. Re-running a screen never overwrites what a lab already
cited.
