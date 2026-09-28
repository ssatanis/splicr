# Benchmark reproduction

Date: 2026-09-27. **The published reference numbers reproduce. A new state-of-the-art result was not established.** All values below use Genentech's installed `assaybench==0.2.0` `RankingMetrics`, with unchanged target relevance and no evaluator modifications.

## Pinned evidence

- Dataset: `Genentech/assaybench`, `biogrid`, `yearfold0`.
- Hugging Face cached revision: `bc37bf8f4842b43abcd6e9f781423d478b9aee4b`.
- Parquet SHA256: `25e00c380358486137d1f25c490db98d007dfc5230f8ad502276dc6ccc741a5c`.
- Official source checkout: `640c68be02700efb5e032b6cea5c356e05c21051`.
- Train: 1,349 screens / 134 publication identifiers; validation: 218 / 34; test: 334 / 63.
- `artifacts/official_references.json` records actual installed metric hash, dataset hash, prediction-file hashes, source revision, per-screen distributions and publication bootstrap intervals. A Git revision alone is insufficient because the initial and final working trees contain uncommitted changes.

## Direct official replay

| Published artifact | Reproduced mean AnDCG@100 | Rounded reference |
|---|---:|---:|
| Oracle kNN, answer-dependent donor selection | 0.291784311 | 0.292 |
| LLM RRF Ensemble | 0.163091053 | 0.163 |
| Gemini 3 Pro | 0.156991112 | 0.157 |
| GPT-5.4 | 0.146976058 | 0.147 |
| Coarse-phenotype hit frequency | 0.133439586 | 0.133 |
| Embedding kNN | 0.064600302 | 0.065 |

Published rankings were passed unchanged to the official evaluator. No target-library filtering, padding with additional genes, rank reordering, or exclusion of difficult screens was applied. The frequency artifact is **phenotype-conditioned**, not the literal global frequency baseline. The published statistical baselines and language-model prompts do not all have identical library inputs; retain this qualification even when reproducing the same metric.

The old SplicR 0.136 result is the phenotype frequency estimator fitted on **train plus validation, 1,567 entries**, with the target measured library supplied. Recomputed with the official evaluator over eight tie seeds, its average is **0.136052352** (range 0.135886862–0.136161243). This is not evidence that a newly trained model on 1,349 screens should be compared without accounting for those additional inputs/data.

## Existing library-aware router

The pre-existing router was independently rerun from the local feature caches:

| Same additional library input | AnDCG@100 |
|---|---:|
| Archived SplicR phenotype router | 0.219951522 |
| Published ensemble with matched library filtering/prior filling | 0.219324151 |

Difference: **+0.000627371**, with the historical script's 10,000-resample **screen-level** interval **[−0.008032105, +0.008718407]**. That is a tie, and this screen-level interval does not account for related screens. The new experiments use publication-level intervals. Cached versus official scores differed by at most 2.33×10⁻⁸. This rerun verifies calculation from existing caches; it does not certify every upstream cache's provenance or recreate the original LLM calls. Log: `artifacts/archived_router_reproduction.log`.

The additional input explains why 0.21995 cannot be advertised as a description-only improvement over the raw 0.16309 ensemble. Oracle rankings are hindsight references, not deployable systems or universal upper bounds.

## Metric behavior verified

For relevance `r`, `DCG@k = Σ r_i/log2(i+2)` after the official deduplication/mapping and **pad → truncate → condense** operations. `IDCG` clips negative relevance to zero. `nDCG_random` uses the mean relevance over that screen. The final score is `max((nDCG − nDCG_random)/(1 − nDCG_random), 0)`.

Opposite-direction predictions subtract relevance. Unassayed genes within the first k consume rank slots before condensation. A relevant gene originally at rank 101 is not backfilled into a top-100 evaluation. Empty or wrong-direction predictions are not replaced with fabricated genes. The official metric can be undefined for degenerate constant-positive targets; the wrapper fails on nonfinite metrics rather than silently changing the score.

The official result object also includes gene arrays and some undefined normalized diagnostics. The wrapper retains the declared numeric metrics. For short lists, upstream `evaluate` omits precision/recall fields; the wrapper calls the same upstream `compute_precision_at_k`, `compute_recall_at_k` and `compute_fdr_at_k` functions so denominators remain explicit across all screens. `slot_precision_at100` is separately named and uses 100 slots; it is not substituted for official condensed precision.

## Reproduction commands

Run from the repository root in the existing pinned environment:

```sh
PYTHONPATH=engine engine/.tools/env/bin/python -m splicr.benchmark --reproduce
PYTHONPATH=engine engine/.tools/env/bin/python engine/analysis/reproduce_references.py
PYTHONPATH=engine engine/.tools/env/bin/python engine/analysis/assaybench_fusion/phenotype_router.py
```

The first command verifies the optimized historical scorer against upstream and reconstructs oracle/frequency baselines. The second produces the direct official replay and all per-screen records. The third replays the archived library-aware result. Original prediction artifacts are required locally; no paid API calls or production writes occur.

Sources: [official implementation](https://github.com/Genentech/AssayBench), [dataset](https://huggingface.co/datasets/Genentech/assaybench), [metric documentation](https://genentech.github.io/AssayBench/metric.html), [publication](https://arxiv.org/abs/2605.10876).
