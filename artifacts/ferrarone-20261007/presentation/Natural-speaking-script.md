# Natural speaking script for the SplicR meeting

Use these paragraphs as talking notes. Pause at screenshots and point to the part you are describing. Slides 19 and 20 are appendix material you can use when needed.

## Slide 1 — Introduction
Hi John, thanks for taking the time to meet with us. We’re Sahaj, Pranav and Ishaan, and we’re Cornell students who built SplicR. We’ve been reading your paper, and we thought the published CRISPR data would be a useful way to test our workflow. We’d like to walk you through how we handled those files, show you the results and hear what would be useful for your lab.

## Slide 2 — Why this paper
What interested us was how LKB1 restrains growth in spheroids, and how your screen and follow-up experiments connect that to the PIKFYVE complex. The figure here is your original Figure 4, showing part of that experimental story. For this demo, we focused on the deposited CRISPR counts and how we could make the analysis easier to set up and inspect.

## Slide 3 — Preserving the experiment
Before running anything, we wanted to make sure we understood the experiment. There are cells without working LKB1 and cells where LKB1 was restored, grown in either flat culture or spheroids. Each endpoint group has two replicates. We kept those groups separate and preserved the shared plasmid reference, which represents the starting guide library.

## Slide 4 — Checking the files
The first step was checking that we had the right files. Both downloads match the deposited archive, and all 70,116 observed guide IDs match TKOv3. We also found gene labels that looked like spreadsheet date conversions. Because the guide IDs were intact, we could recover the corresponding gene labels without changing any read counts.

## Slide 5 — What upload looks like
This is a screenshot of the upload step. You can see the two original count files here, one for flat culture and one for spheroids. These tables already tell us how often each guide appears in each sample, so we can start from the deposited counts. For this workflow, the researcher doesn’t need to reprocess the raw sequencing reads.

## Slide 6 — Matching the guide library
Once the files are uploaded, SplicR checks the guide IDs against the reference libraries. Here, every observed guide matches TKOv3, so that library is selected. This matters because the library connects each guide to its intended gene. The researcher can see the match and review or change the selection before continuing.

## Slide 7 — Reviewing the comparisons
This screenshot shows the comparison plan. For each culture, we compare the LKB1-null group with the plasmid reference, the restored group with that reference, and the two endpoint groups with each other. That gives six comparisons in total. SplicR suggests this plan for the verified files, and the researcher can check the samples and change the choices.

## Slide 8 — Choosing the settings
Here’s the configuration step. The researcher can choose normalization, the FDR threshold and the methods they want to run. For this analysis, we used median normalization and included both RRA and MLE from MAGeCK. We save those choices with the run, so someone reviewing the results later can see exactly how the analysis was set up.

## Slide 9 — Following a run
This screenshot was taken while a real analysis was running on Modal. It shows the current stage, elapsed time and stages already completed. All six full analyses have now finished. The progress bar reflects completed stages, rather than predicting how much computing time remains, so it helps the researcher follow what the system is doing.

## Slide 10 — Understanding the report
This is the completed spheroid WT-versus-plasmid report. It shows 178 RRA candidates, with 172 flagged for review. Those flags mean there’s evidence to inspect. For example, 154 candidates have annotations for broad cell-survival dependencies. A survival gene can produce a real depletion signal without being specific to LKB1. We also keep the replicate-quality warning visible, so the researcher knows what needs attention.

## Slide 11 — Looking across the comparisons
Here we’re looking across all six comparisons. Each one scores all 18,049 observed genes, and this chart uses the separate RRA validation batch. The bars show how many genes pass our declared threshold in each comparison. Where the count is zero, no gene passes that threshold under these settings. That alone doesn’t establish that there’s no biological effect.

## Slide 12 — The genes from the paper
This is the table we wanted to spend a little more time on. It shows FIG4, VAC14 and PIKFYVE, with RRA fold changes alongside MLE beta scores and FDRs. FIG4 and VAC14 have positive effects in this comparison, but none of these three genes passes MLE FDR 0.05 here. Your paper used beta-score nomination and follow-up experiments, so the criteria differ. We’d like to understand your original design and filtering before claiming an exact reproduction.

## Slide 13 — Taking the results out
This screenshot shows the export controls and the saved run information. The researcher can download all 18,049 gene rows, including genes outside the current page of the table. CSV provides a table for further analysis, and JSON includes structured report information. The separate method statistics and recorded settings let another analyst inspect how we reached these results.

## Slide 14 — What we measured
We measured the RRA and full RRA-plus-MLE batches separately. The six RRA jobs span 6 minutes 2 seconds, and all four checked statistics match our independent local calculation exactly across every gene. The initial full batch took 5 hours 5 minutes, including retries. Both timings exclude upload and pre-start waiting. We haven’t measured the time savings against your lab’s current workflow.

## Slide 15 — How this compares with Apron
We also looked at Broad’s Apron workflow. It already provides guided analysis, QC and exports. What we’ve demonstrated here is recognizing these exact published files, repairing the annotations through guide IDs and preparing editable comparisons. Those are concrete parts of our workflow. A pilot would let us measure whether they reduce setup and review effort for your lab.

## Slide 16 — Where SplicR fits
MAGeCK supplies the statistical methods we’re using, and other tools already offer useful web analysis. Our focus is bringing the steps into a shared workspace, from upload and configuration through results and export. That keeps the choices and supporting evidence together when researchers review a screen or hand the analysis to a colleague.

## Slide 17 — Using it for other screens
This screenshot shows the sample information researchers can edit, including roles, replicates and experimental factors. The library and comparisons can also change for a different screen. For a new project, we’d check the inputs and assay requirements and make sure the methods fit. This demo gives us evidence for this pooled knockout workflow, while other assay types need their own validation.

## Slide 18 — What we’d like to do next
What we’d really like to understand is how your lab handles these analyses today and where the process takes the most effort. We could start by agreeing on a reference analysis, reviewing differences together and then trying SplicR on a new screen. That would give us a practical way to measure where it helps and what needs to improve.

## Slide 19 — Methods, if useful
This slide summarizes the methods and the work that remains. We used the deposited counts, guide-ID annotations and declared MAGeCK settings. We independently checked the RRA calculation, and all six full RRA-plus-MLE reports are complete. The next step toward reproducing the paper is matching the original filtering, design and selection criteria. Experimental follow-up would still be needed to validate new candidates.

## Slide 20 — Sources and follow-up
Everything we’ve shown comes with the original inputs, recorded settings and saved outputs. We can share all six complete RRA-plus-MLE result packages, along with the separate RRA validation packages. The link here opens the completed spheroid WT report, so we can look more closely at the gene table and exports if that would be useful.
