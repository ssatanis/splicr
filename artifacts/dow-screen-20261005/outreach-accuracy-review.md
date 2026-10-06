# Dow outreach accuracy review — October 5, 2026

**Needs revision. Review completeness: Complete for the outreach decision; partial for the underlying analysis system.** The supplied draft was reviewed against the live localhost dashboard, original paper, saved analysis artifacts, and flag implementation. No application, source data, or external message was changed. This is not an independent rerun or full paper reproduction.

## Decision

Do not send the original draft. SplicR demonstrates automated evidence collation, not a newly discovered biological error in this study. The paper already recognized pan-cancer essentials and compared its dependencies with DepMap. Offer a workflow demonstration and a prospective evaluation, without asserting new discoveries, superior biological accuracy, or measured time savings.

## Current live results

The live experiment is `01a10e40-27c0-77ec-b80e-d8a307fc32fd`. Essentiality ICSBCS002 current run ID is `01a10e40-6576-7f52-a49f-ef8231c0f9d9`. Live rows differ from some saved local and later seeded-cloud artifacts; the live values below are the ones inspected for this review.

| Gene | Live SplicR FDR, essentiality ICSBCS002 | Live SplicR FDR, essentiality ICSBCS007 |
|---|---:|---:|
| CDK1 | 0.0930 | 0.000404 |
| CDK7 | 0.0297 | 0.000404 |
| CDK9 | 0.6235 | 0.000404 |
| CHEK1 | 0.000810 | 0.000404 |
| ATR | 0.000810 | 0.000404 |
| WEE1 | 0.0069 | 0.000404 |
| PKMYT1 | 0.0018 | 0.000404 |

All seven are annotated frequent hitters. Thus all seven having FDR <0.001 holds for ICSBCS007, but not ICSBCS002. These are the displayed combined SplicR FDRs, not interchangeable native directional MAGeCK or MLE FDRs. The live candidate default is FDR <=0.1, versus the paper's stated FDR <0.05 method threshold.

Live FGFR1 combined FDR is 1 across all six comparisons. DrugZ directional FDR is 0.263 for gefitinib ICSBCS002, 0.925 for gefitinib ICSBCS007, 0.916 for trametinib ICSBCS002, and 0.939 for trametinib ICSBCS007. None passes 0.05. This does not invalidate the authors' independently validated FGFR1 finding; it prevents calling this reanalysis a successful automatic recovery of that finding.

All three ICSBCS002 comparisons show QC fail; all three ICSBCS007 comparisons show warn. Essentiality ICSBCS002 health specifically reports guide loss in D39_DMSO_rep1 and D39_DMSO_rep2. A count-only guide-loss warning cannot distinguish biological depletion from technical loss by itself.

## Flag provenance and denominator

`engine/splicr/artifacts.py` checks DepMap common essentiality before Atlas frequency. Saved flag evidence for these seven genes identifies `DepMap CRISPRInferredCommonEssentials`, with informational severity and the interpretation that the signal is real but not condition-specific. The Atlas independently corroborates frequent hit history. The flag does not exclude a gene or modify its FDR.

The run provenance records 1,167 allowed background screens after publication leakage exclusion, 378 held-out screens, and zero comparable screens. Gene-specific denominators differ. The UI's currently refreshed Atlas history is a different reference: CHEK1 851/1,393 (61.1%), ATR 729/1,400 (52.1%). Those are not denominators inside the saved 1,167-screen subset. Avoid mixing them in an email. Neither reference supports 'almost every screen' or 'every cell line.' Screens are not necessarily independent studies, and author hit rules differ.

## What the original paper already did

Source: [full paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC11790258/), inspected in the browser after web-fetch access became intermittent.

- Figure 2B explicitly labels ATR, CHEK1 and AURKA as pan-cancer essentials.
- Figure 2D separately presents non-pan-cancer essential kinase hits; Figure 2E compares dependencies with breast cancer cell-line DepMap data.
- Methods use MAGeCK RRA and DrugZ, drug versus matched vehicle for interactions, and endpoint vehicle versus baseline for essentiality.
- Figure 3 uses individual-guide growth/viability assays and pharmacological follow-up; the discussion acknowledges genetic/pharmacological discrepancies.
- Figure 5 uses FGFR1 genetic perturbation and multiple FGFR inhibitors to validate gefitinib sensitization; it also explains an FGFR1-amplification/knockout limitation in ICSBCS007.
- Figure 6 adds a 156-compound pharmacological screen.
- This paper describes a kinase-domain library plus reporter/positive-control checks of Cas9 activity. It does not describe a matched per-guide target-sensor library. Luke's original email was not supplied verbatim, so do not assume his current sensor design is the design used in this publication.
- Results use log2 fold change < -1 and nominal p <0.05 for one essentiality hit discussion, while methods state FDR <0.05. Threshold definitions must be reconciled before claiming exact hit-list reproduction or better selection.

## Scoped review scorecards

Totals below are scoped inventory counts, not a percentage of complete verification. Seven quantitative gene claims were checked, alongside six central narrative claims: novel missed-error detection, flag provenance, universal lethality/frequency, FGFR1 recovery, validation savings, and sensor attribution. Dashboard behavior was sampled only where it could change the outreach recommendation.

### Report usefulness and quality

| Category | Observed defects | Assessment |
|---|---|---|
| Usefulness/completeness | 1 / 1 | Original report omits the authors' existing contextualization and material contradictory results. The revised recommendation addresses these. |
| Analytical clarity | 1 / 1 | Original report conflates real essentiality, specificity, and false-positive status. |
| Visual/interaction consistency | N/A | Supplied artifact is prose. Live table/filter controls were sampled, not audited for all layouts. |

### Analytical correctness and robustness

| Category | Observed defects | Assessment |
|---|---|---|
| Source authority/confidence | 2 / 6 | Flag attribution and sensor attribution overstate the inspected evidence. Original email absent. |
| SQL/value accuracy | 5 / 7 | Five of seven universal FDR claims fail in live ICSBCS002; all seven hold in ICSBCS007. |
| Within-chart agreement | N/A | No chart supplied in the proposed report. |
| Complete source details | 1 / 1 | Atlas corpus total, gene-specific denominator, held-out subset, and refreshed UI counts are not distinguished in original report. |
| Cross-artifact consistency | 1 / 1 | Live and saved analysis versions differ; original report does not bind assertions to a run. |
| Data-quality controls | 1 / 1 | Original report omits fail/warn statuses for the six contrasts. |
| Conclusion support | 5 / 6 | Novel missed-error detection, universal lethality, FGFR1 recovery, months saved, and sensor attribution are unsupported. Biological-context complementarity is plausible but is not new to the authors. |

## Prioritized problems and proposed fixes

1. **Central novelty claim:** Figure 2 already recognizes the biological distinction. **Fix (Proposed):** describe automation of known analysis steps and additional ORCS history, not correction of an overlooked flaw.
2. **False-positive interpretation:** common essentiality is not a false biological hit. **Fix (Proposed):** call it a specificity annotation; preserve potentially useful therapeutic candidates and require relevant controls.
3. **Quantitative assertions:** the seven FDRs, Atlas denominator, and FGFR1 recovery are overstated. **Fix (Proposed):** omit numeric examples from initial outreach unless run, contrast, caller, threshold and reference subset are specified.
4. **Value claim:** no measured bench time or improved validation outcome exists. **Fix (Proposed):** propose a new-screen comparison with frozen settings, blinded review, analysis time, and independently validated follow-up outcomes.
5. **Sensor comparison:** publication and current library design may differ. **Needs input:** Luke's original wording is required for a specific claim about his sensor architecture; initial outreach can acknowledge it without asserting inadequacy.

## Suggested email

Hi Luke,

Thanks for explaining the sensor-based design. I reanalyzed the published kinome-screen counts in SplicR and read the paper more closely. I saw that you already distinguished pan-cancer essentials and compared the hits with DepMap.

The potential value I’d like to explore is streamlining that workflow: bringing guide-level evidence, QC, results across analysis methods, and public-screen context into one reviewable workspace alongside follow-up outcomes.

I’d be happy to show you the reanalysis and get your feedback on whether that would reduce analysis and review work for future screens.

Best,
Sahaj

No email was sent.
