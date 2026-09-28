"""Offline loader for Genentech's AssayBench benchmark.

Reads the parquet snapshot already on disk at
``data/references/assaybench/snapshot``, no network, no HuggingFace call.

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
from pathlib import Path
from typing import Any, Iterator

import pyarrow.parquet as pq

ASSAYBENCH_SNAPSHOT = os.environ.get(
    "ASSAYBENCH_SNAPSHOT",
    str(Path(__file__).resolve().parents[2] / "data/references/assaybench/snapshot"),
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
    split: str | None = "test",
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
    return list(iter_split(split, config=config, fold_column=fold_column,
                           snapshot=snapshot, with_metadata=with_metadata))


def iter_split(
    split: str | None = "test", config: str = "biogrid",
    fold_column: str = "yearfold0", snapshot: str | None = None,
    with_metadata: bool = True,
) -> Iterator[dict[str, Any]]:
    """Stream bounded batches; never materialize another split's full table."""
    if split not in (None, "train", "validation", "test"):
        raise ValueError(f"unknown split {split!r}")
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
    if split is not None and use_fold is None and not (config == "LaTest" and split == "test"):
        raise ValueError(f"split column {fold_column!r} missing from {config!r}")
    if use_fold:
        cols.append(use_fold)
    cols = list(dict.fromkeys(cols))

    for batch in pf.iter_batches(batch_size=16, columns=cols):
        for rec in batch.to_pylist():
            if split is not None and use_fold and rec[use_fold] != split:
                continue
            rec["split"] = rec.get(use_fold, "held_out") if use_fold else "held_out"
            rec["num_genes"] = len(rec["relevance_genes"])
            yield rec


def mean_andcg_at_100(predictions: dict[str, list[str]], split: str = "test",
                      *, allow_partial: bool = False) -> float:
    """Score a {dataset_name: ranked_gene_list} mapping with the upstream metric.

    Missing predictions fail closed. Partial scoring requires explicit opt-in
    and is unsuitable for a full-split benchmark claim.
    """
    from assaybench.benchmark.metrics import RankingMetrics

    metric = RankingMetrics(k_values=[100], metric_groups=["adjusted_ndcg"])
    vals = []
    missing = []
    for screen in load_split(split=split, with_metadata=False):
        genes = predictions.get(screen["dataset_name"])
        if genes is None:
            missing.append(str(screen["dataset_name"]))
            continue
        res = metric.evaluate(
            predicted_genes=genes,
            ground_truth_genes=screen["relevance_genes"],
            relevance_scores=screen["relevance_scores"],
        )
        vals.append(res["adjusted_ndcg@100"])
    if missing and not allow_partial:
        raise ValueError(f"missing predictions for {len(missing)} screens: {missing[:5]}")
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
