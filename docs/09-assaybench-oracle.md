# The oracle row is mostly a selection maximum

AssayBench's leaderboard is topped by `Oracle kNN` at AnDCG@100 = **0.2918**,
labelled as an oracle because it is chosen with the answers in hand. It is
natural to read that row as the ceiling on screen-to-screen transfer: the best
past screen, and therefore the most a perfect retriever could copy.

It is not. Measured on the same 334 test screens, **about two-thirds of that
0.2918 is the maximum of 1349 noisy draws, not signal a retriever could find.**
This file records the three measurements that establish it, because it changes
what a reader should conclude from every other row in the table.

## What the oracle is

`benchmark.OracleKNN` follows upstream's `knn_test.py`. For each evaluation
screen it sweeps all 1349 training screens, scores each donor's own top-100 gene
list against the evaluation screen's labels, and keeps the best. So it is `max`
over a fixed set of 1349 candidate rankings, with the selection made on the
answer.

A maximum over many candidates is biased upward even when no candidate is
genuinely related to the query. How much of 0.2918 is that bias is an empirical
question, and it has an answer.

## 1. Split the labels in half

Each screen's measured genes are partitioned at random into halves A and B, each
keeping its own relevance values. The donor that scores best on half A is then
scored on half B. If the oracle's choice reflects a real neighbour, the A-chosen
donor should also be near the top on B. If the choice is the argmax of noise,
it will not be.

Over 20 random partitions of the 314 test screens that have gradeable labels in
both halves (`engine/analysis/assaybench_fusion/oracle_split.py`), with 95%
intervals over partitions:

| | AnDCG@100 on half B |
|---|---|
| best donor on half B — the oracle, within B | **0.2839** [0.2741, 0.2955] |
| 99th-percentile donor on half B | 0.1413 [0.1365, 0.1474] |
| **donor chosen on half A, scored on half B** | **0.0970** [0.0922, 0.1047] |
| mean over all 1567 donors on half B | 0.0269 [0.0241, 0.0293] |

The transferable fraction is **0.342** [0.319, 0.378]. The donor picked with half
the answer key in hand retains roughly a third of the oracle's value — and lands
*below* the 99th-percentile donor, which is where a merely lucky draw sits.

Note also that the within-B oracle (0.2839) is barely below the full-label
oracle (0.3008 densified, 0.2918 as shipped). Halving the labels does not move
the oracle. That is what a selection maximum looks like: it is set by how many
candidates you maximise over, not by how much of the answer you hold.

## 2. The best donor is not identifiable

For each test screen, take the donor with the highest true transfer and ask what
it shares with the query (`diag_donor.py`):

| category | n | same phenotype | same direction | same cell line | same compound | same pathogen |
|---|---|---|---|---|---|---|
| Drug / Chemical | 144 | 0.52 | 0.49 | 0.19 | **0.01** | 0.00 |
| Host-Pathogen | 104 | 0.30 | 0.41 | 0.08 | 0.00 | **0.23** |
| Fitness | 42 | 0.79 | 0.69 | 0.00 | 0.00 | 0.00 |
| Molecular Output | 39 | 0.05 | 0.28 | 0.00 | 0.00 | 0.00 |

On drug screens the best donor is a screen of the **same compound 1% of the
time**. Under the sharpest label-free similarity in this repository — IDF-weighted
cosine between the query's model-predicted hit vector and each donor's measured
hit profile — the best donor sits at **median rank 815 of 1567**, and is inside
the top 10 for 21% of drug screens and 0% of fitness screens.

## 3. Multi-donor transfer does not escape it either

Give the aggregation a *perfect* similarity function — weight donors by their
true transfer value, which is an oracle — and combine many donors instead of one
(`transfer_ceiling.py`). The best configuration measured is **0.3126**, against
the single-donor densified oracle's 0.3008. Pooling donors with perfect weights
buys 0.012.

So the honest reading is not "a better retriever would approach 0.29". It is
that donor transfer, with a perfect retriever and unlimited donors, lives around
0.31, and with any retriever that exists it lives near **0.10**.

## What follows for the leaderboard

* The oracle row is not a ceiling on attainable performance, and it is not a
  ceiling on retrieval. It is a bound on `max` over 1349 fixed rankings.
* A method's distance to 0.2918 is not a measure of how much transferable signal
  it is leaving on the table.
* The bar a method actually has to clear is the best non-oracle system, and the
  bar it should be *compared* to on equal terms is that system **after the same
  ranked-list post-processing** — see `docs/08-assaybench-headroom.md` section 2,
  where densifying and padding to 100 in-library candidates is worth about
  +0.056 to every published system.

None of this is a criticism of the benchmark: the row is labelled an oracle, and
upstream ships the predictions that let anyone check it, which is how this was
checkable at all. It is a correction to how the row is read.

## Reproducing

```bash
PY=engine/.tools/env/bin/python
cd engine/analysis/assaybench_fusion
$PY build.py && $PY build_runs.py && $PY build_all3.py
REPS=20 $PY oracle_split.py      # section 1
$PY transfer_ceiling.py          # section 3, and the densified oracle
$PY diag_donor.py                # section 2
```

`oracle_split.py`, `transfer_ceiling.py` and `diag_donor.py` all read test
labels by design — they are diagnostics about the benchmark, not scorers, and
they say so in their own docstrings.
