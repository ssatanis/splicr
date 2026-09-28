"""Auditable evaluation and immutable prospective prediction receipts."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping, Sequence

import numpy as np


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def cluster_interval(values: Sequence[float], groups: Sequence[str], *,
                     repeats: int = 10000, seed: int = 20260927) -> dict:
    """Publication bootstrap, retaining screen-weighted estimand and pairing.

    For a paired comparison pass per-screen differences in identical order.
    Draw entire clusters, retaining every screen in each selected publication.
    A single publication cannot estimate between-publication uncertainty.
    """
    v = np.asarray(values, dtype=float)
    g = np.asarray(groups, dtype=str)
    if v.ndim != 1 or len(v) != len(g) or not len(v) or not np.isfinite(v).all():
        raise ValueError("finite aligned nonempty values and groups required")
    if any(not x for x in g) or repeats < 1:
        raise ValueError("publication IDs and positive repeats required")
    unique, inv = np.unique(g, return_inverse=True)
    result = {"mean": float(v.mean()), "n_screens": len(v), "n_publications": len(unique),
              "seed": seed, "repeats": repeats, "unit": "publication", "ci95": None}
    if len(unique) < 2:
        return result
    sums = np.bincount(inv, weights=v)
    counts = np.bincount(inv)
    rng = np.random.default_rng(seed)
    draws = []
    for start in range(0, repeats, 256):
        sample = rng.integers(0, len(unique), size=(min(256, repeats - start), len(unique)))
        draws.extend((sums[sample].sum(1) / counts[sample].sum(1)).tolist())
    result["ci95"] = np.quantile(draws, [0.025, 0.975]).tolist()
    return result


def evaluate_predictions(screens: Sequence[Mapping], predictions: Mapping[str, Sequence[str]],
                         metric=None) -> list[dict]:
    """Official evaluator, full coverage, no ranking repair or target filtering."""
    from assaybench.benchmark.metrics import RankingMetrics
    from .benchmark import AnDCG

    names = [str(s["dataset_name"]) for s in screens]
    if len(set(names)) != len(names):
        raise ValueError("duplicate screen IDs")
    if set(names) != set(predictions):
        raise ValueError("prediction keys must exactly match evaluation cohort")
    metric = metric or RankingMetrics(k_values=[10, 100],
                                      metric_groups=["adjusted_ndcg", "precision", "recall", "fdr"])
    mapper = AnDCG(gene_mapper=metric.gene_mapper, hgnc_symbols=frozenset(metric._hgnc_approved_symbols))
    output = []
    for screen in screens:
        name = str(screen["dataset_name"])
        ranked = predictions[name]
        if not isinstance(ranked, (list, tuple)) or any(not isinstance(g, str) or not g.strip() for g in ranked):
            raise ValueError(f"invalid prediction for {name}")
        genes, rel = screen["relevance_genes"], screen["relevance_scores"]
        if len(genes) != len(rel) or not len(genes) or not np.isfinite(rel).all():
            raise ValueError(f"invalid evaluation target {name}")
        evaluated = metric.evaluate(predicted_genes=list(ranked), ground_truth_genes=genes,
                                    relevance_scores=rel)
        # Upstream also returns gene arrays and undefined normalized diagnostics.
        # Keep the declared numeric metrics, not its auxiliary result payload.
        scores = {key: value for key, value in evaluated.items()
                  if key.startswith(("adjusted_ndcg@", "precision@", "recall@", "fdr@"))}
        # Upstream evaluate omits secondary metrics for short/deduplicated lists.
        # Call the same official functions so every screen retains a denominator.
        for cutoff in (10, 100):
            values = evaluated["predicted_values"]
            scores[f"precision@{cutoff}"] = metric.compute_precision_at_k(values, cutoff, 0)
            scores[f"recall@{cutoff}"] = metric.compute_recall_at_k(values, rel, cutoff, 0)
            scores[f"fdr@{cutoff}"] = metric.compute_fdr_at_k(values, cutoff, 0)
        if not all(np.isfinite(v) for v in scores.values()):
            raise ArithmeticError(f"nonfinite official metric for {name}")
        normalized = list(dict.fromkeys(mapper.normalize(g) for g in ranked))[:100]
        truth = {mapper.normalize(g): float(v) for g, v in zip(genes, rel)}
        measured = [truth[g] for g in normalized if g in truth]
        # Report denominators explicitly; official precision condenses unknowns.
        diagnostics = {
            "returned_unique_at100": len(normalized), "measured_at100": len(measured),
            "wrong_direction_at100": sum(v < 0 for v in measured),
            "wrong_direction_fraction_returned": sum(v < 0 for v in measured) / max(len(normalized), 1),
            "invalid_hgnc_fraction": sum(g not in mapper.hgnc_symbols for g in normalized) / max(len(normalized), 1),
            "slot_precision_at100": sum(v > 0 for v in measured) / 100,
        }
        output.append({"dataset_name": name, "source_id": str(screen.get("source_id") or "missing:" + name),
                       "phenotype": screen.get("cleaned_phenotype", "unknown"),
                       "cell_line": screen.get("cell_line", "unknown"),
                       "modality": screen.get("library_methodology", "unknown"),
                       "condition": screen.get("condition_name", "unknown"),
                       **{k: float(v) for k, v in scores.items()}, **diagnostics})
    return output


def freeze_predictions(path: str | Path, *, predictions: Mapping[str, Sequence[str]],
                       model_manifest: Mapping, contexts: Mapping, training_publications: Sequence[str]) -> str:
    """Write an exclusive-create receipt before independently held labels arrive.

    This local receipt provides a content commitment, not trusted timestamping
    or access control. An independent custodian must retain the hash externally.
    Outcome labels have no argument in this API.
    """
    if not predictions or set(predictions) != set(contexts):
        raise ValueError("predictions and contexts must cover the same nonempty cohort")
    from .prescreen import FIELDS, clean
    permitted = set(FIELDS) | {"source_id", "dataset_name"}
    training_ids = {clean(p) for p in training_publications}
    for name, context in contexts.items():
        if not set(context).issubset(permitted) or any(not isinstance(v, (str, int, float, type(None))) for v in context.values()):
            raise ValueError("prospective context contains target information or unsupported fields")
        if clean(context.get("source_id", "")) in training_ids:
            raise ValueError(f"prospective publication overlaps training: {name}")
        genes = predictions[name]
        if not genes or len(genes) != len(set(genes)) or any(not isinstance(g, str) or not g for g in genes):
            raise ValueError("prospective rankings must be nonempty unique gene symbols")
    payload = {"schema": "splicr.prediction-freeze.v1", "created_utc": datetime.now(timezone.utc).isoformat(),
               "predictions": predictions, "contexts": contexts, "model": model_manifest,
               "training_publications": sorted(set(map(str, training_publications))),
               "timestamp_trust": "local; independent custodian required"}
    encoded = json.dumps(payload, sort_keys=True, indent=2, allow_nan=False).encode()
    with open(path, "xb") as stream:
        stream.write(encoded)
    return hashlib.sha256(encoded).hexdigest()
