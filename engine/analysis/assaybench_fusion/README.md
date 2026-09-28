# AssayBench fusion — the measurement scripts

**Archived exploratory scripts.** Public test labels have been inspected in this
workstream. Its results are not untouched prospective evidence. The supplied
measured gene library and cached published predictions give some experiments
additional inputs beyond a description-only task. For current controlled replays,
limitations and the absence of a demonstrated benchmark win, see
[the final report](../../../research/10_FINAL_RESULTS.md) and
[analysis index](../README.md). No archived script is a production scorer.

Everything reported in `data/references/assaybench/RESULTS.md` section 8 and in
`docs/08-assaybench-headroom.md` is produced here. The order below is the order
the work happened in, and the negative results are kept.

## Historical input policy and limitations

The original exploratory policy allowed, for a query screen:

* that screen's own **metadata** (any field in the parquet except `hit`,
  `relevance_genes` and `relevance_scores`),
* the **labels of pre-2022 screens whose publication is not the query's**, and
* sources that are not derived from the screens being predicted — pharmacology,
  pathway membership, cell-line-independent DepMap summaries.

The measured gene universe in the parquet is additional experimental-library
information. Filtering to it before top-k changes the official description-only
input/evaluation contract. Every baseline must receive the same inputs before
comparison. Pre-2022 donors include validation screens; that is not a train-only
validation protocol. External aggregate/pathway data also need release-specific
temporal and contamination audits; “no direct screen labels” is insufficient.

Two scripts break that rule **on purpose** and say so in their docstring and
their output: `ceiling.py` and `transfer_ceiling.py` fit or select on test in
order to bound what a channel set can express. Their numbers are diagnostics and
must not be quoted as deployable performance. Their existing diagnostic values
are retained below. Neither fitted channel scores nor donor selection defines
a mathematical upper bound for every possible predictor.

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
| `ceiling.py` | historical test-fitted blend reached 0.245; diagnostic for those channels/optimizer, not a proved capacity bound |
| `transfer_ceiling.py` | hindsight donor-transfer diagnostic for the tested algorithm; not a universal ceiling |
| `diag_donor.py` | the best-transferring donor sits at median rank 815 of 1567 under any similarity we can compute, and shares the query's compound 1% of the time |
| `oracle_split.py` | **the important one.** Split each screen's measured genes in half, choose the best donor on half A, score it on half B: it keeps 0.097 of 0.284, about a third. The gap indicates selection optimism under this split experiment; it does not identify exactly what fraction of the official oracle is nontransferable biology |

## Reproducing

```bash
PY="$PWD/engine/.tools/env/bin/python"
export PYTHONPATH="$PWD/engine${PYTHONPATH:+:$PYTHONPATH}"
cd engine/analysis/assaybench_fusion
$PY build.py && $PY build_runs.py && $PY build_all3.py
$PY run12.py          # choose the consensus size
$PY final_fit.py      # choose the weighting scheme
$PY evaluate.py       # retrospective replay; writes results_fusion.json
$PY oracle_split.py   # the oracle selection-maximum experiment
```

These commands rebuild and overwrite local caches/results; preserve existing
artifacts first. Source data and optional dependencies must already be available.
A historical `build_all3.py` run took about a minute, not a runtime guarantee.
Replaying an already exposed test set does not restore independence.
