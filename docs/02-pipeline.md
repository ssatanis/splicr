# The pipeline

Status reviewed 2026-09-27 against `engine/splicr/pipeline.py`. Nine stage names
organize local analysis. Browser upload and queue execution are not connected;
calibrated scoring is skipped. Atlas imports preserve original authors' summaries.
With `--persist`, completed stages record database progress; content-addressed
stage caching and worker orchestration are not implemented.

## 01 Ingest

**Implemented inputs:** local FASTQ(.gz) files or a guide count table, with sample
roles and treatment/control labels. The CLI does not directly ingest an SRA
accession or arbitrary MAGeCK results. Browser resumable uploads are planned.
Malformed, missing, negative, nonfinite and fractional counts fail explicitly.
Design validation checks the declared contrast before analysis. Use explicit
replicate pairing when biological pairs exist; array order alone is not evidence.

## 02 Detect

Library identification uses reference guide sequence overlap and coverage rather
than file names. FASTQ detection samples reads according to `CountConfig`; the
pipeline detects from its first FASTQ or accepts an explicit library. Vector
anchors, offsets and strand are considered; unsupported layouts can still fail.

An archived test fingerprinted 500 sampled Brunello guides with 100% coverage and
decoys below 2%. This establishes that fixture's result, not universal detection
accuracy or robustness to every vector/library.

## 03 Count

Reads are assigned by exact matching with a limited mismatch fallback. Ambiguous
duplicate and near-duplicate guides need explicit handling; they do not establish
unique biological attribution. A common in-memory count matrix feeds subsequent
stages and MAGeCK-format TSV output. The pipeline does not use immutable Parquet
as its count-stage contract. Reference lake Parquet is a separate storage feature.

Count-table input has unknown sequencing read totals and mapping rate. These are
reported as unavailable; observed count totals are retained. FASTQ inputs supply
actual sequencing/mapping information.

## 04 QC

| Metric | Implemented interpretation |
|---|---|
| Gini | Inequality of `log(count+1)`, following MAGeCK; not raw-count Gini |
| Zero fraction, count skew, coverage | Library representation and sequencing/count depth |
| Replicate agreement | Guide-level fold-change agreement against an appropriate reference, with raw count agreement kept distinct |
| NNMD | Median essential/nonessential separation scaled by nonessential MAD |
| Essential-gene AUROC | Fitness-control separation when assay/modality make it applicable |

Thresholds come from `QcThresholds` and applicability checks. They are not fitted
to same-library Atlas distributions. Essentiality controls are inappropriate for
many reporter/activation assays. Declare fitness applicability explicitly when
metadata are ambiguous. A QC failure remains visible even if analysis continues
to produce an explanatory report; absent statistics are not evidence of a pass.

## 05 Call hits

MAGeCK RRA and eligible BAGEL2 analyses produce method-specific columns. DrugZ
is opt-in for a suitable chemogenetic contrast. `--drugz-paired` requires an
explicitly matched treatment/control ordering; the default is unpaired. The
Python MLE interface requires an explicit design matrix and chosen coefficient;
the CLI does not expose those MLE settings yet.

These wrappers are not a fitted consensus probability and do not run all methods
in parallel. CRISPRcleanR and Chronos are not integrated pipeline callers.
MAGeCK positive/negative statistics are retained, with conservative adjustment
when selecting across both directions. Native statistics stay inspectable.
DrugZ preserves the correct FDR tail and exact zero values. Caller failures and
missing outputs must remain visible. Method significance is not validation chance.

## 06 Flag artifacts

Named evidence covers copy-number/neighborhood concerns, guide concentration,
published off-target annotations, multiple target genes, frequent hitters and
poor plasmid representation where the necessary inputs exist. Copy-number
cutting-toxicity warnings apply to cutting assays, not indiscriminately to
CRISPRi/a. Missing copy number or guide annotations limit what can be assessed.

Amplified regions can contain genuine dependencies as well as DNA-cutting
artifacts. A critical warning increases uncertainty; it does not prove the gene
is false. Published annotation agreement verifies import fidelity, not the
sensitivity or specificity of SplicR's biological artifact detection.

## 07 Atlas context

The pipeline loads historical screen evidence and metadata comparability. The
current metadata weights are fixed heuristics, not a trained mechanistic retriever.
Availability and compatibility determine which evidence can be supplied.

AssayBench's oracle selects donors using target answers. Its advantage motivates
research but is not achieved retrieval performance or a universal upper bound.
Historical evidence can be contaminated by the target experiment, related studies
or future releases; publication and temporal audits are required for benchmarking.

## 08 Score

**Current output:** no calibrated validation probability. The stage is explicitly
skipped and confidence fields remain null. A future model needs a specified
independent assay endpoint, consented positive and negative outcomes, and a
separate evaluation cohort. Unvalidated genes cannot be treated as failed genes.

Published validation rates are assay- and selection-dependent. For example,
[Dempster et al.](https://www.nature.com/articles/s41467-019-13805-y) reported
precision 0.255 at recall 0.781 in a particular selective-dependency comparison
before batch correction; that is not a universal chance a CRISPR hit validates.
See [the scientific review](../research/02_SCIENTIFIC_RESEARCH.md).

## 09 Report

Local execution writes `postscreen_report.json` with observed statistics, QC,
flags, missing-evidence information and provenance. Optional persistence writes
run/hit records. Authenticated screen details display recorded workspace data;
illustrative reports are restricted to explicit demo contexts.

A complete workspace PDF/export and experimental validation-plan workflow is not
implemented. Database runs have identities, but reusing a local work directory
can replace files: choose distinct directories and retain input/output hashes
when archiving a scientific analysis. Do not infer immutable local reports from
the existence of version columns in the schema.
