"""Offline loader for Genentech's AssayBench benchmark.

Reads the parquet snapshot already on disk at
``data/references/assaybench/snapshot`` — no network, no HuggingFace call.

The HuggingFace repo exposes only a ``train`` split per config; the real
train/validation/test partition lives in the ``yearfold0`` column
(temporal split: train <=2020, validation 2021, test >=2022).

Scoring must use the upstream metric, not a reimplementation:

    from assaybench.benchmark.metrics import RankingMetrics
    m = RankingMetrics(k_values=[10, 100], metric_groups=["adjusted_ndcg"])
    res = m.evaluate(predicted_genes=my_ranked_genes,
                     ground_truth_genes=screen["relevance_genes"],
                     relevance_scores=screen["relevance_scores"])
    res["adjusted_ndcg@100"]   # AnDCG@100 for this screen

The benchmark score is the unweighted mean of per-screen ``adjusted_ndcg@100``
over the 334 test screens.
"""

from __future__ import annotations

import os
from typing import Any, Iterator

import pyarrow.parquet as pq

ASSAYBENCH_SNAPSHOT = os.environ.get(
    "ASSAYBENCH_SNAPSHOT",
    "/Users/sahaj/Documents/Projects/SplicR/data/references/assaybench/snapshot",
)

# Columns needed to score a prediction, plus the metadata a predictor may condition on.
GROUND_TRUTH_COLS = ["dataset_name", "relevance_genes", "relevance_scores", "hit"]
METADATA_COLS = [
    "cell_line", "cell_type", "phenotype", "cleaned_phenotype", "screen_rationale",
    "library_methodology", "screen_type", "library_type", "experimental_setup",
    "condition_name", "condition_dosage", "duration", "notes", "condition_clause",
    "significance_criteria", "ranking_rationale", "source", "screen_category",
    "author", "source_id",
]
SPLIT_COLS = ["yearfold0", "randomfold0"]


def load_split(
    split: str = "test",
    config: str = "biogrid",
    fold_column: str = "yearfold0",
    snapshot: str | None = None,
    with_metadata: bool = True,
) -> list[dict[str, Any]]:
    """Return the AssayBench screens for one split as a list of dicts.

    Args:
        split: "train", "validation" or "test". Pass None for every row.
        config: "biogrid" (1901 screens) or "LaTest" (19 held-out 2025/26 screens;
            its own yearfold0 is "test" for all 19 rows, and it has no randomfold*
            columns, so pass split=None or split="test" for the whole set).
        fold_column: which split assignment to use. "yearfold0" is the primary
            temporal split. "randomfold0" is the easier random split
            (biogrid only: 1515 train / 187 validation / 199 test).
        snapshot: override the snapshot directory.
        with_metadata: include the screen-description fields, not just ground truth.

    Returns:
        One dict per screen with at least ``dataset_name``, ``relevance_genes``,
        ``relevance_scores`` and ``hit``.
    """
    root = snapshot or ASSAYBENCH_SNAPSHOT
    path = os.path.join(root, config, "train-00000-of-00001.parquet")
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"AssayBench parquet not found at {path}. Re-download with:\n"
            f"  HF_HOME={root}/../hf_cache python -c \"from huggingface_hub import "
            f"snapshot_download; snapshot_download('Genentech/assaybench', "
            f"repo_type='dataset', local_dir='{root}')\""
        )

    pf = pq.ParquetFile(path)
    available = set(pf.schema_arrow.names)
    cols = list(GROUND_TRUTH_COLS)
    if with_metadata:
        cols += [c for c in METADATA_COLS if c in available]
    # LaTest has no split column of its own: every row is the held-out set.
    use_fold = fold_column if fold_column in available else None
    if use_fold:
        cols.append(use_fold)
    cols = list(dict.fromkeys(cols))

    out: list[dict[str, Any]] = []
    for i in range(pf.num_row_groups):  # stream: the biogrid table is ~883 MB in memory
        batch = pf.read_row_group(i, columns=cols).to_pylist()
        for rec in batch:
            if split is not None and use_fold and rec[use_fold] != split:
                continue
            rec["split"] = rec.get(use_fold, "held_out") if use_fold else "held_out"
            rec["num_genes"] = len(rec["relevance_genes"])
            out.append(rec)
    return out


def iter_split(split: str = "test", **kw) -> Iterator[dict[str, Any]]:
    """Memory-friendlier generator form of :func:`load_split`."""
    yield from load_split(split=split, **kw)


def mean_andcg_at_100(predictions: dict[str, list[str]], split: str = "test") -> float:
    """Score a {dataset_name: ranked_gene_list} mapping with the upstream metric.

    Screens present in the split but missing from ``predictions`` are skipped,
    so compare only runs that cover the same screen set.
    """
    from assaybench.benchmark.metrics import RankingMetrics

    metric = RankingMetrics(k_values=[100], metric_groups=["adjusted_ndcg"])
    vals = []
    for screen in load_split(split=split, with_metadata=False):
        genes = predictions.get(screen["dataset_name"])
        if genes is None:
            continue
        res = metric.evaluate(
            predicted_genes=genes,
            ground_truth_genes=screen["relevance_genes"],
            relevance_scores=screen["relevance_scores"],
        )
        vals.append(res["adjusted_ndcg@100"])
    if not vals:
        raise ValueError("no overlap between predictions and the requested split")
    return sum(vals) / len(vals)


if __name__ == "__main__":
    test = load_split("test")
    print(f"test screens: {len(test)}")
    s = test[0]
    print(f"first: {s['dataset_name']} genes={s['num_genes']} "
          f"pos={sum(1 for x in s['relevance_scores'] if x > 0)} "
          f"neg={sum(1 for x in s['relevance_scores'] if x < 0)}")
    print(f"phenotype: {s['phenotype'][:90]}")
    for name, n in (("train", 1349), ("validation", 218), ("test", 334)):
        got = len(load_split(name, with_metadata=False))
        print(f"{name:<11} {got:>5}  expected {n:>5}  {'OK' if got == n else 'MISMATCH'}")
    print(f"LaTest      {len(load_split(None, config='LaTest', with_metadata=False)):>5}  expected    19")
