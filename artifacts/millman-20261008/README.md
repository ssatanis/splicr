# Millman 2026 published CRISPRa screen: actual SplicR run

Prepared October 8, 2026. This directory is isolated from existing app work and does not create database records or send correspondence.

## Source and design

Maestas et al., *Whole-genome CRISPR screening identifies genetic modifiers of stem cell-derived islet transplantation*, Stem Cells Translational Medicine, DOI https://doi.org/10.1093/stcltm/szag012.

The publisher supplement `szag012_supplementary_data.zip` contains `Source_Data.xlsx`, `Supplementary_Tables.xlsx`, and `Supplemental Figure.pdf`. The `Whole-genome screen` sheet contains 106,400 guide rows, actual sequences, gene and promoter labels, and two count columns: `D0` and `kidney`. The paper describes a day-10 kidney graft endpoint against differentiated day 0 and transplantation into 20 NSG mice. Individual mouse count columns were not provided in this workbook. The GEO accession is for the separate single-cell RNA follow-up, not the pooled guide screen.

All 106,400 guide IDs were preserved. The 3,755 guides labeled `Non_Targeting_Human` were explicitly identified as controls; their canonical gene is blank in the guide map and `CONTROL` in the MAGeCK table. No missing counts were imputed and no duplicate-sequence rows were collapsed. Distinct non-control gene labels in the workbook number 18,913, compared with the stated library's 18,915 targets. The Fig.1 source table contains 18,725 published RRA scores. Those differences are preserved and disclosed.

## Actual methods and results

The current local SplicR engine ran its count-table pipeline with MAGeCK RRA 0.5.9.5, median normalization, kidney treatment, differentiated D0 reference, CRISPRa modality, and a 0.10 two-direction FDR threshold. BAGEL2, DrugZ, MLE, knockout essentiality/dropout checks, and DNA-cutting copy-number flags were not used. No code was changed to improve these results.

The primary run recovered all 20 genes from the publication's top 20, with rank differences. SIX3 is enrichment rank 1; FCAMR rank 8; GSTM3 rank 10. Positive guide effects occur for 5/5, 4/5 and 4/5 guides respectively. HSF2 is enrichment rank 2, but a single guide provides 89.2% of the sum of absolute per-guide log2 fold changes; the gene median log2 FC is -0.049. SplicR flags this for review with its existing 60% single-guide concentration rule. Such a flag is not proof of a false positive.

Among the exploratory top 1% (190 genes), 41 have a single-guide concentration or minority-direction flag. Flag evidence is exported. No gene passed native directional FDR 0.10 in either normalization run. Native directional p-values/FDRs and SplicR's `min(1, 2*min(native directional FDRs))` combined value remain separate. Rankings are exploratory, not significant hit calls. This does not contradict the paper's separate functional follow-up.

A separately invoked standalone MAGeCK run using identical counts/settings matched all 13 numeric gene-summary columns exactly over 18,914 rows including CONTROL. This is output-preservation verification, not a benchmark of a competing statistical algorithm or superior biological accuracy. Original publication scores are not identical; exact original version/settings were not supplied.

A second SplicR run used the 3,755 non-targeting guides for normalization. SIX3, FCAMR and GSTM3 retained positive gene effects and enrichment ranks 1, 9 and 11. Neither run crossed 10% FDR.

The full library denominator gives 106,358 detected guides (99.96%) and 42 zero guides in each sample. Of these, 37 are zero in both columns. Native SplicR QC excludes the 37 unrepresented rows when computing its zero fraction, so its JSON reports five zero guides per sample over the observed universe. The PDF explicitly uses the full library denominator. Read count means and guide detection do not establish physical cell coverage.

The sequence audit reports 3,074 repeated-sequence groups spanning different gene labels, affecting 6,328 guide rows. This is annotation ambiguity in the supplied table, not a genome alignment or off-target prediction. None of the four illustrated genes shares a sequence across gene labels in this workbook.

There is no comparable in vivo CRISPRa Atlas cohort or fitted validation-probability model for this analysis. No claim about future wet-lab validation is made.

## Measured runtime

SplicR count-table analysis with already installed tool dependencies. The machine-readable timing record retains execution provenance.

| Timed phase | Seconds |
| --- | ---: |
| Workbook validation and conversion | 3.427 |
| Main SplicR pipeline | 21.931 |
| Main conversion + pipeline | 25.359 |
| Independent standalone MAGeCK | 15.258 |
| Control-normalization SplicR pipeline | 18.455 |
| Verification phase including analysis and CSV export | 34.577 |
| Sum of timed computation phases | 59.936 |

The standalone and sensitivity calls are contained in the 34.577-second verification phase. Do not double count them. Atlas lookup time is also reported as its own stage but is contained within the pipeline artifact stage. Use the outer measured pipeline duration, not a sum of stage durations. The 59.936-second total is the sum of two execution windows, not wall time for the whole research project. It excludes download, reading the paper, setup, PDF creation and correspondence. Do not describe it as FASTQ-to-results or as a speed advantage over standalone MAGeCK (which took 15.258 seconds here).

## Outputs and rerunning

The user-facing PDF is the two-page brief `output/pdf/SplicR-Millman-screen-analysis.pdf` at repository root, generated by `scripts/build_brief.py` using the supplied SplicR wordmark. The Downloads copy has identical bytes. `build_report.py` preserves the previous longer report builder. The full bundle contains native tables, both SplicR reports, inputs, source archive/workbook, CSV exports, scripts, timing logs and a SHA-256 manifest. `results_summary.json`, `independent_mageck_agreement.json`, and `timing.json` provide machine-readable evidence.

From the repository root, with the same SplicR source tree and installed dependencies:

```sh
PYTHONPATH=engine engine/.tools/env/bin/python artifacts/millman-20261008/scripts/run_splicr.py
PYTHONPATH=engine engine/.tools/env/bin/python artifacts/millman-20261008/scripts/verify_and_export.py
```

Do not rerun just to reproduce the measured timing: hardware load and caching can change it. The report includes an actual deterministic engine source fingerprint and hashes of inputs/code. That fingerprint describes a locally modified source tree, not a fabricated clean release. CSV columns and workbook labels remain attached to their real sample contrast.

## Outreach context

Millman's lab develops functional stem-cell-derived islets, uses CRISPRi/a to improve maturation/stress responses, and studies transplant microenvironments: https://sites.wustl.edu/millmanlab/research/ . The paper's functional follow-up distinguishes enriched genes from improved transplant outcomes: FCAMR improved subcutaneous transplant outcomes, whereas the other nominated genes did not show the same sustained benefit. Enrichment at day 10 is not a direct assay of beta-cell function or long-term graft survival.

The strongest supported pitch is to preserve the MAGeCK statistics his lab already uses while adding explicit sample representation, gene-specific guide support, normalization sensitivity, and portable evidence before committing to follow-up experiments. The HSF2/FCAMR comparison demonstrates that addition directly. Do not claim SplicR is a more accurate hit caller, inferred individual-mouse reproducibility, or predicted FCAMR's functional validation.
