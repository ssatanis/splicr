# SplicR and the Ferrarone demo, in plain language

## What we do

SplicR helps researchers turn CRISPR screen files into an analysis they can inspect and repeat. It checks the files, identifies the guide library, suggests comparisons, runs established statistical methods and presents the evidence for each gene. Researchers can change the configuration before running it.

For this paper, we verified the original downloads, recovered corrupted gene labels using guide IDs and completed all six full RRA+MLE analyses plus six separate RRA validation analyses. The outputs contain every scored gene, quality warnings and settings. An independent local calculation matches the cloud statistics exactly.

That is a useful demonstration of reliable computation. It does not mean the biology is 100% correct, or that our results are better than the paper. The authors used MLE and did follow-up experiments. FIG4 and VAC14 are not significant in our completed RRA configuration. The paper nominated genes using MLE beta scores and follow-up experiments, which are different evidence criteria. All six full RRA+MLE analyses are now complete. Their configuration and beta-score nomination criteria still need reconciliation with the authors’ analysis.

## The biology, without assuming background knowledge

A gene is a section of DNA that helps a cell make a functional product, often a protein. A cancer cell grows when the balance of growth signals and restraints changes.

LKB1, also called STK11, helps restrain growth. The lab studied lung cancer cells that lacked working LKB1. They added LKB1 back to one group and compared it with the original group.

The paper found that LKB1's growth restraint depends on the culture environment. Cells grown as small three-dimensional clusters, called spheroids, behaved differently from cells grown as a flat layer. These were cancer cell lines, not patient-derived organoids.

The lab wanted to find genes involved in that restraint. They used CRISPR to disrupt genes across the genome, then tracked which disruptions became more or less common. The screen implicated FIG4 and VAC14, components of a complex containing PIKFYVE. Follow-up experiments connected the complex to how cells internalize growth factor receptors. PIKFYVE's role in the paper rests on that larger experimental story, including drug and rescue experiments.

Source: [Ferrarone et al., PNAS 2024](https://doi.org/10.1073/pnas.2403685121).

## What a CRISPR screen measures

A guide directs the CRISPR machinery toward a particular DNA target. Researchers use several guides for most genes because individual guides can behave differently.

The guide sequence also acts as a tag. Sequencing tells us how often each guide appears in the sample. More reads for a guide can indicate that cells carrying it became more common. Fewer reads can indicate that those cells became less common. Sequencing depth and experimental variation also affect those numbers, so analysis must normalize counts and examine replicates.

These counts are a proxy for relative abundance. They are not a direct measurement of the size or growth rate of each spheroid.

## The labels in this dataset

| Label | Meaning |
| --- | --- |
| A549 | The human lung cancer cell line used in these uploaded screens |
| EV | Empty vector. These cells lack working LKB1 |
| WT | Wild-type LKB1 restored in the cells |
| 2D | Cells grown as a flat layer |
| 3D or spheroid | Cells grown as clusters |
| d21 | Sample collected after 21 days |
| a and b | The two endpoint replicate labels |
| tkov3_plasmid | The starting guide-library plasmid reference |

The same plasmid column appears in both tables and has identical counts. It is one shared reference. It is not an extra biological replicate or a cellular day-zero sample.

## What the six comparisons ask

For each culture, EV versus plasmid asks which guide disruptions change in abundance in LKB1-null cells. WT versus plasmid asks the same question after restoring LKB1. WT versus EV directly compares the two endpoint groups.

We analyze 2D and spheroid separately. A gene reaching significance in spheroids but not in 2D does not, by itself, prove the effect differs between cultures. That requires a formal interaction analysis.

## How to read a result

Log₂ fold change describes the size and direction of the relative abundance change. A value of +1 corresponds to roughly twice the relative abundance. A value of −1 corresponds to roughly half. The exact estimate depends on normalization and the method used to combine guides.

An FDR threshold accounts for testing thousands of genes. Under the method's assumptions, FDR concerns the expected fraction of false discoveries among a set of called discoveries. It is not the chance that a particular gene is true, and FDR 0.05 does not mean every called gene has 95% biological accuracy.

SplicR keeps MAGeCK's enrichment and depletion FDRs separately. It also reports a conservative combined bound for a gene changing in either direction: `min(1, 2 × min(enrichment FDR, depletion FDR))`. The candidate counts in the deck use that combined threshold at 0.05. Native directional FDR counts can differ.

RRA and MLE are different statistical analyses in MAGeCK. RRA summarizes guide rankings. MLE fits a model defined by an experimental design matrix and produces gene beta scores. We must compare the paper with MLE under an agreed configuration before calling it a reproduction.

The published descriptions of the Figure 3D pathway-analysis input differ: the CRISPR-screen methods give WT spheroid beta >0.5 and EV spheroid beta <0.5; the Figure 3D caption gives WT beta >1 and EV beta <1. Both passages were rechecked in the [paper's full text](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC11127050/fullTextXML). These are beta-score selection criteria for pathway analysis, not FDR cutoffs or a general significance rule for the screen. The text does not establish which criteria were actually implemented. We should ask the investigators which rule generated Figure 3D, without assuming a typo or using the difference as evidence of superior SplicR accuracy. The detailed meeting guide includes neutral wording for that question.

An artifact flag means there is something to inspect, such as a signal dominated by one guide or a guide with multiple target matches. It does not automatically mean the result is false. A frequent hitter may be a real common dependency.

A quality warning means the input experiment deserves attention. A successful software run should still display that warning. Removing warnings to make a demo look cleaner would make it less useful.

Source: [MAGeCK documentation](https://sourceforge.net/p/mageck/wiki/usage/).

## What the completed demo actually shows

Both files match Harvard Dataverse V1 by archive checksum and size. Each contains 70,116 observed guide IDs. All match TKOv3. The library reference contains 71,090 guides, so 974 reference guides are absent from the deposited tables. We retain the deposited rows and do not add invented counts.

Each file contains 104 guide rows with date-like gene labels, consistent with spreadsheet conversion. Exact guide IDs recover the historical TKOv3 annotations. The corrected observed target set contains 18,049 genes. The original count values stay unchanged.

| Comparison | Genes scored | RRA candidates at combined FDR ≤ 0.05 |
| --- | ---: | ---: |
| 2D EV versus plasmid | 18,049 | 205 |
| 2D WT versus plasmid | 18,049 | 271 |
| 2D WT versus EV | 18,049 | 0 |
| Spheroid EV versus plasmid | 18,049 | 159 |
| Spheroid WT versus plasmid | 18,049 | 178 |
| Spheroid WT versus EV | 18,049 | 0 |

All six reports have quality warnings. The spheroid WT-versus-plasmid report has 178 RRA candidates, including 176 depleted and 2 enriched. 172 have at least one flag, and 154 carry a DepMap pan-essential annotation. Many therefore fit a general survival-dependency pattern rather than uniquely identifying an LKB1 mechanism. Flags prompt inspection and do not mean the software made 172 errors. The categories overlap and cannot be summed as distinct genes. In the spheroid WT-versus-plasmid RRA analysis, FIG4 has a positive fold change of +3.14 and VAC14 +4.96, but neither reaches the declared significance threshold. PIKFYVE also does not reach it. The paper's screen and follow-up findings should not be reduced to whether PIKFYVE is a top RRA hit.

Independent local calculations match all four checked statistics exactly for every gene in all six comparisons: fold change, enrichment FDR, depletion FDR and combined FDR. This checks numerical reproducibility for our configuration.

The recorded worker durations range from 97 to 126 seconds. The first RRA worker started at 16:22:43 UTC on October 7, 2026, and the last finished at 16:28:45 UTC, a span of 6 minutes 2 seconds. That span excludes upload time and pre-start waiting. It also excludes MLE and FASTQ alignment. The paper does not give a comparable computation runtime, so we cannot honestly say it is a specific number of times faster than their analysis.

All six full RRA+MLE analyses have now completed. Each has 18,049 unique genes with separate RRA and MLE statistics; their complete browser JSON exports were verified. Every primary RRA statistic also matches the separate RRA-only validation cohort across all 108,294 gene/comparison records. For spheroid WT versus plasmid, MLE beta/FDR are FIG4 +1.8331/0.57554, VAC14 +3.211/0.19162 and PIKFYVE +0.43846/0.99966. None passes MLE FDR 0.05 here. VAC14 meets both published WT-high/EV-low beta criteria, while FIG4 does not meet their EV-low cutoff in this separately fitted design. That is not an exact reproduction of the paper’s design.

The initial full cohort took 5 hours 5 minutes from first worker start to final completion, including retries and the original allocation. That timing excludes upload and pre-start waiting and is separate from the six-minute RRA cohort. Earlier attempts encountered a count-persistence timeout; the deployed fix batches writes and resets stage records on retry. Some older runs have no stored engine revision, and no container digest was invented. The later WT spheroid run records its worker revision.

The deployed validation network has no fitted outcomes cohort for these screens. It refuses biological success probabilities with a reason. There is no bench validation recorded for the candidates in this demo.

## How to present the deck

The main deck is slides 1–18. Slides 19–20 are a methods and sources appendix. Aim for about 15 minutes and use the notes for questions. The HTML deck opens without a server or internet connection. Click **Present**, use left/right arrow keys, press **N** for notes and **Escape** to leave presentation mode. The PDF preserves the layout for sharing. The PowerPoint keeps text, tables and the result chart editable.

1. **Introduction.** “We are Sahaj Satani, Pranav Mettu and Ishaan Samantray, Cornell students who built SplicR. We used your published data to show how the workflow handles a real screen.”
2. **Paper.** “Your paper asks how LKB1 suppresses growth in spheroids. The screen connects that question to the PIKFYVE complex, and follow-up experiments explain the mechanism.” The published figure is their experiment, not our output.
3. **Design.** “We preserve the four endpoint groups and the shared plasmid reference. We do not mix the two culture environments.”
4. **Data checks.** “Both files match the archive. Exact guide IDs let us recover gene labels that spreadsheet conversion damaged.”
5. **Upload.** “These are the original count tables. We can use the deposited counts without downloading and aligning the sequencing reads again.”
6. **Library.** “SplicR checks the guide IDs and identifies TKOv3. The researcher can inspect that mapping.”
7. **Comparisons.** “It suggests six comparisons for this study. The investigator can change the choices before running.”
8. **Configuration.** “The method and settings remain explicit. Automation helps prepare the plan, while the researcher controls the scientific choices.” The settings screenshot includes MLE. The candidate-count chart uses the RRA validation batch, while the main report, export and reference-gene table show the completed full RRA+MLE run.
9. **Progress.** “This screenshot was captured during an actual MLE run; all six full analyses are now complete. The display shows stages completed and elapsed time. It is not a promised time-to-finish.”
10. **Report.** “178 genes pass our RRA threshold. 172 have flags for review, not automatic rejection. 154 have a pan-essential annotation, consistent with common survival dependencies. The report also keeps the replicate-quality warning visible.”
11. **Results.** “Here are the candidate counts across all six RRA comparisons. Each result covers the full observed gene set.”
12. **Important genes.** “The table includes the completed MLE results. FIG4 beta/FDR are 1.83/0.576, VAC14 3.21/0.192 and PIKFYVE 0.44/about 1. None passes MLE FDR 0.05 here. The paper’s beta-score nomination and experimental follow-up are different criteria, and exact reproduction still needs the original design and filtering.”
13. **Export.** “Researchers can download all rows, not just the genes visible on screen. The run settings and quality warnings remain attached.”
14. **Runtime.** “Six RRA jobs span 6 minutes 2 seconds and match our independent local calculation exactly. The full initial RRA+MLE cohort took 5 hours 5 minutes, including retries. These are separate timings and do not measure a speed advantage over the authors.”
15. **Apron comparison.** “Apron already gives researchers useful QC and browser analysis. For this dataset, SplicR identifies the exact inputs, repairs labels through guide IDs and prepares six editable comparisons. This is a workflow comparison, with no measured accuracy advantage.”
16. **Other tools.** “MAGeCK and tools such as PinAPL-Py remain important. SplicR brings established analysis into a shared workflow. We have not established that it is more accurate than these tools.”
17. **Other labs.** “The sample metadata, guide library and comparison controls are editable. A different assay still needs a suitable method and its own validation.”
18. **Pilot.** “We would like to agree on a reference analysis with you, review differences together and test the workflow on a new screen.”
19. **Methods appendix.** “The inputs and settings are saved. Local RRA matches the cloud. Matching computation does not replace experimental validation.”
20. **Sources and files.** “The kit includes all six complete RRA+MLE result packages and the separate RRA validation packages. The slide links directly to the full spheroid WT report.”

The Atlas phrase has been removed from the comparison slide. If someone asks about Atlas in the app, say: “Atlas uses previous screens to show whether a gene often appears as a hit, which provides context rather than validation of this result.” Do not claim this paper was held out unless that exclusion is specifically verified.

## How SplicR can help a lab

The clearest value today is reducing repetitive setup while keeping scientific decisions inspectable. A researcher can upload familiar files, review a proposed plan, follow recorded progress and inspect the guide-level evidence behind a candidate. The same workspace keeps configuration and results together when collaborators discuss a screen.

A useful pilot would measure how much analyst time that saves, how often the intake needs correction and whether the results agree with a frozen reference workflow. We should measure those benefits directly.

A defensible product advantage would come from reliable handling of messy data, reproducible configuration, clear evidence and validated decisions collected over time. A prediction system would need representative outcome data and prospective testing. Calling it the “best” without that comparison would weaken the discussion with an experienced lab.

## Broad and other tools

[Broad's current post-screen page](https://portals.broadinstitute.org/gpp/public/resources/post-screen) directs users to Apron Beta and describes PoolQ for deconvolution. The [Apron guide](https://docs.google.com/document/d/14ry2-S3zWCwJVZzxS2QLSdNGqyl6QaFK7rhkcyh7jXU/preview) documents guided QC, control-set aggregation, plots and downloadable outputs. We reviewed the guide rather than performing a head-to-head Apron run.

[MAGeCK](https://sourceforge.net/p/mageck/wiki/usage/) provides the RRA and MLE methods SplicR uses. [PinAPL-Py](https://www.nature.com/articles/s41598-017-16193-9) already describes web analysis with custom libraries and automated read extraction. These comparisons identify workflow differences. They do not demonstrate a universal winner.

## Exact downloads and prepared files

Dataset: [CRISPR screens in LKB1-null and -WT cells, Harvard Dataverse V1](https://doi.org/10.7910/DVN/8DEPIT).

- [2D read counts, file 7440985](https://dataverse.harvard.edu/api/access/datafile/7440985)
- [Spheroid read counts, file 7440983](https://dataverse.harvard.edu/api/access/datafile/7440983)

You already have the correct two files. The demo ZIP contains those exact files. No extra download is required for the completed count-table analysis. The paper's proteomics deposits are separate experiments and are not CRISPR count inputs.

Use the prepared result files for the meeting. Sign in with your usual Sahaj account and select **Ferrarone 2024 · SplicR demo** from the workspace selector. Both existing Sahaj sign-ins have access; their default workspace has not changed. The demo is retained, and fixture seeding/cleanup is blocked for this workspace to protect the real analyses. To show the workflow live, upload the demo ZIP and walk through the four review steps. You can export the plan without launching another analysis. Open the six existing completed reports for results. The full RRA+MLE spheroid WT report is https://www.splicr.org/dashboard/screens/01a11702-77cc-72e2-9307-ab884d26facb. All six full runs are now complete; still distinguish completion from scientific reproduction.

The application's infrastructure is **Cloudflare R2** for objects, **Supabase** for authenticated workspace records and results, **Modal** for analysis compute and **Vercel** for the frontend. “CloudFresh” and “Superb” appear to refer to Cloudflare and Supabase.


## Open a completed full RRA+MLE report during the meeting

Sign in and select **Ferrarone 2024 · SplicR demo**. These saved reports do not submit jobs.

- [2D EV versus plasmid, full RRA+MLE](https://www.splicr.org/dashboard/screens/01a11702-7768-7702-a4c2-2e0abe2bd450)
- [2D WT versus plasmid, full RRA+MLE](https://www.splicr.org/dashboard/screens/01a11702-77ae-7e9c-b85d-3d65a33f81f6)
- [2D WT versus EV, full RRA+MLE](https://www.splicr.org/dashboard/screens/01a11702-77b6-7ee0-b7c2-68dbef85873d)
- [Spheroid EV versus plasmid, full RRA+MLE](https://www.splicr.org/dashboard/screens/01a11702-77c5-7ee8-838c-af193eeb7793)
- [Spheroid WT versus plasmid, full RRA+MLE](https://www.splicr.org/dashboard/screens/01a11702-77cc-72e2-9307-ab884d26facb)
- [Spheroid WT versus EV, full RRA+MLE](https://www.splicr.org/dashboard/screens/01a11702-77d5-7337-a508-5e019fee91c0)

## Separate completed RRA validation reports

These links require signing in and selecting **Ferrarone 2024 · SplicR demo**. They open the completed RRA validation reports and do not submit analysis jobs.

- [2D EV versus plasmid](https://www.splicr.org/dashboard/screens/01a1172c-7800-716b-9625-911c32762a0d)
- [2D WT versus plasmid](https://www.splicr.org/dashboard/screens/01a1172c-780b-76af-8ae4-be09024c78a7)
- [2D WT versus EV](https://www.splicr.org/dashboard/screens/01a1172c-7815-7af1-ac4e-cfbeffc9bd77)
- [Spheroid EV versus plasmid](https://www.splicr.org/dashboard/screens/01a1172c-77b7-7e57-816e-2c1aaf9516cb)
- [Spheroid WT versus plasmid](https://www.splicr.org/dashboard/screens/01a1172c-77eb-76fb-a66c-3477d68cdca9)
- [Spheroid WT versus EV](https://www.splicr.org/dashboard/screens/01a1172c-77f8-7999-9fa8-81c35c90f18b)

No invitations or emails were sent. The workspace contains actual analyses of public deposited counts; a separately named synthetic E2E fixture screen, if visible, is not part of the scientific demo.

When opening CSV in Excel, import it with **Data → From Text/CSV** and set the gene-symbol column to Text. Double-clicking a CSV can turn historical gene symbols into dates again. The export includes this warning and instructions for reading its comment-prefixed provenance.
