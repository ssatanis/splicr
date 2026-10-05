**Dow screen: reviewed browser analysis**

The two supplied workbooks were uploaded through New analysis in a disposable researcher workspace. The UI reviewed two models and 20 samples, imported the exact private Vakoc library, confirmed four PRL9 to RPL9 guide aliases and created six comparisons. Supabase stored the designs and results, Cloudflare R2 stored the files and the deployed Modal worker ran the analyses.

ICSBCS002 has two biological replicates per condition; ICSBCS007 has three. Essentiality compares D39/D31 vehicle endpoints against D4/D3 baseline. Drug comparisons use matched vehicle endpoints. The library contains 3,051 sequences, 489 nonnegative-control target labels and 50 negative-control sequences. Target labels include positive controls and are not a kinase count. Two duplicated guide IDs have different sequences and the same gene; both library entries are retained, while count rows resolve only to that shared gene.

The reviewed plan uses knockout, organoids, median normalization and FDR 0.05. MAGeCK RRA runs on all six comparisons, with unpaired DrugZ on the four drug comparisons. MLE is an additional sensitivity analysis, using ten permutation rounds and random seed 0. BAGEL2, Chronos and copy-number correction are excluded. These assumptions were frozen before inspecting downstream validation. The [paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC11790258/) reports MAGeCK 0.5.9.4; the worker uses 0.5.9.5. DrugZ is pinned to eb15d34e4dd172965e618d5bb662c053066da799. This is a declared reanalysis, not an exact numerical reproduction.

Final seeded cloud results at method-specific FDR < 0.05:

| Comparison | QC | SplicR | RRA depletion | RRA enrichment | DrugZ | MLE |
|---|---|---:|---:|---:|---:|---:|
| Essentiality ICSBCS002 | fail | 29 | 33 | 0 | Not run | 38 |
| Gefitinib ICSBCS002 | fail | 0 | 0 | 0 | 3 | 9 |
| Trametinib ICSBCS002 | fail | 0 | 0 | 0 | 0 | 7 |
| Essentiality ICSBCS007 | warn | 38 | 37 | 3 | Not run | 34 |
| Gefitinib ICSBCS007 | warn | 3 | 0 | 4 | 5 | 7 |
| Trametinib ICSBCS007 | warn | 5 | 2 | 3 | 6 | 6 |

Every comparison preserves 489 gene rows and 3,044 guide-effect rows, plus guide disagreement reports. Native directional MAGeCK statistics, DrugZ FDR/normZ and MLE beta/FDR remain separate. SplicR uses min(1, 2 × min(directional MAGeCK FDRs)); this is not a union of callers. Requested methods must finish successfully before a run can be marked complete.

Primary RRA statistics were identical across the original and repeated analyses. Unseeded MLE FDRs varied, so the worker now seeds both upstream random generators. Two full local seeded executions produced identical gene-summary files for 490 labels, including the pooled control label. Their SHA-256 values and all current run IDs are in [repeat verification](repeat-verification.json). Run records and configurations are retained. Earlier reruns replaced their result rows; the run-history migration now preserves result rows for future executions. Missing historical rows are not represented as retained. The seeded analysis was also rerun through the UI for all six comparisons. A final rerun of Essentiality ICSBCS002 retained 489 hits, 3,044 guide effects and 489 disagreement reports for both executions, with identical RRA and MLE statistics.

POLR2A, RPA3 and PCNA pass both essentiality comparisons. RAF1 in trametinib-treated ICSBCS007 passes depletion FDR 0.007282 and DrugZ FDR 0.00301. ERBB2 in gefitinib-treated ICSBCS002 passes DrugZ FDR 0.0128 while depletion FDR is 0.233819. FGFR1 has DrugZ FDR 0.268 and does not pass the primary threshold. These differences remain visible; settings were not tuned to recover published genes. The supplementary tables do not provide a complete author gene-ranking reference. S7 contains inhibitor IC50 values, which are pharmacologic context rather than another guide-count screen.

QC flags remain visible. Guide loss, skew and limited essential/nonessential overlap need interpretation; count-only input cannot establish read mapping efficiency. After freezing the rankings, the paper's FGFR1 individual-guide observation was recorded in Truth Loop as retrospective evidence. Its reported positive outcome is retained, but its endpoint is insufficient_record because required independence, controls, replicates and quantitative criteria were not established. This is not prospective validation.

The same intake supports manual column/sheet mapping, wide/long/transposed tables, sample metadata and editable factors, private library imports with species/modality/control flags, unused samples, multiple contrasts, custom MLE matrices, paired/unpaired DrugZ, reviewed plans, saved draft reopening and immutable reruns. CSV/TSV/JSON and XLSX/XLS/XLSB/ODS inputs are supported, with bounded folders/ZIP expansion and FASTQ counting. Readable PDF/Office/text documents receive previews. Images and unsupported formats are retained with explicit limits; OCR and universal paper interpretation are not implemented. Unsupported screen families, Chronos and actual copy-number correction require additional adapters and inputs.

Eleven database migrations and the worker are deployed. The frontend is built and tested locally against the hosted services. The Vercel connection returned 403 for the linked team, so production frontend deployment has not been verified through this connection. Cloudflare's CORS policy was read back and includes both splicr.org origins with ETag exposed for multipart uploads.

An independent [GSE145743 browser benchmark](../gse145743-screen-20261005/README.md) exercises original GeCKOv2 A+B library files, author counts, metadata and real FASTQs. Neither benchmark proves universal support, 100% biological accuracy or better independent validation than the authors.

Artifacts: [current comparison summary](comparison-summary.csv), [reference-gene statistics](reference-gene-statistics.csv), [original cloud execution](cloud-verification.json), [source checksums](source-checksums.json), [native browser export](cloud-gefitinib-002-export.json), [rank comparison](compare-rankings.png), [Truth Loop](truth-loop.png) and [mobile comparison](compare-mobile.png). Local comparison-1 through comparison-6 outputs are separate pipeline executions. [Verification checks](verification-checks.json) describe the completed tests and remaining limits.
