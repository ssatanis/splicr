# Meeting preparation: understand the paper, explain SplicR, and speak naturally

## Start here

The lab did an experiment to find genes that affect how lung cancer cells grow. The experiment produced large tables of numbers. SplicR helps turn those tables into results that a researcher can inspect, discuss and download.

Your role in the meeting is to explain that workflow, show what worked on their actual data, and invite a scientific comparison with their usual analysis. You do not need to pretend to be the person who designed their experiments.

A useful opening is:

> Hi John. I’m Sahaj, and these are Pranav and Ishaan. We’re Cornell students, and we built SplicR to help researchers analyze CRISPR screens. We came across your paper on LKB1 and spheroid growth, and we wanted to see how our workflow handled a real published experiment. We studied the paper and used the data you deposited. Today we’d like to show you the workflow, explain what we checked, and hear what would make it useful for your lab.

Practice that in your own words. Say “we studied the paper” only if you have personally worked through the explanation and figures. It is also natural to say “we’ve been studying the paper.” You do not need to invent a story about exactly where you first saw it.

## Understand the science first

**A gene** is a section of DNA that helps a cell make a functional product, often a protein. Proteins help cells grow, respond to signals and carry out other tasks.

**LKB1** is a protein that helps restrain cell growth. Its gene is also called **STK11**. It is a tumor suppressor: losing its normal function can remove a restraint on cancer growth.

The researchers used **A549**, a human lung cancer cell line. A cell line is a population of cells researchers can grow and study repeatedly. These cells lacked working LKB1. The researchers compared them with cells in which they restored working LKB1.

They grew the cells in two environments. **2D** means a flat layer. **Spheroids** are small three-dimensional clusters of cells. The paper found that LKB1's growth restraint depended on that environment and was stronger in spheroids.

The next question was: **Which other genes help LKB1 restrain growth?**

They used a **CRISPR screen**. CRISPR can disrupt genes. A screen tests many disruptions across a large population of cells. Most genes have several guides directed at them, so the researcher gets several pieces of evidence for a gene.

A **guide** directs CRISPR toward a particular DNA target. Researchers can also track the guide sequence. After the experiment, sequencing counts how often each guide appears. If a guide becomes more common, cells carrying that disruption may have gained an advantage. If it becomes less common, those cells may have lost an advantage. The counts measure relative abundance, so sequencing depth and experimental variation also need to be considered.

Imagine disrupting a gene that normally helps restrain growth. Cells with that disruption might become more common. Their guides could become **enriched**. Disrupting a gene that cells need to survive might make its guides **depleted**.

The screen pointed to **FIG4** and **VAC14**. Those proteins work in a complex with **PIKFYVE**. The complex helps regulate lipids and how cells move material through internal compartments. Follow-up experiments linked it to how cells take in growth factor receptors. Growth factor receptors help cells receive signals from their surroundings.

The important distinction is that **PIKFYVE was not itself an enriched guide hit in the WT spheroid screen**. The authors investigated its role through additional experiments. For example, inhibiting PIKFYVE with apilimod released some of the growth restraint in cells with restored LKB1. A resistant PIKFYVE mutant helped establish that the drug effect involved the intended target.

Your one-sentence explanation of the paper can be:

> Your paper shows that LKB1 restrains growth in spheroids through the PIKFYVE complex, and it connects that mechanism to how cells handle growth signals.

John already knows the biology. Use this background to understand the discussion; you do not need to give him a basic CRISPR lesson.

## Understand the files and comparisons

**EV** means empty vector. In this experiment it identifies the LKB1-null group. **WT** identifies the group with restored wild-type LKB1. **d21** means the endpoint after 21 days. **a** and **b** are endpoint replicate labels.

The **plasmid reference** describes the starting guide-library mixture. It is one shared reference in both tables. It is not another biological replicate or a cellular day-zero sample.

The two files contain 70,116 observed guides each. Exact guide IDs map to 18,049 historical TKOv3 gene annotations. There are 104 date-like gene labels per file, consistent with spreadsheet conversion. SplicR recovers the gene labels from guide IDs while keeping the count values unchanged.

SplicR suggests three comparisons in each culture:

1. **EV versus plasmid:** which disruptions change in abundance in LKB1-null cells?
2. **WT versus plasmid:** which disruptions change after LKB1 is restored?
3. **WT versus EV:** how do the endpoint groups differ?

Three comparisons in two cultures give six comparisons. Comparing cultures formally requires an interaction analysis; finding a significant gene in one culture and not the other is not enough by itself.

## Understand the result terms

**Normalization** adjusts for differences such as sequencing depth, so a sample with more total reads does not automatically look enriched everywhere. Median normalization is the declared setting for this reanalysis.

**Log₂ fold change** describes the size and direction of a relative abundance change. +1 is roughly twice the relative abundance; −1 is roughly half. A large change can still be uncertain.

**FDR** accounts for testing thousands of genes. A threshold of 0.05 concerns the expected proportion of false discoveries among a set of called discoveries, under the statistical method's assumptions. It does not give a gene a 95% chance of being biologically correct. FDR 1 does not prove a gene has no biological role.

**RRA** and **MLE** are two analysis methods provided by MAGeCK. RRA combines evidence from guide rankings. MLE fits an explicit experimental model and gives genes beta scores. The paper used MLE. Showing our RRA result is not the same as reproducing its MLE analysis.

The paper reports two different beta-score selection rules for the pathway analysis shown in Figure 3D:

| Published passage | WT spheroid beta | EV spheroid beta |
| --- | --- | --- |
| CRISPR-screen methods, pathway-analysis input | >0.5 | <0.5 |
| Figure 3D caption, pathway-analysis input | >1 | <1 |

I rechecked both passages in the [paper's full text](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC11127050/fullTextXML). The difference is in the published descriptions. They do not establish which rule actually generated Figure 3D, whether the two passages describe different analysis versions, or whether either passage contains a typographical error.

These are **beta-score selection cutoffs for pathway analysis**, not FDR cutoffs. Beta is a model-estimated gene effect; FDR concerns statistical error among discoveries. Neither beta >0.5 nor beta >1 establishes FDR <0.05. These passages should not be presented as the significance rule for every gene in the screen.

Also, the rule with 1 is not uniformly stricter: it raises the WT requirement while allowing a higher EV score. The two rules can select different, overlapping lists. Do not choose a rule because it produces more appealing candidates.

For the meeting, call this a **reported cutoff difference to clarify**, rather than leading with “the paper's own inconsistency.” You can ask:

> To reproduce the pathway analysis in Figure 3D, we want to confirm the beta cutoffs. The methods give WT >0.5 and EV <0.5, while the caption gives WT >1 and EV <1. Which rule was used for that figure?

This is a reproducibility question. It does not show that the paper's biological conclusions are wrong, explain every difference in our results, or establish that SplicR is more accurate.

A **quality warning** means there is something in the experiment to review, such as disagreement between replicates. An **artifact flag** identifies a possible issue with a candidate, such as evidence dominated by one guide. Neither automatically proves that the candidate is false.

**Biological validation** means testing the candidate in additional experiments. A complete software run and matching statistics do not replace that work.

## What SplicR does, in ordinary language

SplicR checks the uploaded files, looks for a suitable guide library, prepares a comparison plan, lets the researcher review the settings, runs established statistical tools, and shows the results with supporting evidence.

For these exact published files, it recognizes the study from their checksums and schemas. That lets it suggest the known sample design. For unfamiliar data, proposed settings still need review. File names alone cannot reliably tell the software what an experiment means.

Researchers can change sample roles, replicates, guide libraries, normalization, statistical settings and comparisons. We tested custom libraries, correcting count columns, editing metadata, saving and resuming a draft, and FASTQ reads with adapter prefixes. That is useful flexibility. It does not validate every organism, perturbation type or assay.

The frontend is the website. The backend reads the reviewed plan, runs the analysis and stores the results. Cloudflare R2 stores input objects. Supabase stores authenticated workspace records and results. Modal runs the analysis. Vercel serves the frontend. In the meeting, explain that as:

> Researchers use one workspace to upload, configure, follow progress, inspect results and export the evidence.

## What the demo proves today

Six RRA analyses are complete. Each scores 18,049 genes. Their fold changes and three checked FDR fields match an independent local calculation exactly across every gene. The recorded RRA workers took 97–126 seconds each; the first worker start to the final worker finish was 6 minutes 2 seconds. That excludes uploads, pre-start waiting, MLE and sequencing alignment.

All six reports retain quality warnings. The WT spheroid RRA report has 178 candidates at the declared combined FDR threshold. Of these, 176 are depleted and 2 enriched. 172 have at least one artifact flag. 154 carry a stored DepMap pan-essential annotation, consistent with many general survival dependencies in this plasmid comparison. A pan-essential gene helps cells survive across contexts, so it can be a real depletion hit without being specific to LKB1. The other recurring-hit flags and guide-specificity flags can overlap. Counts across flag categories must not be added as distinct genes. FIG4 and VAC14 have positive fold changes but are not significant calls in this RRA configuration. The paper's MLE nomination and experimental follow-up are different evidence criteria.

All six full RRA+MLE analyses have now completed and their browser exports contain every scored gene. Their RRA statistics agree exactly with the separately completed RRA validation cohort. The full initial cohort took 5 hours 5 minutes, including retries and the original worker allocation. The six-minute number applies to RRA alone.

The full spheroid WT-versus-plasmid MLE result gives FIG4 beta +1.83/FDR 0.576, VAC14 +3.21/FDR 0.192 and PIKFYVE +0.44/FDR approximately 1. None passes MLE FDR 0.05. The paper used beta-score nomination and follow-up experiments, so these evidence criteria must be kept distinct. We still need the authors’ original design and filtering details before claiming exact reproduction.

No fitted biological success-probability model is available for these screens. The system refuses those estimates instead of inventing them. There is no bench validation recorded for this demo.

## What to say on every slide

### 1. Introduce yourselves

> Hi John. We’re Sahaj, Pranav and Ishaan, Cornell students who built SplicR. We’ve been studying your paper and used the deposited data to test a complete analysis workflow. We’d like to show you what works and hear what your lab would need.

### 2. Connect to the paper

> The question we took from your paper is how LKB1 restrains growth in spheroids. Your screen points to the PIKFYVE complex, and the follow-up experiments connect it to growth factor receptor trafficking. We used the CRISPR data behind that story.

The figure is the authors’ original Figure 4. Do not describe it as a SplicR result.

### 3. Show that you preserved the experiment

> We kept the LKB1-null and restored groups separate, and we kept 2D and spheroid culture separate. Each endpoint group has two replicate samples. Both files use the same plasmid reference.

### 4. Explain the data checks

> Both files match the deposited archive. Every observed guide matches TKOv3. We also used guide IDs to recover date-like gene labels, without changing the counts.

### 5. Show upload

> A researcher can upload the original count tables. For this workflow, there is no need to download and align the sequencing reads again.

Count analysis and reprocessing raw sequencing are different workflows.

### 6. Show library identification

> SplicR checks the guide IDs and selects TKOv3 for these files. The researcher can see the mapping and change the library if needed.

### 7. Show comparison suggestions

> It prepares the three comparisons for each culture. The researcher reviews the samples before proceeding, so the scientific choices remain explicit.

### 8. Show configuration

> The researcher can change normalization, the FDR threshold and the methods. The reviewed plan is saved with the run. This setup includes MLE. The main report and gene table show the completed full run; the candidate-count chart uses the separate RRA validation batch.

### 9. Show progress

> This screenshot was captured while a real analysis was running on Modal. All six full analyses are now complete. The website shows recorded stages and elapsed time. The stage bar is not a prediction of how much computation time remains.

The screenshot is a dated snapshot. Open the completed live reports to show the final state.

### 10. Show the completed report

> This report has 178 RRA candidates, and 172 have something flagged for review. That does not mean 172 errors. Most candidates are depleted, and 154 have a pan-essential annotation, so many look like general survival dependencies. A plasmid comparison captures those as well as possible context-specific effects. We keep the warnings visible and inspect the WT-versus-EV comparison when asking about LKB1 specificity.

### 11. Show the six results

> Each of these comparisons scores the full observed gene set. These are RRA candidate counts under the settings we declared. A zero count means no gene passes that threshold here; it does not prove there is no biological effect.

### 12. Discuss the important genes honestly

> This table shows RRA fold changes alongside the completed MLE results. FIG4 has MLE beta 1.83 and FDR 0.576. VAC14 has beta 3.21 and FDR 0.192. PIKFYVE has beta 0.44 and FDR about 1. None passes MLE FDR 0.05 here. Your paper nominated genes using beta scores and then tested them experimentally, so a positive effect and an FDR call answer different questions. We want to align the original design and filtering before calling this an exact reproduction.

This is a good place to invite scientific guidance: “It would help us to understand your original MLE design and filtering settings.”

If the discussion reaches pathway selection, ask the Figure 3D cutoff question above. Keep it separate from our FDR 0.05 result interpretation.

### 13. Show export

> The researcher can download all 18,049 gene rows. The results keep separate method statistics, settings and quality information, so another analyst can inspect the analysis.

The demonstrated application exports are CSV and JSON. Do not promise an untested application PDF export.

### 14. Explain measured performance

> The six RRA jobs finished across a six-minute span and match our independent local calculation exactly. The initial full RRA plus MLE cohort took 5 hours 5 minutes, including retries. We have not measured a speed advantage over your original workflow.

### 15. Compare with Broad Apron

> Apron already offers useful QC and guided analysis. For these files, SplicR identifies the exact published inputs, repairs gene labels through guide IDs and prepares six editable comparisons. The report keeps flags beside the recorded results. We have not measured an accuracy advantage over Apron. A pilot would let us compare the workflows properly.

The unexplained Atlas phrase has been removed from the slide. If asked about Atlas elsewhere in the application: “Atlas uses previous screens to show whether a gene often appears as a hit, which provides context rather than validation of this result.” The saved receipt shows a benchmark publication-exclusion policy. It does not prove that Ferrarone’s paper itself was held out, so do not make that claim.

Do not say Apron lacks QC, plots, exports or a web interface.

### 16. Explain your place alongside other tools

> MAGeCK supplies established statistical methods, and tools such as PinAPL-Py also offer web analysis. SplicR brings those kinds of analysis steps into a shared, reviewable workflow. Our value needs to be measured in setup time, reproducibility and usefulness to the researcher.

### 17. Explain use by other labs

> The researcher can change libraries, sample roles, replicates and comparisons. The configuration follows the experiment. Different assays still need suitable methods and their own validation.

### 18. Propose a useful next step

> We’d like to agree on a reference analysis with you, review any differences together and try the workflow on a new screen. That would tell us where it saves time and what needs improvement for your lab.

### 19. Methods appendix, if asked

> We used the deposited counts, guide-ID annotation and MAGeCK with declared settings. We kept the warnings and left unavailable predictions unavailable. The original filtering details and MLE design still need reconciliation.

### 20. Sources and files

> We can share the original input files and all six complete RRA plus MLE result packages, with settings and receipts. The separate RRA validation packages are also included. This link opens the completed full spheroid WT report, where we can inspect the table and download the results.

[Open the full spheroid WT RRA+MLE report](https://www.splicr.org/dashboard/screens/01a11702-77cc-72e2-9307-ab884d26facb). Sign in and select **Ferrarone 2024 · SplicR demo**.

**“Why are so many candidates flagged?”**

> A flag is a reason to inspect the evidence. For example, 154 of these candidates have a pan-essential annotation, which means they are known as broad survival dependencies. That can explain real depletion in a plasmid comparison. Other flags concern guide specificity. Neither annotation alone proves the gene is false or specific to LKB1.

## Questions you should be ready for

**“Did you reproduce our paper?”**

> We verified the input files and reproduced our own declared RRA calculation locally and in the cloud. That is not an exact reproduction of your paper. The full MLE computation is complete; a paper reproduction still needs the same design, filtering and nomination criteria.

**“Is it more accurate than MAGeCK or Apron?”**

> We have not established that. MAGeCK is part of our statistical foundation. We can demonstrate workflow improvements for these files, and we would evaluate accuracy and analyst effort in an agreed benchmark.

**“Why are FIG4 and VAC14 not significant?”**

> Slide 12 shows both RRA and MLE under our declared configuration. Your paper used MLE beta-score nomination and follow-up experiments. We also see replicate-quality warnings. Our completed MLE also retains nonsignificant FDR values. We need to examine the same analysis design before attributing the difference to a cause.

**“What does the intelligence system do?”**

> It helps inspect inputs, match libraries, recognize this verified study and suggest a reviewable plan. It also keeps supporting context with results. It does not replace the researcher's experimental choices or experimental validation.

**“Can it work on our other projects?”**

> The workflow supports editable libraries, samples and comparisons. We would check the requirements of each new screen and validate the appropriate methods. This demo is evidence for a human pooled Cas9 knockout count workflow.

**“How much time does it save?”**

> The six RRA jobs span 6 minutes 2 seconds. The full initial RRA+MLE cohort spans 5 hours 5 minutes, including retries and its original allocation. Both exclude upload and pre-start waiting. We have not measured your lab's analyst time. A pilot could compare the full setup, review and export process with your current workflow.

**“Can it predict which hits will validate?”**

> No fitted success-probability model is available for these screens. A model would need outcome data and independent validation. For now, the report presents statistical and guide-level evidence for review.

**If you do not know an answer:**

> I don’t want to guess. Let me write that down and check the method or the recorded run settings.

That is a professional answer. It is better than improvising a scientific explanation.

## A simple way to divide the meeting

Sahaj can introduce the team and explain the paper context. Pranav can walk through upload and configuration. Ishaan can show results, exports and verification. Choose roles that fit what each person actually knows, and have one person handle the live browser so the handoffs stay smooth.

Before the call, open the offline HTML deck, the completed full spheroid WT RRA+MLE report and the downloaded CSV. Sign in with your usual account and select **Ferrarone 2024 · SplicR demo**. You can show upload and plan review without clicking Initialize. Use the existing completed results for the live demonstration.

Leave time to hear how the lab currently analyzes screens, where the workflow is difficult, which original settings they want matched and what result would make a pilot worthwhile.

## Read these sources

- [The original PNAS paper](https://doi.org/10.1073/pnas.2403685121)
- [The CRISPR data deposit](https://doi.org/10.7910/DVN/8DEPIT)
- [Broad post-screen resources](https://portals.broadinstitute.org/gpp/public/resources/post-screen)
- [Apron user guide](https://docs.google.com/document/d/14ry2-S3zWCwJVZzxS2QLSdNGqyl6QaFK7rhkcyh7jXU/preview)
- [MAGeCK documentation](https://sourceforge.net/p/mageck/wiki/usage/)

For the full live result, open https://www.splicr.org/dashboard/screens/01a11702-77cc-72e2-9307-ab884d26facb after selecting the demo workspace. If you use Excel, import the CSV through Data → From Text/CSV and set gene_symbol to Text; do not double-click it and allow gene names to turn into dates.
