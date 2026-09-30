# 17 · Dependency prediction from baseline state (DepMap 26Q1)

Status 2026-09-29. First CPU stage of the perturbation model described in
`docs/01-architecture.md`. Code: `engine/splicr/dependency_model.py`. Results:
`research/artifacts/dependency_model/cv_26Q1.json`, penalty sweep in
`alpha_sweep_random_split.json`.

## Question

Given a cell line's baseline expression, copy number and hotspot mutations, how
well can its Chronos gene effect profile be predicted before it is screened?

## Data

DepMap Public 26Q1 portal release (lake `depmap_matrix`): 1,140 lines with both
CRISPRGeneEffect and expression; 18,531 genes. Features: 5,000 most variable
expression genes (log2 TPM+1), 5,000 most variable genes' log2 WGS relative CN,
52 hotspot mutations present in at least 5 lines.

## Protocol

- Split A: 5-fold by cell line (random, seed 0).
- Split B: 5-fold grouped by DepMap lineage: whole lineages are unseen.
- Every scaler, PCA and regression is fitted on training lines inside the fold.
- Score: for each of the 2,000 genes with the highest effect variance, Pearson r
  between predicted and observed effect across held-out lines; report the median
  and the fraction with r > 0.3. Target-gene selection uses only the target's
  variance, not features or predictions.
- Hyperparameters were chosen on split A only. Split B was run once, afterwards.

## Results

| Model | A median r | A r>0.3 | B median r | B r>0.3 | Global r (A) |
|---|---|---|---|---|---|
| Per-gene training mean | -0.057 | 0.0% | -0.113 | 0.0% | 0.911 |
| Expression kNN (k=10) | 0.217 | 26.7% | 0.139 | 12.5% | 0.911 |
| Ridge, PCs | 0.250 | 35.8% | 0.178 | 14.8% | 0.915 |
| **Kernel ridge, all features** | **0.279** | **44.2%** | **0.223** | **28.8%** | 0.916 |

Best-predicted genes (split A): SOX10 0.82, PAX8 0.78, EBF1 0.76, MYB 0.76,
TP63 0.74, FERMT2 0.73, IRF4 0.72, CTNNB1 0.71, POU2AF1 0.71, TCF7L2 0.70.

## Reading

- Global r of ~0.91 is almost entirely the per-gene mean: common essentials are
  essential everywhere. It is not evidence of a useful model and is reported only
  so nobody quotes it as one.
- The selective-gene metric is where the models differ. The best model predicts
  lineage master regulators and oncogene addictions well and most selective
  genes weakly: the median gene is at r = 0.28.
- Holding out whole lineages costs about 20% of the median r, which is the
  realistic expectation for a genuinely new cell type.
- The per-gene mean scoring negative on split B is expected: removing a lineage
  shifts the training mean away from the held-out lines.

## Limits

- No external comparison was run. Published DepMap prediction work uses other
  releases, gene sets and metrics, so these numbers are not a claim of parity or
  superiority with any of it.
- Chronos effect is itself a model output; errors in it bound what any predictor
  here can reach.
- Not used by the web app or the Hit Report. Nothing here is a calibrated
  probability and it must not be presented as one.

## Next

1. Gene-side features (Perturb-seq, JUMP morphology embeddings from the lake)
   for genes with no screen history: bilinear gene x line model.
2. The multimodal transformer needs GPU hardware (not available); it should be
   evaluated on exactly these folds and must beat the kernel ridge row.
