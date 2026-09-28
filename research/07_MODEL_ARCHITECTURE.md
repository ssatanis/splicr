# Implemented architecture and decision

**Keep established production count-analysis tools; do not promote a new pre-screen model on these results.** The new prediction modules are explicit research/inference components. Their honest value is controlled evaluation, inspectable evidence, and enforceable input boundaries. None supplies a calibrated validation-success probability.

## Track A: typed historical prediction

`engine/splicr/prescreen.py` defines immutable `ScreenContext`. Its allowlist includes cell, tissue, phenotype/category, modality, selection, library type, design, condition/dose, duration and condition clause. Target measurements, target gene universe, post hoc notes, significance criteria and ranking rationale are excluded. Publication identity is used only to exclude related donors. Direct construction also validates the allowlist. Text can still contain post hoc scientific clues; a type boundary cannot prove its historical origin.

Training builds three separately owned sparse screen×gene matrices: `M` indicates measured genes, `H` positive relevance, and `N` opposite-direction relevance. Shared buffers are prohibited because sparse zero elimination mutates storage. Fit verifies aligned, finite labels and unique training screen/gene identifiers. All transformations and the gene candidate universe are fitted on the supplied training rows.

For eligible donor weights `w_s`, gene evidence is

`r_g = [Σ_s w_s H_sg − λ Σ_s w_s N_sg + m p_parent,g] / [Σ_s w_s M_sg + m]`.

No exposure and no shrinkage gives zero evidence, not a confident negative. Optional `w_s=1/n_publication` gives each publication one unit of mass. Hierarchical subsets condition on phenotype, then selection/modality, then compound. Missing or unsupported categories back off to the previous level. Parameters are configurations, not hidden benchmark conditionals. Signed ranking scores are not probabilities.

Optional text transfer fits a 20,000-feature unigram/bigram sublinear TF–IDF vocabulary on training descriptions. Similarity is cosine, restricted to matching known direction/modality and independent publications. A fixed number of donors contribute similarity-power weights; their measured-denominator rate shrinks to the prior. The tested configurations failed to improve validation performance, so retrieval is not retained as a claimed enhancement.

Default ranking uses the **training gene union**. A caller can explicitly supply candidate genes to the library-aware API; the research benchmark does not do this. No target answer field is read to construct candidates. Stable sorting makes ties deterministic. Refitting resets matrices and caches.

## Alternative: text residual regression

`TextResidualRanker` uses the training text Gram matrix `K=XXᵀ`. The gene prior uses pooled-rate shrinkage. For observed entries, the target residual is `H_sg−p_g`; unmeasured entries are imputed at the prior, producing residual zero. With `D_ss=sqrt(1/n_publication)`, coefficients solve

`B = D (D K D + αI)^−1 D R`.

Inference returns `p + k_query B`, then ranks genes. Cholesky solves avoid an explicit inverse. Same-publication predictions are rejected: unlike a counter, a fitted regression cannot subtract a publication at inference without refitting. The missing-cell approximation and shared study weights are declared; no masked-likelihood or biological-foundation-model claim is made. Alpha 10 was selected on validation, but its test gain was statistically unresolved and absolute performance poor.

## Alternative: external-evidence routing

`engine/splicr/evidence_router.py` selects a category expert from complete, identically ordered development cohorts. Small categories with fewer than three publication identifiers retain the default external expert. Ties retain that default. Test labels never enter routing. An unavailable external ranking raises an error; there are no fabricated fallback predictions.

The new frozen route chooses the historical phenotype prior for fitness and the unchanged published ensemble elsewhere. It performs worse than the ensemble in the point estimate and is not promoted. This is distinct from the pre-existing library-aware cached five-model router, whose reproduced 0.21995 is tied with matched postprocessing of the ensemble.

## Evaluation and prospective receipts

`research_protocol.py` calls the official evaluator without filtering or repairing predictions. Cohort coverage must match exactly; missing/extra screen IDs are errors. It saves primary/secondary metrics, measured coverage, invalid-symbol fraction, wrong-direction fraction and separate slot precision. Publication-cluster bootstrap preserves the benchmark's screen-weighted mean. For paired comparisons, sample clusters of per-screen differences together. One publication produces no between-publication interval.

`freeze_predictions` accepts only a flat pre-experimental context allowlist and rejects known training-publication overlap. Exclusive file creation prevents accidental overwrite. The SHA256 receipt commits to predictions, context and model manifest. It is **not** a trusted timestamp, authorization system, inaccessible label vault, or independent prospective dataset. A custodian must hold the labels, retain the hash externally, and document outcome release after freeze.

## Usable local prediction interface

The following operates on a laboratory's actual historical JSON records and new experiment metadata. It does not call any external model API or write to the database:

```sh
PYTHONPATH=engine engine/.tools/env/bin/python -m splicr.predict \
  --training historical_screens.json --context experiment.json \
  --output prediction.json --receipt prediction_receipt.json
```

Training records need unique `dataset_name`, `source_id`, `relevance_genes`, aligned signed `relevance_scores`, and available metadata. The query file accepts only `ScreenContext` fields plus identity; it rejects target labels. Output includes ranked genes, uncalibrated score, independent-publication support counts, input/code hashes and explicitly null validation probability. Existing output/receipt files are not overwritten. This is an experimental historical prior, not a recommended replacement for an established lab method.

An optional `--router router_freeze.json --external expert.json` accepts externally generated rankings plus their provenance. The user must supply those rankings; the code does not pretend archived Gemini predictions are available for an unseen screen. `expert.json` contains `genes` and a nonempty `provenance` object. Historical inference cost excludes the external model cost.

## Track B and product integration

The nine-stage pipeline retains actual MAGeCK/BAGEL2/DrugZ implementations with declared assumptions, native output preservation and clearer failure handling. Count-only input cannot establish read-mapping rate: it is now null with availability/source fields. A local atomic `postscreen_report.json` retains observed statistics, guide evidence, artifact hypotheses, QC and unavailable-calibration reasons.

The real screen-detail page now reads authenticated workspace records, the selected actual analysis run, stages and recorded hits. It renders available effect/FDR/guide/flag evidence and explicit empty/unavailable states. Demo data are imported only for explicit demo sessions. Artifact-risk flags do not prove false biological dependencies. No database migration or production mutation was needed.

Report export, upload-to-worker execution, independent outcome collection and trained validation calibration remain separate gaps documented in the repository audit. A working local CLI or database schema is not proof that every browser workflow is complete.

## Cost and maintenance

The new experiments used existing local CPU resources, about 16 GB system RAM, pinned Python/NumPy/SciPy/scikit-learn, and no paid inference. Training gene matrices are sparse; no new multi-GB biological downloads were initiated. The residual solve materializes a small screen kernel and a dense residual matrix; this prototype is appropriate for ~1,349 rows, not arbitrarily large atlases without further batching/factorization. Existing 7 GB historical fusion caches remain untouched.
