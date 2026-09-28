"""Reproducible train-only experiments; validation selection then explicit replay.

    PYTHONPATH=engine engine/.tools/env/bin/python engine/analysis/controlled_benchmark.py select
    PYTHONPATH=engine engine/.tools/env/bin/python engine/analysis/controlled_benchmark.py replay

Replay is a retrospective public-test comparison, never prospective validation.
No target-library membership is passed to the new models in either phase.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict
import importlib.metadata
import inspect
import json
from pathlib import Path
import subprocess
import time

import numpy as np

from splicr.assaybench_io import ASSAYBENCH_SNAPSHOT, load_split
from splicr.prescreen import HistoricalRanker, PriorConfig, ScreenContext
from splicr.research_protocol import cluster_interval, evaluate_predictions, sha256_file

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "research/artifacts"

# Hypothesis-defined small ablation set. Written to disk before scoring.
CONFIGS = {
    "global": PriorConfig(hierarchy="global"),
    "phenotype": PriorConfig(),
    "phenotype_shrink": PriorConfig(shrinkage=10),
    "direction": PriorConfig(hierarchy="direction", shrinkage=10),
    "direction_signed": PriorConfig(hierarchy="direction", shrinkage=10, negative_weight=1),
    "study_balanced": PriorConfig(study_balance=True, shrinkage=2),
    "study_direction": PriorConfig(study_balance=True, hierarchy="direction", shrinkage=2, negative_weight=1),
    "condition": PriorConfig(study_balance=True, hierarchy="condition", shrinkage=2, negative_weight=1),
    "text_transfer": PriorConfig(study_balance=True, hierarchy="direction", shrinkage=2,
                                  negative_weight=1, retrieval_weight=0.5),
}


def write(name, value):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n")


def provenance():
    from assaybench.benchmark.metrics import RankingMetrics
    metric_path = inspect.getfile(RankingMetrics)
    return {"git_revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
            "assaybench_version": importlib.metadata.version("assaybench"),
            "metric_sha256": sha256_file(metric_path),
            "data_sha256": sha256_file(Path(ASSAYBENCH_SNAPSHOT) / "biogrid/train-00000-of-00001.parquet"),
            "model_code_sha256": sha256_file(ROOT / "engine/splicr/prescreen.py"),
            "protocol_code_sha256": sha256_file(ROOT / "engine/splicr/research_protocol.py"),
            "loader_code_sha256": sha256_file(ROOT / "engine/splicr/assaybench_io.py"),
            "runner_code_sha256": sha256_file(__file__),
            "protocol": "train <=2020; validation 2021; public test >=2022 already explored historically",
            "input": "pre-experimental metadata; train-union genes; no target library",
            "seed": 20260927}


def predict(model, screens):
    return {str(s["dataset_name"]): model.rank(ScreenContext.from_record(s)) for s in screens}


def summarize(rows):
    result = cluster_interval([r["adjusted_ndcg@100"] for r in rows], [r["source_id"] for r in rows])
    for key in ("adjusted_ndcg@10", "precision@10", "precision@100", "recall@100",
                "wrong_direction_fraction_returned", "invalid_hgnc_fraction", "measured_at100", "slot_precision_at100"):
        if key in rows[0]:
            result[key] = float(np.mean([r[key] for r in rows]))
    result["distribution"] = dict(zip(("min", "p25", "median", "p75", "max"),
                                       np.quantile([r["adjusted_ndcg@100"] for r in rows], [0, .25, .5, .75, 1]).tolist()))
    result["subgroups"] = {}
    for field in ("phenotype", "modality", "cell_line", "condition"):
        result["subgroups"][field] = {}
        for group in sorted(set(str(r[field]) for r in rows)):
            members = [r for r in rows if str(r[field]) == group]
            result["subgroups"][field][group] = cluster_interval(
                [r["adjusted_ndcg@100"] for r in members], [r["source_id"] for r in members], repeats=2000)
    return result


def main(phase):
    started = time.perf_counter()
    prov = provenance()
    if phase == "select":
        write("experiment_preregistration.json", {"provenance": prov,
              "hypotheses": {name: asdict(cfg) for name, cfg in CONFIGS.items()},
              "selection": "highest validation AnDCG@100; selected validation result is optimistic",
              "promotion": "no superiority claim unless paired publication interval excludes zero; future cohort still required"})
        train, evaluation = load_split("train"), load_split("validation")
        configs = CONFIGS
    else:
        frozen = json.loads((OUT / "selected_model.json").read_text())
        for key in ("data_sha256", "model_code_sha256", "metric_sha256", "runner_code_sha256"):
            if frozen["provenance"][key] != prov[key]:
                raise ValueError(f"frozen {key} changed; a new selection record is required")
        train, evaluation = load_split("train"), load_split("test")
        configs = {"phenotype": CONFIGS["phenotype"], frozen["name"]: PriorConfig(**frozen["config"])}
    print(f"{phase}: {len(train)} training / {len(evaluation)} evaluation screens", flush=True)
    model = HistoricalRanker().fit(train)
    fit_seconds = time.perf_counter() - started
    train_pubs = {str(s["source_id"]) for s in train}
    eval_pubs = {str(s["source_id"]) for s in evaluation}
    write(f"{phase}_cohort_audit.json", {"n_train": len(train), "n_evaluation": len(evaluation),
          "training_publications": len(train_pubs), "evaluation_publications": len(eval_pubs),
          "overlap_publications": sorted(train_pubs & eval_pubs),
          "overlap_handling": "excluded from query donors", "specification": model.specification()})
    del train
    all_rows, summaries = {}, {}
    for name, config in configs.items():
        model.config = config
        tick = time.perf_counter()
        preds = predict(model, evaluation)
        elapsed = time.perf_counter() - tick
        # Save the predictions before the evaluator receives any target labels.
        write(f"{phase}_{name}_predictions.json", preds)
        rows = evaluate_predictions(evaluation, preds)
        all_rows[name] = rows
        summaries[name] = {**summarize(rows), "prediction_seconds": elapsed, "config": asdict(config)}
        print(name, summaries[name]["mean"], "prediction_seconds", elapsed, flush=True)
        write(f"{phase}_{name}_screens.json", rows)
        write(f"{phase}_summary.json", {"provenance": prov, "fit_seconds": fit_seconds, "models": summaries})
    baseline = all_rows["phenotype"]
    for name, rows in all_rows.items():
        delta = [a["adjusted_ndcg@100"] - b["adjusted_ndcg@100"] for a, b in zip(rows, baseline)]
        summaries[name]["paired_vs_phenotype"] = cluster_interval(delta, [r["source_id"] for r in rows])
    if phase == "select":
        selected = max(summaries, key=lambda name: summaries[name]["mean"])
        write("selected_model.json", {"name": selected, "config": asdict(configs[selected]),
              "provenance": prov, "selection_split": "validation", "no_test_labels_loaded": True,
              "validation_is_selection_data": True})
        print("FROZEN", selected, flush=True)
    write(f"{phase}_summary.json", {"provenance": prov, "fit_seconds": fit_seconds,
          "total_seconds": time.perf_counter() - started, "models": summaries})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("select", "replay"))
    main(parser.parse_args().phase)
