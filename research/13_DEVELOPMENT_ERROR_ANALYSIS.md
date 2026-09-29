# Development-only failure analysis

Date: 2026-09-28. **This is exploratory analysis of training and validation data, not a new held-out performance claim.** Its purpose is to identify concrete hypotheses for the next controlled experiments. No public-test screen errors were inspected, evaluated or used to select these recommendations in this phase. Earlier work's exposure to the public benchmark remains a limitation; this restriction does not make the validation set new or untouched.

## Scope and reproducibility

- Training: 1,349 screens, 134 publication identifiers, through 2020.
- Validation: all 218 screens, 34 publication identifiers, 2021.
- The scanner permits only `train` and `validation`, filters the Parquet split before returning rows, and asserts expected cohort sizes and no publication overlap.
- Historical candidate predictions and their saved official validation evaluations are reused. The published ensemble, Gemini 3 Pro and GPT-5.4 cached predictions are selected for `split=val`, `split_layout=year`, then reevaluated with the installed official evaluator. No model API was called.
- Target measured genes and relevance values enter **diagnostics/evaluation only**, never new candidate generation. The gene-exposure counts use training labels only. No new ranking model was fitted in the initial failure analysis; training-only TF–IDF supports a donor diagnostic. The separately preregistered follow-up model experiment is documented below.
- All reported uncertainty is descriptive publication-cluster bootstrap, 4,000 draws, seed 20260928. Many related questions are examined; these intervals are not multiplicity-adjusted confirmatory discoveries.
- Original dataset, prediction, metric and analysis hashes are recorded in [summary.json](artifacts/20260928/error_analysis/summary.json). Fine-grained evidence is in [validation diagnostics](artifacts/20260928/error_analysis/validation_screen_diagnostics.json), [training exposure](artifacts/20260928/error_analysis/training_gene_exposure.json), [donor diagnostics](artifacts/20260928/error_analysis/validation_donor_diagnostics.json) and [supplement](artifacts/20260928/error_analysis/supplement.json).

```sh
PYTHONPATH=engine engine/.tools/env/bin/python research/artifacts/20260928/error_analysis/analyze.py
PYTHONPATH=engine engine/.tools/env/bin/python research/artifacts/20260928/error_analysis/supplement.py
```

These reproduce diagnostics and overwrite only their dedicated local outputs. The corrected main diagnostic took 38.4 seconds in this run; peak memory was not instrumented. An initial diagnostic process was interrupted when review found `Counter.update(mapping)` was adding mapping values rather than measurement counts. It was changed to `update(keys)`, integer/exposure bounds were asserted, and the complete corrected diagnostic was rerun. The interrupted log is retained; none of its results contributes to the findings below. This was an error in this new diagnostic script, not a newly discovered production-model error.

## 1. The most actionable failure is candidate coverage

Coverage below means the number of measured genes among the original top 100 returned slots. The evaluator's cutoff and condensation are unchanged. An unmeasured gene is not necessarily an invalid gene or biological non-hit.

| Existing candidate | Validation AnDCG@100 | Mean measured top-100 | Median measured top-100 | Fraction of prediction slots measured in fewer than 10 training screens |
|---|---:|---:|---:|---:|
| Published ensemble | 0.186437 | 79.09 | 87 | 0.10% |
| Global prior | 0.112560 | 46.27 | 47 | 4.00% |
| Phenotype prior | 0.082801 | 18.67 | 0 | 69.17% |
| Direction hierarchy | 0.058144 | 9.12 | 0 | 77.09% |
| Historical TF–IDF transfer | 0.047256 | 7.79 | 0 | 73.25% |
| Text ridge, alpha 10 | 0.114912 | 46.35 | 46.5 | 0.00% |

**Conditional priors overrank poorly supported genes.** The phenotype prior's prediction slots have a median of three training measurements. Its first drug-screen predictions include HGNC-valid pseudogenes and noncoding genes. For example, USP17L14P, USP17L16P and USP17L6P each have three measured/positive training screens from one publication. Their unsmoothed rate is 1.0. This is evidence of sparse estimation, not proof those genes are artifacts. Banning pseudogenes would be an unjustified biological rule.

The global prior is less affected by rare-gene inflation: only four of its 100 genes have fewer than 10 measurements. It still predicts the same 100 genes across validation, dominated by recurrent fitness signals. Removing four rare genes alone cannot explain or solve its much larger focused-library coverage failure. Ridge removes the rare extremes but retains similar coverage and strongly overlapping behavior.

**Code-level limitation:** `HistoricalRanker` initializes the global rate with zero shrinkage; `PriorConfig.shrinkage` applies only in hierarchy refinements. A configuration named “global + shrinkage” would therefore need an actual implementation change before it tests that hypothesis.

The training gene union already contains a mean **99.87% of each validation screen's positive genes**. Adding a new gene vocabulary is unlikely to be the primary remedy. The failure is largely choosing and ordering appropriate genes from an existing vocabulary.

### Focused libraries magnify the problem

| Validation measured-library size, used only for diagnosis | Screens / publications | Global coverage | Ensemble coverage | Global AnDCG | Ensemble AnDCG |
|---|---:|---:|---:|---:|---:|
| Below 1,000 | 98 / 5 | 1.61 | 65.94 | 0.019299 | 0.182500 |
| 1,000–9,999 | 13 / 3 | 35.92 | 31.15 | 0.184936 | 0.093646 |
| At least 10,000 | 107 / 28 | 88.43 | 96.96 | 0.189183 | 0.201316 |

**Do not feed these target-derived size groups to a description-only predictor.** Instead test whether permitted descriptions/library-design metadata can predict measurement propensity from historical screens. In a separate practical workflow, a laboratory can explicitly supply its library; compare every model under that same additional-input contract. Never silently filter/backfill the description-only benchmark.

## 2. Phenotype gains are uneven and study-dependent

| Phenotype | Screens / publications | Global | Phenotype prior | Ensemble |
|---|---:|---:|---:|---:|
| Drug / chemical / environmental | 157 / 20 | 0.058436 | 0.014631 | 0.150264 |
| Fitness / proliferation / viability | 36 / 5 | 0.412267 | 0.417436 | 0.366495 |
| Host–pathogen | 17 / 8 | 0.011297 | 0.041837 | 0.178459 |
| Molecular output / reporter | 4 / 4 | 0.063001 | 0.000000 | 0.206066 |
| Trafficking / localization | 4 / 2 | 0.019493 | 0.003645 | 0.000000 |

The drug phenotype prior averages **0.013 measured genes out of 100** across 157 screens. Its poor result does not establish that conditioning on biology is unhelpful; it establishes that this sparse counter/ranking implementation fails to supply assayed candidates for this cohort.

The largest validation publication contributes **86 HAP-1 screens**, and another contributes **24 PC-9 screens**. HAP-1 and PC-9 subgroup performance therefore cannot establish general cell-line-specific reliability. Other apparently strong cell-line groups are also small or single-study: K-562 has six screens from one publication, hTERT-RPE1 six from one, and HeLa seven from two. Raw cell-line routing is particularly vulnerable to fitting study design.

The previously selected phenotype router averages 0.194849 over validation screens versus ensemble 0.186437. However, equal-publication means are **0.145312 versus 0.145920**, and its screen-weighted difference after omitting each publication ranges from **−0.004944 to +0.013893**. These sensitivity checks undermine a general expert-routing improvement claim. They do not replace the official screen-weighted metric.

## 3. Selection type is not requested phenotype direction

There are **47 metadata-matched increase/decrease comparisons**, spanning 82 unique validation screens and five publications; some comparisons share screens. Within each comparison, all allowed fields except fine `phenotype` match. Both the phenotype prior and the so-called direction prior return **identical rankings for all 47 comparisons**. The text ridge returns different rankings for all 47, showing that the distinction is available in input text.

For example, U_1471_dec requests decreased drug resistance and U_1471_inc increased drug resistance. Both have `screen_type=Bidirectional`, the same cell/modality/drug/dose/duration, and opposing desired labels. The hierarchy conditions on broad phenotype, selection type and modality, so it cannot distinguish these requests.

**Hypothesis:** extract requested outcome polarity conservatively from the fine phenotype—e.g. increased resistance, decreased resistance, either direction, unknown—and use it in the donor/ranker context. Infer it from prospective input text, never from benchmark IDs such as `_inc`/`_dec` or target relevance values. Positive selection does not universally mean increased biological phenotype; CRISPR activation does not justify flipping every knockout effect.

Mean wrong-direction fractions among returned slots are 5.00% for the global prior, 5.17% for ridge and 1.33% for the ensemble. The transfer model's lower rate, 0.07%, comes with only 7.79 measured genes per 100 slots; low wrong-direction counts caused by noncoverage are not evidence of a better directional model.

### Important metric diagnostic

The official adjusted metric can be positive when none of the returned genes were measured, if the screen's signed random reference is negative. This occurs in 29 validation screens for the phenotype and direction priors and 31 for transfer. It follows from the official formula: a zero DCG can exceed a negative random baseline. Preserve the evaluator and report measured coverage and actual positive-hit slots alongside AnDCG. Do not optimize unmeasured predictions to exploit this behavior.

## 4. Metadata sparsity and modality

| Allowed field | Missing/placeholder validation entries | Exact value unseen in training |
|---|---:|---:|
| Cell line | 0 | 18 |
| Fine phenotype | 0 | 186 |
| Condition name | 22 | 142 |
| Condition dosage | 43 | 116 |
| Duration | 6 | 12 |
| Condition clause | 22 | 193 |

“Unseen” is exact normalized text mismatch, not proof of a new biological mechanism. Condition synonyms, dose units, ranges and explicit missingness are useful representation targets. Many known cell names have only a few independent donor publications. There are also **13 identical full-allowlist context groups covering 26 validation screens**; missing design information or replicate differences cannot be inferred from those identical inputs alone.

Knockout has 203 validation screens from 32 publications; activation nine from two; inhibition six from one. The ensemble's activation score is 0.018280 despite mean measured coverage of 97.44/100, whereas inhibition coverage is only 18.83/100. Thus coverage is not the only failure: activation needs biological direction/context handling, but two publications are inadequate to validate an elaborate dedicated expert. The single-publication inhibition subgroup cannot estimate across-study generalization.

For 18 unseen-cell screens from nine publications, global/ridge/ensemble scores are 0.020847/0.028715/0.210205. These are small descriptive subgroups with differing phenotype mixtures, not controlled estimates of the effect of cell novelty.

## 5. Historical retrieval has a modest usable signal

Train-only unigram/bigram TF–IDF was used to select five donors. A donor contributes its up-to-100 strongest positive-relevance genes; the union is evaluated as an **unordered candidate-coverage diagnostic**, not AnDCG and not a final predictor. Same-direction/modality matching uses the currently available selection-type fields and therefore retains the polarity limitation above. Random matched donors are one fixed seeded draw, not a fully averaged random-retrieval baseline.

| Donor choice | Mean desired-hit recall of union | Desired hits in union | Opposite hits in union |
|---|---:|---:|---:|
| Five random matching donors | 0.07147 | 18.14 | 6.86 |
| Five nearest text donors | 0.08670 | 27.56 | 6.63 |
| Five nearest matching donors | 0.09510 | 24.64 | 1.57 |

Matched-text minus random-matched desired recall is +0.02363, descriptive publication interval [0.01188, 0.05076]. Candidate-union sizes differ, so this does not establish an equal-budget ranking win. Unrestricted nearest text donors mismatch selection type on 47.25% and modality on 14.22% of queries. Structured matching is worth testing, but exact hard filters and sparse denominator effects can destroy downstream rankings. Compare normalized transfer evidence with a smoothed global fallback before adding a larger embedding model.

## 6. Expert complementarity is real, but hindsight selection is not a model

Global prior and ensemble top-100 Jaccard overlap averages 0.01918. The global prior wins on 50 validation screens, ensemble on 131, with 37 ties. Each finds desired genes absent from the other's list: averages 9.22 and 9.09 respectively. Their hindsight per-screen maximum is 0.232660, but choosing it requires target answers. It is only a diagnostic of possible complementarity, not attainable performance or an upper bound for all models.

Gemini 3 Pro versus GPT-5.4 overlap is higher (0.27292); wins are 90 versus 80 with 48 ties. Each contributes unique desired genes (6.12 and 5.05 on average). Their mean score difference has a publication interval crossing zero. The existing ensemble already combines external knowledge; neither these comparisons nor cached inference proves that another costly model call will help.

A cautious next step is a small regularized **gene-level** blend/ranker using independently obtained expert ranks plus historical support, rather than fitting many cell-specific route rules. Cached predictions make development cheap, but an actual future service still needs independently generated rankings with model/version/input provenance and measured cost.

## 7. Prioritized hypotheses for the implementation owner

These are recommendations, not features implemented by this report.

1. **Fix sparse estimation before architectural expansion.** Fit a global Beta-binomial/empirical-Bayes prior and shrink each conditional counter toward a valid parent using measured exposure and publication support. Explicitly handle zero conditional exposure. Test the global rate, phenotype rate and requested-direction rate separately. Preserve an ablation without measurement weighting, so gain from assay-coverage prediction is distinguishable from biology.
2. **Model measurement and biological relevance separately.** Estimate `P(measured | metadata,gene)` from training masks, and a signed expected relevance among measured genes. Their product is a plausible scoring heuristic, not an exact optimizer of the condensed metric and not validation probability. Hold out full publications when fitting or generating these features. Never use the query's target mask. Evaluate targeted-library and genome-wide groups only after predictions are frozen.
3. **Requested phenotype polarity with conservative fallback.** Use fine-phenotype semantics to distinguish increase/decrease/either/unknown. Combine it with modality and selection design, rather than treating any one field as equivalent. Regression fixtures should include the metadata-matched opposite requests and unknown wording.
4. **Regularized gene-level supervised ranking.** Build query–gene examples from training-publication-held-out predictions/counters. Candidate features can include smoothed positive/negative rate, measured exposure, independent-publication support, context support, donor transfer, external rank and disagreement. Use logistic/linear ranking before trees; then a small LambdaMART comparison if justified. Keep unmeasured labels masked, retain opposite-direction evidence, and avoid a loss that assumes all labels are nonnegative gains without documenting the transformation. Evaluate with the unchanged official metric.
5. **Improve low-cost retrieval representations.** Compare a real BM25 implementation to TF–IDF and structured matching; normalize chemical names and doses where unambiguous. Learn similarity from train-only cross-publication transfer labels if simple retrieval fails. Include query/paper held-out feature construction. A string-level condition match alone will miss most validation conditions.
6. **Only then test time-clean biological annotations.** Local STRING v12, modern Reactome, Open Targets 26.09, DepMap and PubTator assets exist, but their current releases are not eligible for strict through-2020 historical inference without claim/version auditing. Do not add them merely because they are local. Historical gene identity mappings can be separated from later functional evidence. Foundation models require suitable inputs and a cost/benefit experiment; this analysis supplies no evidence that they fix the immediate denominator/direction problem.

### Primary-source rationale and limits

Schnabel et al. formulate recommendation learning with selected/missing observations and show why naive observed-data learning/evaluation can be biased. This supports explicitly separating observation from biological outcome. Their propensity assumptions are not automatically satisfied by CRISPR publication/library selection; estimated assay propensity is not a proof of unbiased biological inference. [Primary paper](https://proceedings.mlr.press/v48/schnabel16.html).

Burges describes pairwise ranking, LambdaRank and boosted-tree LambdaMART. It supplies an implementable family for query–gene ranking, not evidence that ordinary NDCG objectives solve SplicR's signed, adjusted, condensed metric or outperform simpler models here. [Primary technical report](https://www.microsoft.com/en-us/research/publication/from-ranknet-to-lambdarank-to-lambdamart-an-overview/).

BEIR evaluates heterogeneous retrieval and finds BM25 a robust baseline, with more costly reranking/late-interaction approaches strong in its setting. That justifies keeping lexical retrieval in the comparison; document retrieval benchmarks do not establish biological donor-transfer performance. [Primary benchmark paper](https://arxiv.org/abs/2104.08663).

## Decision boundary

Proceed with a small preregistered candidate family addressing support, measurement propensity and true requested polarity. Use grouped internal training folds for learned features and validation as development data. Freeze the selected configuration before any separately authorized evaluation. Keep all negative results and report study dependence. This report demonstrates failure mechanisms and testable hypotheses; it does not demonstrate a new best model, independent generalization or perfect biological accuracy.


## 8. Implemented requested-effect parser and isolated ablation

`engine/splicr/effect_direction.py` now implements `parse_requested_effect` as a
standalone typed function. Its grammar was justified from the training-only
phenotype vocabulary: explicit leading `increase`, `increases`, `decrease` and
`decreases` are accepted; missing, ambiguous, combined, negated and unsupported
requests remain unknown. No dataset ID, suffix, measurement or selection field
is accepted by the function. The original normalized text remains inspectable.

The parser preserves the biological target separately from explicitly marked
readout qualifiers. “Increases drug sensitivity as measured by decreased cell
proliferation” retains **increased sensitivity** as the requested phenotype and
keeps the decreased-proliferation qualifier. It does not equate sensitivity with
resistance, infer knockout/activation signs or attempt general mechanistic
reasoning. Conservative abstentions include some legitimate compound descriptions
with conjunctions; parsed coverage is not semantic accuracy.

Training coverage: 972 decrease, 251 increase and 126 unknown across 1,349 rows.
There are 343 original-cased phenotype strings (340 after lowercase normalization
in the earlier vocabulary inspection). The grammar distinguishes all 47 recorded
validation increase/decrease comparisons, preserving an identical target for both
members. These involve 82 unique screens from five publications. **This is an
implementation diagnostic, not a measured prediction improvement.** No grammar
revision was selected from validation ranking scores. Full evidence is in
[parser diagnostic](artifacts/20260928/error_analysis/parser_diagnostic.json).

`engine/tests/test_effect_direction.py` and `engine/tests/test_direction_ranking.py`
passed 56 tests, covering input isolation, ambiguous/unknown wording, readout
inversion, target preservation, missing observations, publication exclusion,
modality compatibility, exact baseline fallback and opposite-request ranking in
synthetic fixtures. Synthetic ranking reversal is not experimental biology.

The new `DirectionEvidence` subclass in `engine/splicr/direction_ranking.py` keeps
the existing model implementation unchanged. It adds a shrunk measured-denominator
positive/negative estimate within a compatible requested-effect subset. A donor
must match requested polarity, target compatibility, broad phenotype and modality.
Resistance and sensitivity have distinct compatibility keys; other endpoints
retain their complete leading target phrase. This conservative choice may miss
synonyms and allows different drugs within the same broad resistance family;
TF–IDF provides additional context in the transfer variant. Unknown or unsupported
requests return the exact D3 baseline, without fabricated direction.

An isolated experiment under `engine/analysis/direction_development.py` compares
three fixed configurations: D3, D3 plus the requested-effect prior, and that prior
plus 0.5-weight transfer from up to 25 compatible TF–IDF donors. Strength 10 and
exposure exponent 0.5 are inherited unchanged. The script uses the same three
publication GroupKFold partitions as the shared development study, fitting counts,
gene mappings and vocabulary inside each fold. Only the CV-selected candidate and
D3 proceed to temporal validation. Its CLI has no public-test phase. Source,
package and input hashes are frozen before fitting, and dependency changes fail
explicitly. Results are stored separately under
`research/artifacts/20260928/direction_development`; they must not overwrite the
initial error diagnostics or the parent study.


A parser guard review also found that a nominal request with no target
(`increase in`) needed explicit abstention. The first direction-experiment process
was interrupted before selection, its partial outputs and source snapshot were
preserved under `direction_development_incomplete_parser_guard`, and regression
tests were added. The same three configurations were restarted with a new
preregistered parser hash. No parameter was changed in response to a score; partial
interrupted results are excluded from performance claims.

## 9. Outcome of the two experiments this analysis motivated

Both experiments recommended above were run to completion on 2026-09-28 and
**both are negative**. They are registered in full, with configurations, hashes
and per-screen results, as experiments D and E in
[the experiment registry](06_EXPERIMENT_REGISTRY.md).

- **Gene-level supervised ranking** (recommendation 4). Cross-validation selected
  a LambdaRank model over 57 features. On the 2021 temporal validation split it
  scores 0.180985 against the published ensemble's 0.186437: paired difference
  −0.005452, 95% publication-cluster interval [−0.016147, +0.010805] over 10,000
  resamples. The interval contains zero and the point estimate is below the
  baseline. Not promoted; the public test was never accessed.

- **Requested-effect polarity** (recommendation 3). The parser works: it
  distinguishes all 47 metadata-matched increase/decrease comparisons that every
  previous feature set collapsed. Conditioning the estimator on it does not help.
  Cross-validation preferred the unconditioned baseline, with the polarity prior
  at −0.007931 [−0.023172, +0.004531] and the polarity-plus-transfer variant at
  −0.010680 [−0.024030, +0.001069]. Not promoted.

The distinction worth keeping is between a **representation** gap and a
**ranking** gap. This analysis proved a representation gap — the old features
genuinely could not tell an increase request from a decrease request. Fixing the
representation did not close the ranking gap, which means the limiting factor on
these cohorts is not the missing polarity feature. Recommendations 1, 2, 5 and 6
remain untested.

Neither result changes any published number. The website, the evidence artifacts
and the promotion status of every model are unchanged by this work.
