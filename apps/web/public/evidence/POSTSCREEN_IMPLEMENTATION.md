# Post-screen reliability implementation and measured audit

Date: 2026-09-27. This work concerns **Track B, analysis of observed screen counts**. It does not change or measure AssayBench pre-screen performance. No production database was modified. No calibrated validation probability was fitted or claimed.

## Implemented changes

| Confirmed problem | Implemented behavior | Verification |
|---|---|---|
| Count ingestion converted nonnumeric values to zero, truncated fractional values, accepted negatives and ragged rows | Explicitly reject missing, nonfinite, negative and fractional counts; require unique nonempty sample and guide identifiers and exact row widths. Use decimal parsing to preserve large integer values. Valid quoted CSV and gzipped TSV remain supported. | Parser regression fixtures and the real 123,411-guide GEO table |
| DrugZ used `fdr_supp or fdr_synth`, losing exact zero and selecting the wrong tail for negative effects | Select synthetic FDR for negative normZ, suppressor FDR for positive normZ, and no directional FDR for zero/missing normZ. Missing tool/output raises an inspectable tool warning. | Exact-zero/sign/missingness regressions; real DrugZ execution |
| Paired DrugZ assumed treatment/control list order represented biological pairing | Default to the official unpaired mode. Explicit pairing is available and requires equal group sizes. Main pipeline/CLI now expose DrugZ and its pairing declaration. | Command-contract regressions; paired/unpaired sensitivity analysis on GEO counts |
| Selecting minimum of two MAGeCK directional FDRs was labeled unrestricted gene-level FDR | Preserve both native directional p-values and FDRs, and report `min(1, 2*min(q_depleted,q_enriched))` for the union of both discovery families. Omnibus p-value is separately `min(1,2*min(p_depleted,p_enriched))`. | Hand-calculated regression and real MAGeCK integration; abandoned pooled-BH alternative documented below |
| `run_mle=True` did nothing; parsing could pair a beta with another condition's FDR | Require an explicit design matrix, actually execute MAGeCK MLE, require coefficient selection when ambiguous, and pair beta/FDR from the same coefficient. | Execution/merge and multi-coefficient fixture tests. Full MLE fitting was not independently benchmarked. |
| Essential-gene enrichment universally rejected a contrast, including drug comparisons and CRISPRa | Main pipeline applies inversion checks and BAGEL2 only to a declared loss-of-function fitness endpoint versus library reference. Essentiality QC is not used to judge reporter/activation/unspecified assays. | Explicit fitness/nonfitness/modality regression scenarios |
| Copy-number cutting warnings were applied to CRISPRi/a and enriched genes; linear ratios were called absolute copies | Cutting-toxicity warnings apply to depleted nuclease-knockout effects; report relative CN ratios and explicitly preserve the possibility of a genuine amplified dependency. Missing per-gene CN can use a labeled positional warning. | Modality/sign/nonfinite-CN regressions |
| A full library's unused guides could be presented as the screen's off-target evidence | Pipeline passes the actually represented guide IDs to artifact assessment. Multiple genomic sites are described as genomic sites, not automatically multiple genes. | Focused-library regression |
| Persistence classification called any critical risk flag a proven artifact | Critical flags now map to `uncertain`, including when confidence is missing or high. Genuine amplified dependencies are not classified as artifacts solely from a CN warning. | Pure-function verdict regression; no database access |
| QC claimed bottlenecked samples were downweighted, although no weights changed | State that counts are retained and recommend inspection/sensitivity analysis. | Code audit; no weighting model claimed |
| Count-only QC fabricated a 100% mapping fraction and sequencing read total from retained counts | Unknown mapping fraction and total sequenced reads now remain null, with `mapping_rate_available=false`, `mapping_source=count_table`, observed count sum and an explanation. Actual read-counting summaries retain measured fractions; zero-read fractions are undefined. Nullable existing database fields preserve this distinction, including on update. | Count-only, observed-read, zero-read, serialization and fake-database-writer regression checks |
| Pipeline failures were attributed to the last completed stage | Track the active stage and append a failed-stage record. | Failure injected during detection is correctly labeled `detect` |
| Reports lost native directional statistics in database schemas without matching columns | Write `postscreen_report.json` atomically for every successful local/persistent pipeline run; include gene effects, native/adjusted statistics, guide evidence, flags, Atlas contexts/comparable screens, QC, methods, and tool output directory. Validation probability is null with a reason. | Portable-report integration regressions |

CLI additions are `--modality knockout|inhibition|activation`, `--condition`, `--fitness-assay` / `--no-fitness-assay`, `--drugz`, and `--drugz-paired`. Unknown phenotype does not silently imply a fitness assay. Existing direct `screen_qc` calls retain their default essentiality behavior; pipeline calls now supply the context explicitly. Direct `call_hits` clients must declare `essentiality_contrast=True` to request the inversion guard.

The report is a backend artifact. No claim is made that the web Hit Report UI already renders these new fields. The existing database columns do not store all native directional/MLE/DrugZ statistics; the JSON artifact preserves them without a migration.

Portable reports also record SHA-256 hashes of the six analysis modules (`pipeline`, `hits`, `count`, `qc`, `artifacts`, `atlas`), the generated analyzed count table, and the declared requirements file, together with the Python version. Missing count files are explicitly unavailable; no input hash is fabricated. Hashing uses the generated count table and does not rescan FASTQs. The requirements hash identifies declared pins, not proof that the installed environment exactly matches them.

## Why the two-family correction is defensible

Let the depleted and enriched procedures each operate at threshold α/2. If each directional procedure controls its own expected false-discovery proportion at α/2, the union has FDR no greater than their sum. Its discovery count is at least each individual family's count, and its false discoveries are at most the sum of the individual false discoveries. This argument does not require independent tails. The reported doubled minimum q-value implements that allocation.

This is conditional on the native method's statistical assumptions and calibration. It does not turn an adjusted p-value into the probability that a gene is real, prove that the chosen direction is biologically correct, or certify all dependency assumptions. The resulting calls can be more conservative. Native values remain inspectable.

MAGeCK documents separate negative and positive gene p-values/FDRs and coefficient-specific MLE outputs in its [official output specification](https://sourceforge.net/p/mageck/wiki/output/). DrugZ's [official implementation](https://github.com/hart-lab/drugz/blob/master/drugz.py) assigns synthetic and suppressor tails from normZ and distinguishes paired/unpaired modes. These were checked against the installed implementations, not inferred from function names.

## Adversarial iteration: rejected pooled-BH variant

An initial candidate computed a Bonferroni omnibus p-value per gene and then applied BH across genes. The arithmetic matched the intended formula, but the existing real-tool integration revealed a consequential tradeoff: numerous depleted discoveries let the pooled family borrow power for enriched genes with weak native directional FDRs.

On the unchanged deterministic synthetic fixture (500 selected Brunello genes; 1,998 guides; five sequenced sample files), the original native minimum-FDR rule called 89 genes and zero planted nonessential genes at 0.1. The pooled variant called 81 genes including four planted nonessentials, whose native enriched FDRs were 0.70–0.87. Precision@100 was 0.90. This does not by itself mathematically disprove overall FDR control; 4/81 is below 0.1. It failed the repository's zero-nonessential integration gate and introduced a less interpretable change of statistical family.

The retained two-family correction preserves native directional calibration. On the same fixture it called 77 genes, zero planted nonessentials, and precision@100 was 0.97. Every existing end-to-end assertion passed. These planted controls test software wiring; they are not prospective biological performance or evidence of a 97% real-world validation rate.

## Published observed-data audit

Source: [GSE145743](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE145743), authors' processed Human GeCKOv2 A+B olaparib-versus-DMSO counts. The file combines the two half libraries and was subsampled by the original study, so this run does not claim to reproduce raw FASTQ depth.

Input SHA-256: `a14192f5d84a23f08aaaa5dad5e253ffaf5e03e92b4a3a83eeacc628e13edb00`.

| Measured result | Value |
|---|---:|
| Guide rows | 123,411 |
| MAGeCK gene rows | 21,524 |
| Original minimum native directional FDR <0.1 | 39 |
| Corrected two-family FDR <0.1 | 22 |
| Paired DrugZ sensitizers/suppressors at directional FDR <0.1 | 2 / 48 |
| Unpaired DrugZ sensitizers/suppressors at directional FDR <0.1 | 4 / 39 |
| Unpaired finite DrugZ scores | 21,519 |
| Paired / unpaired audit elapsed time | 15.480 / 14.608 seconds |
| DMSO-versus-plasmid NNMD | −3.384 |
| DMSO-versus-plasmid essential/nonessential AUROC | 0.879 |
| Overall existing QC verdict | fail |

The QC failure is driven by 5.2% zero guides in Olaparib2 under the existing 5% threshold. All author-subsampled samples also have low mean counts under the engine's depth heuristic. Those thresholds have not been established as universal failure criteria across all screen designs. Count-only input cannot establish FASTQ mapping efficiency; the corrected QC reports that fraction and the unknown total sequenced reads as null, with an explicit availability flag and provenance. A passing dropout NNMD does not cancel other QC warnings. The small audit summaries' QC fields were recomputed after this reporting correction, with a recorded metadata-update note; biological statistics and original tool-run times were preserved.

The known published sensitizer **CHD1L is not a statistically significant hit under this run**: LFC −1.5486, MAGeCK depleted native FDR 0.559153, union FDR 1.0, overall rank 313; unpaired DrugZ normZ −3.92 and directional FDR 0.161. CHD1L was known in advance. Its direction is a sanity check, and its weak significance is an explicit limitation. No successful independent biological validation, calibration improvement, or prospective accuracy estimate follows from this audit.

Paired versus unpaired differences are a sensitivity analysis of assumptions, not evidence for picking whichever mode yields a preferred hit. The final default is unpaired because biological pairing must be declared rather than inferred from list order.

Reproduce:

```sh
PYTHONPATH=engine engine/.tools/env/bin/python \
  engine/analysis/postscreen_reliability.py \
  --out data/research/postscreen_reliability_unpaired

# Only with justified matching of the listed biological replicates:
PYTHONPATH=engine engine/.tools/env/bin/python \
  engine/analysis/postscreen_reliability.py --drugz-paired \
  --out data/research/postscreen_reliability_paired
```

Machine-readable outputs are under `data/research/postscreen_reliability/summary.json` (initial paired audit) and `data/research/postscreen_reliability_unpaired/summary.json`. Compact copies are retained in `research/artifacts/`; full tool output tables remain in the local data directory. No input/reference files are overwritten. Revision and working-tree patch hashes are recorded because development began with an already dirty tree.

## Tests and limits

A separate final raw FASTQ reproduction is recorded in [the validation report](08_VALIDATION_REPORT.md): four files, 26,336,701 reads, and 65,383 library A guides per file compared with deposited CPM. Spearman correlation ranges from 0.9289 to 0.9548. This additional check does not change the processed-count analysis or remove its QC/biological limitations.

Final focused command:

```sh
PYTHONPATH=engine engine/.tools/env/bin/python -m pytest \
  engine/tests/test_postscreen_reliability.py engine/tests/test_screen_design.py -q
```

Result: **76 passed** (46 new reliability cases and 30 existing design cases). The real MAGeCK+BAGEL2 end-to-end integration also passed all assertions after the rejected variant was revised:

```sh
PATH="$PWD/engine/.tools/env/bin:$PATH" PYTHONPATH=engine \
  engine/.tools/env/bin/python engine/tests/integration_test.py
```

The real published case ran twice to test the explicit pairing choice. MLE merge/selection is tested with fixture output; a comparative MLE, Chronos, BAGEL2 and DrugZ study on independent real validation labels is outstanding. No independent validation outcome dataset is present to justify numerical validation-success probabilities, adaptive acquisition gains, or calibration claims. No claims of error-free operation or universally superior benchmarks are supported.
