# AssayBench phenotype router

The research router scores **0.21995 AnDCG@100** on the 334-screen AssayBench
`yearfold0` test split. It routes fitness screens to a phenotype-conditioned
hit-frequency prior and the other four phenotype classes to a consensus of five
published model prediction lists. The route for each class was selected using
only pre-2022 screens, with each query's publication excluded from its prior.
Every prediction is restricted to genes assayed by that screen and fills 100
slots. The cache scorer and Genentech's official `RankingMetrics` agree within
2.4e-8 on every test screen.

This is a **model-assisted research result**. It uses Genentech's published
frontier-model predictions, so it is neither an independent frontier model nor
the no-model-API ORCS retrieval scorer shown separately on the site at 0.1628.
The underlying models may have read publications for the test screens during
pretraining. AssayBench's paper has the same caveat for its model rows. This
benchmark cannot establish prospective performance on unpublished screens.

| Method on the same 334 test screens | AnDCG@100 |
| --- | ---: |
| SplicR phenotype router | 0.21995 |
| Published LLM RRF ensemble, filtered to assayed genes and padded with the same prior | 0.21932 |
| SplicR ORCS retrieval alone | 0.1628 |
| Published LLM RRF ensemble as shipped | 0.1631 |

The paired router-versus-densified-ensemble difference is **+0.00063** with a
10,000-resample screen-level bootstrap 95% interval of **[-0.00803, +0.00872]**.
This is a tie. The routing improvement over the site's old 0.163 row is real as
a *different method*, but most of it comes from access to published model
rankings and filling the AssayBench rank budget. It does not show an advantage
over a comparably processed frontier ensemble.

The test split was already inspected by earlier experiments in this repository.
This router was selected on pre-2022 data, but the research program as a whole
cannot claim the test set was never seen. A stronger generalization claim needs
an untouched, publication-disjoint future cohort with unavailable labels at
model freeze time.

The same fixed route scores **0.18513** on the separate 19-screen LaTest set,
with official/cache metric agreement within 5.5e-9. Seventeen of those screens
are molecular-output assays and only two are fitness assays, so this small set
does not resolve the uncertainty about other phenotypes. Upstream does not ship
its LLM RRF ensemble predictions for LaTest, so a matched ensemble comparison
is unavailable there. All five class choices are stable across five
publication-grouped pre-2022 training folds.

Reproduce from the existing feature caches:

```bash
engine/.tools/env/bin/python engine/analysis/assaybench_fusion/phenotype_router.py
engine/.tools/env/bin/python engine/analysis/assaybench_fusion/phenotype_router.py --split latest
PYTHONPATH=engine engine/.tools/env/bin/python -m pytest engine/tests/test_assaybench_fusion.py -q
```

The script prints the pre-2022 class choices before reading test scores, checks
its output against the official evaluator, and scores the published ensemble
with the same library filter and prior padding. Rebuilding the feature caches
is described in [the fusion analysis README](../engine/analysis/assaybench_fusion/README.md).
The metric's truncate-before-condense behavior is documented by
[Genentech](https://genentech.github.io/AssayBench/metric.html), and the
[official AssayBench repository](https://github.com/Genentech/AssayBench)
defines the dataset and `RankingMetrics` evaluator. The choice to route by
phenotype follows the [paper's phenotype analysis](https://genentech.github.io/AssayBench/phenotypes.html):
viability hits recur across screens, while infection and reporter hits are more
context-specific.
