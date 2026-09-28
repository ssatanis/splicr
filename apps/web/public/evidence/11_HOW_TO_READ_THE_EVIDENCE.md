# How to read SplicR's evidence

This guide explains what the measurements mean and what they can prove. Measured results from the current work belong in `05_BENCHMARK_REPRODUCTION.md`, `08_VALIDATION_REPORT.md` and `10_FINAL_RESULTS.md`. The examples below teach interpretation; they are not additional experimental results.

## Before a screen and after a screen are different questions

**Before:** A scientist describes a cell line, treatment and desired phenotype. SplicR ranks genes likely to matter. It has not seen that experiment's counts or answers. This is the main AssayBench prediction task.

**After:** The scientist supplies guide counts and replicates. Statistical tools estimate which perturbations changed the measured outcome. SplicR can then help distinguish well-supported effects from artifacts and select follow-up experiments. This uses much more information, so its performance cannot be reported as description-only prediction. MAGeCK and DrugZ belong here. [AssayBench task](https://github.com/Genentech/AssayBench), [MAGeCK](https://pmc.ncbi.nlm.nih.gov/articles/PMC4290824/).

**During follow-up:** Some candidates have been tested, and their outcomes help choose the next batch. This is adaptive experimental selection. Its proper comparison is the number and variety of discoveries made with the same budget. [AssayLoop](https://arxiv.org/abs/2609.11877).

## AnDCG is a ranking score, not percentage accuracy

AnDCG@100 asks whether useful genes appear near the top of a list of 100. More relevant genes receive more credit, and earlier ranks matter more. Genes with the opposite effect can subtract credit. The score is normalized against an ideal list and adjusted for the screen's random baseline. The official implementation clamps scores below zero. [Metric explanation](https://genentech.github.io/AssayBench/metric.html).

An AnDCG of **0.16 does not mean 16% of predictions are correct**, nor does it mean any individual gene has a 16% validation probability. Precision@10 answers a different, more direct question: among the scored top candidates, how many are hits under the benchmark's definition? Neither number alone measures independent wet-lab validation.

Imagine the first five predictions include two genes the screen never measured. Under the official DCG rule, those entries are removed only after the top-five cutoff. Predictions six and seven cannot move up to replace them. Silently doing that changes the evaluation. Library-aware predictions can be useful, but the available inputs and comparison rules must be declared.

Because negative adjusted deviations are clamped to zero, the average score of random finite lists can be slightly positive. An empirical random baseline should therefore be measured with recorded seeds rather than assumed to be exactly zero.

## What would count as an improvement?

Suppose an illustrative baseline scores 0.10 and a candidate scores 0.12 on the same untouched screens. The absolute improvement is 0.02; the relative improvement is 20%. Those describe the same change. Neither establishes that the candidate will improve every phenotype or every laboratory.

The next questions are: Were the inputs identical? Was the candidate chosen using these answers? How many independent studies are represented? Is the gain concentrated in one large study? Does the uncertainty interval include no improvement? Does it persist on future experiments? An honest report answers all of them.

The oracle row is another special case. It chooses the historical screen that best matches the target **after seeing the target answers**. It indicates useful headroom for a restricted family of donor rankings, but it cannot be deployed and is not a mathematical ceiling on all models.

## “Held out” only helps if it stayed hidden

A training set fits the model. A development or validation set chooses features and settings. A final test set estimates how the frozen choices perform on data they did not influence.

If developers repeatedly inspect a public test set and change the model in response, it becomes development evidence. A later model can still obtain a real, reproducible score there, but that score has a weaker claim to independence. Splitting the same familiar public data again does not erase this history.

A prospective evaluation is stronger: freeze predictions first, then collect or reveal independent outcomes under a predeclared protocol. Public LaTest screens can test a different distribution, but once their answers have been examined, calling them “prospective” would be inaccurate. Unknown LLM pretraining data also makes historical memorization difficult to rule out. [Official benchmark discussion of recent screens](https://genentech.github.io/AssayBench/).

## Why uncertainty should respect studies

One publication may contribute many related screens: the same cell line, library, treatment series or two directions of one experiment. Those screens share sources of error. Counting them as independent repetitions makes the evidence seem stronger than it is.

A **paired study bootstrap** samples whole studies with replacement and recomputes the difference between methods on the same sampled studies. Keeping paired predictions together removes irrelevant variation between different test sets; keeping study members together respects their dependence. Report both screen-weighted and study-weighted summaries if they answer different operational questions.

A 95% interval describes uncertainty under the resampling assumptions. It is not a guarantee that the model works in a new laboratory or that 95% of its genes are correct. With few independent studies, even a large number of gene rows may provide weak evidence.

## p-values, FDR and validation probability mean different things

| Quantity | What it addresses | What it does not establish |
|---|---|---|
| Effect size | Magnitude and direction of the measured change | Whether the result is statistically reliable or will replicate |
| p-value | How incompatible the data are with a stated null model | Probability that a gene is a false hit |
| FDR/q-value result | Error control for a selected collection under a statistical procedure | A gene's chance of successful independent validation |
| BAGEL Bayes factor | Relative evidence under essential/nonessential reference models | Universal probability of phenotype-specific validation |
| Ranking score | Priority relative to other candidates under that model | A calibrated numerical probability |
| Calibrated validation probability | Frequency of a precisely defined validation event among comparable predictions | Certainty for an individual experiment or transfer to an untested assay type |

In particular, **`1 − FDR` is not a validation-success probability**. Calibration needs actual independent validation outcomes and evaluation on outcomes not used to fit the calibration. Reliability plots, Brier score and log loss help test that relationship. [Calibration research](https://proceedings.mlr.press/v70/guo17a).

If a laboratory has not tested a candidate, the outcome is unknown. Recording it as a failure would teach the model a false lesson. Published positive validations also tend to be selected for promise and novelty, so they may not represent the full candidate population. [Research on selected positive labels](https://arxiv.org/abs/1808.08755).

## Real, reproducible, independent and prospective are separate properties

| Evidence label | Meaning |
|---|---|
| Real measured data | Values came from an identified experiment, with provenance |
| Reproducible computation | The specified files, code and settings recreate the result |
| Independent evaluation | Evaluation answers did not determine the fitted model or its selection |
| Prospective evaluation | Predictions were fixed before future outcomes were obtained or disclosed |
| Demo / illustrative | Values demonstrate the interface and do not support scientific claims |

A real public dataset can be used in a reproducible analysis that still has leakage. Passing software tests establishes behavior on those tested cases; it does not establish biological accuracy. A polished demo establishes neither prediction quality nor customer outcomes.

SplicR's repository has explicit demo data and separate organization-data paths. Reports should carry the mode and source, and any absent calibration should remain absent. A statement like “this guide was observed to drop out” is an experimental fact; “this gene may be worth validating” is a recommendation; “this pathway explains the effect” is a hypothesis until independently supported.

## How to inspect a result yourself

Start with the final result table, then follow the artifact paths to the exact dataset hash, evaluator revision, model configuration and per-screen predictions. Check whether the reported uncertainty groups related studies. Read the failed experiments and subgroup results, not only the best number. Finally, check whether the claimed product benefit has a matching endpoint: better AnDCG supports ranking evidence; fewer wasted validation experiments requires validation outcomes.

This is how SplicR can earn scientific trust: make each claim specific enough that another researcher can reproduce it, challenge it and find its limits.
