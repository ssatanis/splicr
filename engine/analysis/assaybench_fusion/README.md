# AssayBench fusion — the measurement scripts

Everything reported in `data/references/assaybench/RESULTS.md` section 8 and in
`docs/08-assaybench-headroom.md` is produced here. The order below is the order
the work happened in, and the negative results are kept.

## The rule every script in this directory follows

A channel may read, for a query screen:

* that screen's own **metadata** (any field in the parquet except `hit`,
  `relevance_genes` and `relevance_scores`),
* the **labels of pre-2022 screens whose publication is not the query's**, and
* sources that are not derived from the screens being predicted — pharmacology,
  pathway membership, cell-line-independent DepMap summaries.

Two scripts break that rule **on purpose** and say so in their docstring and
their output: `ceiling.py` and `transfer_ceiling.py` fit or select on test in
order to bound what a channel set can express. Their numbers are diagnostics and
are never quoted as results.

## Build

| script | what it writes |
|---|---|
| `build.py` | `cache/base.pkl` — the parquet reduced to per-screen libraries, relevance vectors, metric constants, and every published prediction list, symbol-normalised through the upstream `GeneMapper` |
| `build_runs.py` | `cache/runs.pkl` — **every sampling run** in the prediction files, not just the shipped aggregate. Most model files ship five runs per screen |
| `core.py` | the compact gene universe (24,516 measured genes), the sparse screen × gene matrices, and the entity extractors (pathogen, compound, cytokine, direction) |
| `extchan.py` | gene-level channels from DepMap, PubTator and Open Targets target attributes |
| `pharm.py` | `cache/pharm.json` — compound name → ChEMBL id → target genes and mechanism class, from Open Targets |
| `knowledge.py` | pharmacology and reporter-gene vectors, expanded through STRING physical interactions and Reactome |
| `retrieval.py` | pseudo-label screen retrieval: IDF-weighted cosine between the query's predicted hit vector and each donor's measured hit profile |
| `consensus.py` | per-run reciprocal-rank consensus over the published model runs |
| `channels.py` | assembles all of the above into one score vector per channel per screen, with the query's publication subtracted from every counter |
| `features.py`, `fast.py` | materialise a per-screen candidate pool and its channel matrix, and score a weight vector over a whole split with one matmul |

## Fit and select

| script | what it decides, and on what |
|---|---|
| `proto.py` | the protocol: publication-grouped folds, category-balanced objective, the banned-channel list |
| `run12.py` | how many published systems enter the consensus. CV picks 5; test would have picked 4, a difference of 0.0004 |
| `final_fit.py` | global versus per-category weights, and how far per-category weights shrink back to the global ones |
| `gbm.py`, `run8.py` | LightGBM LambdaRank over the whole channel bank, as an alternative to the linear blend |
| `evaluate.py` | the single scoring pass: fit on pre-2022, score test / validation / LaTest once, compare against every published system both as shipped and densified, paired bootstrap |

## Diagnostics (these read test labels; they are not results)

| script | what it establishes |
|---|---|
| `ceiling.py` | fitting the blend weights **on test** caps at 0.245, so the limit is the channel set, not the tuning |
| `transfer_ceiling.py` | even with a perfect donor-similarity function, multi-donor transfer tops out near the single-donor oracle — donor retrieval has bounded upside |
| `diag_donor.py` | the best-transferring donor sits at median rank 815 of 1567 under any similarity we can compute, and shares the query's compound 1% of the time |
| `oracle_split.py` | **the important one.** Split each screen's measured genes in half, choose the best donor on half A, score it on half B: it keeps 0.097 of 0.284, about a third. Two-thirds of the published oracle row is the maximum of 1349 noisy draws, not transferable signal |

## Reproducing

```bash
PY=engine/.tools/env/bin/python
cd engine/analysis/assaybench_fusion
$PY build.py && $PY build_runs.py && $PY build_all3.py
$PY run12.py          # choose the consensus size
$PY final_fit.py      # choose the weighting scheme
$PY evaluate.py       # score every split once, write results_fusion.json
$PY oracle_split.py   # the oracle selection-maximum experiment
```

`build_all3.py` takes about a minute and rewrites the four feature caches;
everything downstream reads those.
