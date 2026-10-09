# Ferrarone 2024 SplicR demo

The exact dataset is **CRISPR screens in LKB1-null and -WT cells**, Harvard Dataverse V1, published May 2, 2024: https://doi.org/10.7910/DVN/8DEPIT. The PNAS paper is https://doi.org/10.1073/pnas.2403685121 (published online May 14; issue May 21, 2024).

Upload the original **two count files together**, or `/Users/sahaj/Downloads/SplicR-Ferrarone-demo.zip`, at https://www.splicr.org in New analysis > My experiment. Review the proposed plan. For the meeting, open the six already completed full RRA+MLE reports; do not initialize another batch. No additional download is needed for the count-table workflow. The verified-study profile is deployed to production. Authenticated browser tests passed on the staged build and on splicr.org, including the ZIP upload. The tested deployment is `dpl_3RC5tM6jGnP6fgBDufFeVtHBD1Qv`. A temporary upload permission for its staging origin was removed after verification; production permissions were preserved.

| Required file | Exact download | Archive MD5 |
|---|---|---|
| 2d_crispr_screen_read_counts.txt | https://dataverse.harvard.edu/api/access/datafile/7440985 | 47a694a20d470868daf9c3695e932a73 |
| spheroid_crispr_screen_read_counts.txt | https://dataverse.harvard.edu/api/access/datafile/7440983 | 079c7294fb7c663956637efb7d360efb |

Both local files match the archive sizes and MD5 values. Each contains 70,116 unique guide IDs, all found exactly in the TKOv3 reference. The full reference contains 71,090 guides; the absent 974 guides are not fabricated or added with zero counts. The guide ID sets and the plasmid counts are identical between the two deposited tables. The metadata and a complete list of all ten archive files, including eight FASTQ download URLs (13,651,933,669 bytes total), are saved in `source-manifest.json`. The separate proteomics datasets DOI 10.7910/DVN/DIYFCX and DOI 10.7910/DVN/HYFUFM are not count-table input and are not required for this demo. The CRISPR deposit does not list a plasmid FASTQ.

These are deposited **guide-count matrices**, not the original sequencing reads. Every deposited plasmid count is >=30; endpoint counts include values below 30, with a minimum of 1 and no zero entries. This is consistent with an existing plasmid-based low-read filter. It does not establish the complete author's preprocessing rule or explain how zero counts were handled. The paper says guides below 30 reads were excluded without specifying that rule completely. Do not apply a further endpoint <30 filter; it would remove biological depletion. SplicR retains the deposited count values exactly. Count-only input cannot establish mapping efficiency or recover excluded guides.

The deposited Gene column has 104 rows per table with spreadsheet-altered labels (such as `2-Mar`, `1-Mar`, and `15-Sep`). Exact guide IDs distinguish colliding names and recover the historical TKOv3 annotations. The audit is `gene-annotation-audit.csv`. The original count matrices contain 18,047 distinct gene labels; resolving annotations gives 18,049 distinct library gene labels. These are library annotations, not a claim that every symbol is the current HGNC symbol. Canonical audit copies are in `canonical/`; upload the untouched archive files for checksum-based auto-recognition.

## Experimental design and interpretation

A549 is a human lung adenocarcinoma cell line. EV denotes empty-vector, LKB1-null cells. WT denotes cells with restored wild-type LKB1; WT is not an untreated control for this question. The library is human TKOv3, Addgene 90294, Cas9 knockout. Both cultures have two day-21 endpoints (a and b) per LKB1 state. Their common plasmid column is one library reference, not two independent biological replicates or a cell-based day-zero sample. A549 spheroids are a cancer-cell-line culture, not patient-derived organoids. Culture is preserved as a sample factor.

The profile proposes, separately in each culture: EV vs plasmid, WT vs plasmid, and WT vs EV. Positive guide enrichment suggests that disruption of the target is more represented in the numerator. An abundance result is not a direct growth measurement. The endpoint differential tests relative enrichment under LKB1 restoration and is not a drug experiment. DrugZ is off. NNMD/essentiality QC is assessed for endpoints against plasmid; it is not interpreted as essentiality for WT vs EV.

The frozen reanalysis uses median normalization, primary MAGeCK RRA, additional MAGeCK MLE, FDR 0.05, MLE 10 permutation rounds, and random seed 0. BAGEL2, DrugZ, Chronos, and copy-number correction are off. RRA native directional FDRs and MLE beta/FDR remain separate. SplicR's two-direction FDR bound is min(1, 2 * min(native directional FDRs)), not a union of RRA and MLE calls. The original paper used MAGeCK MLE. The current reanalysis uses MAGeCK 0.5.9.5 and does not claim exact reproduction of published beta scores.

The original study identified **FIG4 and VAC14** as genetic screen findings and established **PIKFYVE** function through additional experiments, including apilimod. PIKFYVE sgRNAs were not enriched in the LKB1-WT spheroid screen. Do not tune settings to make PIKFYVE a screen hit or claim an independently validated improvement over the authors. Published positive controls are retrospective interpretation, not new independent validation. A significant effect in spheroid and a nonsignificant effect in 2D alone do not prove a culture interaction; that requires a formal interaction analysis.

## Verification and artifacts

The actual original count files were uploaded through the real authenticated local browser frontend to hosted R2/Supabase. It auto-selected TKOv3, prepared six comparisons, saved the reviewed designs, and dispatched six real deployed Modal jobs in a retained demonstration workspace. It did not alter an investigator's own workspace. The study profile is identified by exact SHA-256 plus the original sample schema and row count. File names alone cannot trigger it. Explicit sample edits and supplied metadata are retained.

Independent QC after fixing aggregation of failure severity remains **warn for all six comparisons**, matching the deployed QC verdicts. The four baseline comparisons separate known essential and nonessential genes. Replicate B distributions are substantially skewed, and the original count-only limitations remain visible. Reports do not relabel these data as perfect. The QC fix preserves a true failure instead of turning it into a warning on future screens.

The browser inspection and reviewed-plan check passed. The initial post-launch test assertion expected text the UI did not use; dispatch itself succeeded. The corrected review test passed without launching duplicate jobs. The launched parent's saved design is `launched-intake-config.json`; the later review-only browser plan has different draft file IDs and is `browser-analysis-plan.json`. Their settings and original file hashes agree.

`source-manifest.json`, `gene-annotation-audit.csv`, `independent-qc.json`, browser screenshots, and test logs preserve the source and verification evidence. The cloud receipt and exported gene statistics are written by `scripts/data/export-ferrarone-demo.mjs` only after all six runs finish successfully. `scripts/data/prepare-ferrarone-demo.py` verifies the archive and rebuilds the demo ZIP. No email was sent to the investigators.

Validation: the full web suite passed 723 tests (3 skipped), and the full engine suite passed 738 tests (2 skipped, 9 deselected). Typechecking, the production build, and whitespace checks passed. The Modal worker update deployed successfully. Staging, production count upload, and production ZIP browser checks each passed setup and review without launching duplicate cloud jobs. The first production auth setup encountered a local network fetch failure; retry passed.

## Completed cloud results and full MLE output

Six additional **RRA-only validation runs completed** through the production upload, deployed Modal worker, result persistence, browser reports, and CSV/JSON exports. These are explicitly named `(RRA validation)` and remain separate from the completed full RRA+MLE batch. Every completed comparison has 18,049 recorded genes and 70,116 guide effects. The browser verified all 18,049 genes were drawn, all six JSON exports were complete and not truncated, and a CSV downloaded through the real UI. The record is `rra-cloud/cloud-verification.json`; the browser test passed setup and all six report checks.

All genes' LFC, SplicR two-direction FDR, and both native directional FDRs **exactly match** the independent local MAGeCK RRA calculation in each of the six completed cloud comparisons. See `rra-cloud/independent-cloud-agreement.json`. This checks computational consistency, not biological ground truth.

| Comparison | Genes below SplicR FDR 0.05 | QC |
|---|---:|---|
| 2D EV vs plasmid | 205 | warn |
| 2D WT vs plasmid | 271 | warn |
| 2D WT vs EV | 0 | warn |
| Spheroid EV vs plasmid | 159 | warn |
| Spheroid WT vs plasmid | 178 | warn |
| Spheroid WT vs EV | 0 | warn |

For **WT spheroid vs plasmid**, RRA reports FIG4 log2 fold change +3.1413 with native enrichment FDR 1, VAC14 +4.9627 with enrichment FDR 0.889219, and PIKFYVE +0.40606 with enrichment FDR 1. These genes are not significant RRA calls here. Strong fold change alone does not establish statistical significance. These RRA statistics are not the paper's MLE beta-score analysis. The paper used beta-score nomination criteria and experimental follow-up, so RRA FDR calls should not be treated as the same criteria. Do not claim the two endpoint contrasts with zero RRA calls prove that LKB1 has no effect.

The six full RRA+MLE runs are now **complete**. Each contains 18,049 unique genes with complete separate MLE beta/FDR values. All six full browser reports and untruncated JSON exports passed verification; the full spheroid WT CSV also downloaded through the UI. All RRA LFC and three FDR fields match the separate validation cohort exactly across 108,294 records. Evidence: `mle-completed-invariants.json`, `mle-browser-check.json`, `full-rra-validation-agreement.json`, `cloud-verification.json` and six full gene CSVs/receipts.

The full initial cohort took 18,316.696 seconds, or **5 hours 5 minutes**, including retries and its original worker allocation; upload/pre-start waiting are excluded. The 6-minute-2-second timing is the separate RRA-only cohort. The original one-off export watcher lost its database connection during the wait. A fresh read exported all completed records successfully; no new analysis was submitted.

The full WT spheroid report has 178 RRA candidates (176 depleted, 2 enriched), with 172 flagged for review. 154 carry a stored DepMap pan-essential annotation, consistent with broad survival dependencies. Flags are not automatically errors and categories overlap.

Full WT spheroid MLE beta/FDR: FIG4 +1.8331/0.57554, VAC14 +3.211/0.19162, PIKFYVE +0.43846/0.99966. None passes FDR 0.05 here. VAC14 meets both published WT-high/EV-low beta criteria, while FIG4 does not meet the EV-low cutoff in this separate fit. The paper’s methods and Figure 3 caption use different beta cutoffs (0.5 and 1). Exact reproduction requires the original design, normalization and filtering details, and resolution of those criteria. Full outputs do not establish superiority over the publication.

For the live meeting, select **Ferrarone 2024 · SplicR demo** using the existing Sahaj sign-in and open the completed reports. Walk through upload/configuration without initializing another job. The original input ZIP, full RRA+MLE results ZIP and meeting demo kit are in Downloads.

The Modal compute audit used 100 real four-guide genes, ten permutation rounds, the same counts, median normalization, and random seed 0. Default one-process MLE took 36.54 seconds; eight MAGeCK processes with one BLAS thread each took 20.03 seconds. Reported beta and FDR values were identical on this subset. Future private workers now use the latter compute allocation, with the same statistical parameters. The original full cohort has now completed; its recorded runtime includes older allocations and retries. This subset is an execution check, not genome-wide biological validation. The focused worker regression suite passed 72 tests after this change. Evidence is `mle-compute-audit.json` and `mle-compute-audit-summary.json`.


## Lab meeting presentation and latest release verification

The 20-slide SplicR-branded deck is in `presentation/`, with an editable PowerPoint, a self-contained HTML presentation, a PDF, detailed speaker notes, and `Explain-SplicR-and-the-demo.md`. It uses real production screenshots, native editable chart/table elements, and the authors’ complete original Figure 4 with attribution. Broad Apron, MAGeCK, and PinAPL-Py comparisons describe documented capabilities; no head-to-head accuracy or runtime advantage was measured.

Latest verification: 738 engine tests passed, 2 skipped and 9 deselected; 723 web tests passed and 3 skipped; the custom-library, sample-metadata/draft-resume, corrected-column and FASTQ adapter browser flow passed (4 tests including setup). The initial customization browser failure was a missing colleague fixture, corrected by an invite-only synthetic member setup; the production customization itself then passed. Typechecking and production build passed with no frontend source changes afterward. `git diff --check` passed.

Existing MLE retries exposed a real Supabase bulk-COPY timeout. The deployed Modal worker now uses bounded 25,000-row COPY batches with a transaction-local 10-minute timeout, preserving atomicity, all rows and zero counts. Retry startup resets stale stage records before processing. Regression tests cover the genome-sized multi-batch write and retry-stage reset. Calls retain the image with which they start; all six recorded full analyses are now complete. No new analysis batch was submitted during presentation work.

New runs record the deployed engine revision (or a deterministic Python-source fingerprint locally) and include it in report provenance. Older completed RRA runs did not record an engine revision, and no revision or container digest was invented for them. Validation decision rows that refuse unfitted probabilities are now labeled as decisions, with the count of candidates having actual estimates explicit.

The RRA dataset is numerically reproducible. It does not establish 100% biological accuracy, universal assay support, or results superior to the publication. Full MLE reconciliation and prospective wet-lab validation remain open scientific work.

The recorded demo workspace is now retained as **Ferrarone 2024 · SplicR demo**. Both existing Sahaj profiles in the checked original workspace have owner access. Their default workspace was not changed and no invitation/email was sent. Fixture seed/teardown refuses a workspace with `settings.retain_demo=true`; future E2E tests should use a fresh namespace. This protects the actual scientific analyses from fixture cleanup.
