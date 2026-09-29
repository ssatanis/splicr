"""Offline, independent verification of frozen historical AssayBench rankings.

No model selection. Direct official evaluation, three exact replays, and an
independently implemented paired publication bootstrap. Historical artifacts are
read-only. The fixed legacy estimator is reconstructed because only its seed-0
score table, not its eight ranking files, was previously retained.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import importlib.metadata
import inspect
import json
from pathlib import Path
import platform
import time
from typing import Mapping, Sequence

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "research/artifacts/20260928/verification"
REPLAYS = 3
BOOTSTRAPS = 10_000
BOOTSTRAP_SEED = 20260928


def encoded(value) -> bytes:
    return (json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def digest(path: str | Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def write_new(path: Path, value) -> str:
    """Never replace earlier evidence, including partial failed runs."""
    payload = encoded(value)
    with path.open("xb") as stream:
        stream.write(payload)
    return hashlib.sha256(payload).hexdigest()


def validate_coverage(screens: Sequence[Mapping], predictions: Mapping) -> list[str]:
    names = [str(s["dataset_name"]) for s in screens]
    if not names or len(set(names)) != len(names):
        raise ValueError("nonempty cohort with unique screen IDs required")
    if set(predictions) != set(names):
        raise ValueError("predictions must cover exactly the full cohort")
    for screen in screens:
        name = str(screen["dataset_name"])
        if not isinstance(screen.get("source_id"), str) or not screen["source_id"].strip():
            raise ValueError("publication identifier required; no invented singleton groups")
        ranked = predictions[name]
        # Duplicate, empty and unrecognized symbols are diagnostics, not grounds
        # for repairing upstream lists. Only a malformed list object fails here.
        if not isinstance(ranked, list) or any(not isinstance(g, str) for g in ranked):
            raise ValueError("predictions must be lists of strings")
        genes, relevance = screen["relevance_genes"], screen["relevance_scores"]
        if (not genes or len(genes) != len(relevance)
                or not all(isinstance(g, str) for g in genes)
                or not np.isfinite(relevance).all()):
            raise ValueError("invalid target arrays")
    return names


def extract_published(path: Path, screens: Sequence[Mapping]) -> dict:
    wanted = {str(s["dataset_name"]) for s in screens}
    result = {}
    for records in json.loads(path.read_text())["records_by_dataset"].values():
        for record in records if isinstance(records, list) else [records]:
            name = str(record["dataset_name"])
            if name not in wanted or record.get("split") != "test" or record.get("split_layout") != "year":
                continue
            if name in result:
                raise ValueError(f"duplicate published record: {name}")
            genes = record["predicted_genes"]
            result[name] = ast.literal_eval(genes) if isinstance(genes, str) else genes
    validate_coverage(screens, result)
    return result


def official_scores(screens: Sequence[Mapping], predictions: Mapping, metric) -> list[dict]:
    """Call upstream directly, bypassing all SplicR metric/aggregation wrappers."""
    validate_coverage(screens, predictions)
    rows = []
    for screen in screens:
        name = str(screen["dataset_name"])
        ranked = predictions[name]
        evaluated = metric.evaluate(predicted_genes=ranked,
                                    ground_truth_genes=screen["relevance_genes"],
                                    relevance_scores=screen["relevance_scores"])
        scores = {}
        for k in (10, 100):
            scores[f"adjusted_ndcg@{k}"] = float(evaluated[f"adjusted_ndcg@{k}"])
            # Short-list secondary metrics are omitted by upstream evaluate;
            # use its own metric functions with exactly the same arrays.
            values = evaluated["predicted_values"]
            scores[f"precision@{k}"] = float(metric.compute_precision_at_k(values, k, 0))
            scores[f"recall@{k}"] = float(metric.compute_recall_at_k(values, screen["relevance_scores"], k, 0))
            scores[f"fdr@{k}"] = float(metric.compute_fdr_at_k(values, k, 0))
        if not all(np.isfinite(value) for value in scores.values()):
            raise ArithmeticError(f"nonfinite official metric: {name}")
        # Use upstream's exact normalized/deduplicated order. Diagnostics never
        # remove invalid symbols or backfill an unmeasured rank slot.
        genes = evaluated["predicted_genes"][:100]
        values = evaluated["predicted_values"][:100]
        measured = [v for v in values if v is not None]
        invalid = [g for g in genes if g not in metric._hgnc_approved_symbols]
        rows.append({
            "dataset_name": name, "source_id": screen["source_id"], **scores,
            "raw_prediction_count": len(ranked),
            "raw_duplicate_count": len(ranked) - len(set(ranked)),
            "normalized_unique_at100": len(genes), "measured_at100": len(measured),
            "unmeasured_at100": len(values) - len(measured),
            "positive_at100": sum(v > 0 for v in measured),
            "negative_at100": sum(v < 0 for v in measured),
            "measured_zero_at100": sum(v == 0 for v in measured),
            "non_hgnc_at100": len(invalid),
            "non_hgnc_but_measured_at100": sum(g in invalid and v is not None for g, v in zip(genes, values)),
            "slot_precision_at100": sum(v > 0 for v in measured) / 100,
        })
    return rows


def paired_publication_bootstrap(values: np.ndarray, publications: Sequence[str], *,
                                 repeats=BOOTSTRAPS, seed=BOOTSTRAP_SEED) -> np.ndarray:
    """Resample whole studies; screen-weighted ratio, shared draws across models.

    Independent implementation: collect per-study row blocks, draw study indices,
    then sum block totals and counts. Never average unweighted study means.
    Columns are models. Seed-averaged legacy is one column, not eight independent
    observations. Between-seed uncertainty is not estimated by this procedure.
    """
    values = np.asarray(values, dtype=float)
    if (values.ndim != 2 or not values.shape[0] or not values.shape[1]
            or len(publications) != len(values) or not np.isfinite(values).all()
            or not isinstance(repeats, int) or isinstance(repeats, bool) or repeats < 1):
        raise ValueError("finite aligned nonempty score matrix and positive integer repeats required")
    if any(not isinstance(p, str) or not p.strip() for p in publications):
        raise ValueError("nonempty publication identifiers required")
    groups = sorted(set(publications))
    if len(groups) < 2:
        raise ValueError("at least two independent publications required")
    blocks = [values[[i for i, p in enumerate(publications) if p == group]] for group in groups]
    sums = np.stack([block.sum(axis=0) for block in blocks])
    sizes = np.array([len(block) for block in blocks])
    rng = np.random.default_rng(seed)
    draws = np.empty((repeats, values.shape[1]))
    for iteration in range(repeats):
        selected = rng.integers(len(groups), size=len(groups))
        draws[iteration] = sums[selected].sum(axis=0) / sizes[selected].sum()
    return draws


def legacy_inputs(screen: Mapping) -> dict:
    """Old practical-library track: no test relevance values enter the ranker."""
    return {"relevance_genes": list(screen["relevance_genes"]),
            "cleaned_phenotype": screen.get("cleaned_phenotype")}


def main(output: Path):
    from assaybench.benchmark.metrics import RankingMetrics
    from assaybench.utils.gene_mapper import GeneMapper
    from splicr.assaybench_io import ASSAYBENCH_SNAPSHOT, load_split
    from splicr.benchmark import GeneFrequencyPrior

    if output.exists() and any(output.iterdir()):
        raise FileExistsError("verification directory is not empty; choose a new output directory")
    output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    historical = ROOT / "research/artifacts"
    parquet = Path(ASSAYBENCH_SNAPSHOT) / "biogrid/train-00000-of-00001.parquet"
    published = ROOT / "engine/.tools/assaybench/benchmarking/predictions/ensemble/LLM__RRF__Ensemble.json"
    router_path = historical / "router_replay_predictions.json"
    references = json.loads((historical / "official_references.json").read_text())
    test = load_split("test")
    train, validation = load_split("train"), load_split("validation")
    if (len(train), len(validation), len(test)) != (1349, 218, 334):
        raise ValueError("unexpected official temporal cohort sizes")
    if digest(parquet) != references["provenance"]["data_sha256"]:
        raise ValueError("historical dataset digest changed")
    metric_path = Path(inspect.getfile(RankingMetrics))
    if digest(metric_path) != references["provenance"]["metric_sha256"]:
        raise ValueError("official metric source changed since historical run")
    input_files = [parquet, published, router_path, historical / "router_freeze.json",
                   historical / "router_replay_summary.json", historical / "official_references.json",
                   historical / "router_replay_screens.json", historical / "reference_published_ensemble_screens.json",
                   historical / "reference_splicr_legacy_screens.json", metric_path, Path(inspect.getfile(GeneMapper)),
                   ROOT / "engine/splicr/benchmark.py", ROOT / "engine/splicr/assaybench_io.py", Path(__file__)]
    from importlib.resources import files
    hgnc_root = Path(str(files("assaybench.data.hgnc")))
    input_files += sorted(p for p in hgnc_root.rglob("*") if p.is_file() and p.suffix in (".tsv", ".csv", ".json", ".txt"))
    manifest = {
        "schema": "splicr.independent-verification.v1", "evaluation": "retrospective public test, not prospective",
        "official_metric": "assaybench.RankingMetrics; adjusted_ndcg at 10 and 100",
        "assaybench_version": importlib.metadata.version("assaybench"),
        "environment": {"python": platform.python_version(), "numpy": np.__version__,
                        "pyarrow": importlib.metadata.version("pyarrow")},
        "replays": REPLAYS, "publication_bootstraps": BOOTSTRAPS, "bootstrap_seed": BOOTSTRAP_SEED,
        "inputs": {str(p.resolve()): digest(p) for p in input_files},
        "boundaries": {
            "published_ensemble": "unchanged saved upstream ranks; original LLM literature memorization/provenance not re-established",
            "router": "unchanged saved ranks; previous validation-selected metadata-only router; no new inference/selection",
            "legacy": "fixed historical phenotype prior; 1349 train + 218 validation; target measured gene list supplied; seeds 0..7",
            "legacy_query_fields": ["relevance_genes", "cleaned_phenotype"],
            "legacy_target_scores": "never passed to ranking; evaluator only",
            "invalid_identifiers": "diagnostic only; official mapping/scoring unchanged, including measured non-HGNC target symbols",
            "postprocessing": "none: no filtering, padding, repair, backfill or hard-screen removal",
            "legacy_comparisons": "different training/library inputs; not fair superiority tests",
        },
        "cohorts": {name: {"screens": len(records), "publications": len({s["source_id"] for s in records}),
                            "dataset_names": [str(s["dataset_name"]) for s in records],
                            "publication_ids": sorted({s["source_id"] for s in records})}
                    for name, records in (("train", train), ("validation", validation), ("test", test))},
    }
    write_new(output / "input_manifest.json", manifest)
    predictions = {"published_ensemble": extract_published(published, test),
                   "router": json.loads(router_path.read_text())}
    print("Reconstruct fixed legacy rankings from training + validation; no model selection", flush=True)
    legacy = GeneFrequencyPrior(stratify_by="cleaned_phenotype", stratum_backoff=False).fit(train + validation)
    for seed in range(8):
        legacy.seed = seed
        predictions[f"legacy_seed{seed}"] = {str(s["dataset_name"]): legacy.rank(legacy_inputs(s)) for s in test}
    del legacy, train, validation
    prediction_paths = {}
    for name, ranking in predictions.items():
        validate_coverage(test, ranking)
        path = output / f"{name}_predictions.json"
        prediction_paths[name] = path
        write_new(path, ranking)
    del predictions

    scores_by_model = {}
    replay_records = []
    for replay in range(1, REPLAYS + 1):
        metric = RankingMetrics(k_values=[10, 100], metric_groups=["adjusted_ndcg"])
        for name, path in prediction_paths.items():
            tick = time.perf_counter()
            ranking = json.loads(path.read_text())
            rows = official_scores(test, ranking, metric)
            score_hash = write_new(output / f"replay{replay}_{name}_screens.json", rows)
            previous = scores_by_model.get(name)
            if previous is not None and encoded(previous) != encoded(rows):
                raise ArithmeticError(f"non-deterministic replay: {name}")
            scores_by_model[name] = rows
            mean = float(np.mean([r["adjusted_ndcg@100"] for r in rows]))
            replay_records.append({"replay": replay, "model": name, "score_sha256": score_hash,
                                   "prediction_sha256": digest(path), "mean_andcg100": mean,
                                   "screens": len(rows), "seconds": time.perf_counter() - tick})
            print(f"replay {replay}: {name} = {mean:.12f}", flush=True)
    write_new(output / "replays.json", replay_records)

    order = [str(s["dataset_name"]) for s in test]
    groups = [s["source_id"] for s in test]
    model_names = ["published_ensemble", "router", "legacy_eight_seed_average"]
    matrix = np.column_stack([
        [r["adjusted_ndcg@100"] for r in scores_by_model["published_ensemble"]],
        [r["adjusted_ndcg@100"] for r in scores_by_model["router"]],
        np.mean([[r["adjusted_ndcg@100"] for r in scores_by_model[f"legacy_seed{seed}"]] for seed in range(8)], axis=0),
    ])
    for rows in scores_by_model.values():
        if [r["dataset_name"] for r in rows] != order:
            raise ValueError("unaligned per-screen score vectors")
    draws = paired_publication_bootstrap(matrix, groups)
    draw_hash = write_new(output / "publication_bootstrap_draws.json", {"models": model_names, "seed": BOOTSTRAP_SEED, "draws": draws.tolist()})
    result = {"replays_identical": True, "n_screens": len(test), "n_publications": len(set(groups)),
              "bootstrap": {"repeats": BOOTSTRAPS, "seed": BOOTSTRAP_SEED, "unit": "publication",
                            "estimand": "screen-weighted mean; entire publications resampled with replacement",
                            "draws_sha256": draw_hash}, "models": {}, "paired_differences": {},
              "limitations": ["Public test already explored; no prospective generalization claim", "No new model was selected",
                              "Legacy uses a supplied library and train+validation, unlike router",
                              "Legacy bootstrap averages eight fixed seeds within each screen; not seed uncertainty",
                              "Intervals are descriptive, without correction for historical experimentation",
                              "Replay verifies saved predictions, not upstream LLM inference or hidden training data"]}
    for col, name in enumerate(model_names):
        result["models"][name] = {"mean_andcg100": float(matrix[:, col].mean()),
                                  "ci95": np.quantile(draws[:, col], [0.025, 0.975]).tolist()}
    for left, right in ((1, 0), (2, 0), (1, 2)):
        result["paired_differences"][f"{model_names[left]}_minus_{model_names[right]}"] = {
            "mean": float((matrix[:, left] - matrix[:, right]).mean()),
            "ci95": np.quantile(draws[:, left] - draws[:, right], [0.025, 0.975]).tolist(),
            "input_comparable": 2 not in (left, right)}
    expected = [references["models"]["published_ensemble"]["mean"],
                json.loads((historical / "router_replay_summary.json").read_text())["router"]["mean"],
                references["legacy_seed_average"]["andcg100"]]
    result["historical_mean_differences"] = dict(zip(model_names, (matrix.mean(axis=0) - expected).tolist()))
    if not np.allclose(matrix.mean(axis=0), expected, rtol=0, atol=1e-12):
        raise ArithmeticError("independent means disagree with archived results")
    result["legacy_seed_means"] = [float(np.mean([r["adjusted_ndcg@100"] for r in scores_by_model[f"legacy_seed{seed}"]])) for seed in range(8)]
    diagnostics = {}
    for name, rows in scores_by_model.items():
        sums = {key: sum(r[key] for r in rows) for key in (
            "raw_prediction_count", "raw_duplicate_count", "normalized_unique_at100", "measured_at100",
            "unmeasured_at100", "positive_at100", "negative_at100", "measured_zero_at100", "non_hgnc_at100", "non_hgnc_but_measured_at100")}
        diagnostics[name] = {"screens": len(rows), "missing_predictions": 0, "extra_predictions": 0, **sums,
                             "non_hgnc_fraction_normalized_top100": sums["non_hgnc_at100"] / max(1, sums["normalized_unique_at100"]),
                             "wrong_direction_fraction_normalized_top100": sums["negative_at100"] / max(1, sums["normalized_unique_at100"])}
    result["coverage_diagnostics"] = diagnostics
    result["seconds"] = time.perf_counter() - started
    write_new(output / "summary.json", result)
    write_new(output / "output_manifest.json", {p.name: digest(p) for p in sorted(output.glob("*.json"))})
    print(json.dumps(result["models"], indent=2), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    main(parser.parse_args().output)
