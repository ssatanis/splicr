"""Second validation hypothesis: text learns gene-specific prior residuals.

Triggered by first-round validation failures, never by new test scores.
Only validation is loaded during select. Replay checks the frozen source hash.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from controlled_benchmark import OUT, provenance, write, summarize, predict
from splicr.assaybench_io import load_split
from splicr.prescreen import HistoricalRanker, PriorConfig, TextResidualRanker
from splicr.research_protocol import cluster_interval, evaluate_predictions, sha256_file


def main(phase):
    prov = provenance()
    prov["residual_runner_sha256"] = sha256_file(__file__)
    if phase == "select":
        configs = {"global": {"kind": "prior"}, "text_ridge_0.1": {"kind": "ridge", "alpha": .1},
                   "text_ridge_1": {"kind": "ridge", "alpha": 1},
                   "text_ridge_10": {"kind": "ridge", "alpha": 10}}
        write("residual_preregistration.json", {"provenance": prov, "configs": configs,
              "hypothesis": "regularized text predicts gene residuals; missing assays imputed with prior",
              "selection": "validation mean AnDCG@100; no test loaded"})
        evaluation = load_split("validation")
    else:
        frozen = json.loads((OUT / "final_model_freeze.json").read_text())
        if frozen["provenance"] != prov:
            raise ValueError("code or data changed since final freeze")
        configs = {"global": {"kind": "prior"}, frozen["name"]: frozen["config"]}
        evaluation = load_split("test")
    start = time.perf_counter()
    train = load_split("train")
    corpus = HistoricalRanker(PriorConfig(hierarchy="global")).fit(train)
    fit_seconds = time.perf_counter() - start
    del train
    results, per_screen = {}, {}
    for name, cfg in configs.items():
        start = time.perf_counter()
        model = corpus if cfg["kind"] == "prior" else TextResidualRanker(cfg["alpha"]).fit_corpus(corpus)
        fit_extra = time.perf_counter() - start
        tick = time.perf_counter()
        predictions = predict(model, evaluation)
        seconds = time.perf_counter() - tick
        write(f"residual_{phase}_{name}_predictions.json", predictions)
        rows = evaluate_predictions(evaluation, predictions)
        per_screen[name] = rows
        results[name] = {**summarize(rows), "prediction_seconds": seconds,
                          "additional_fit_seconds": fit_extra, "config": cfg}
        write(f"residual_{phase}_{name}_screens.json", rows)
        print(phase, name, results[name]["mean"], "fit", fit_extra, "predict", seconds, flush=True)
        write(f"residual_{phase}_summary.json", {"provenance": prov, "fit_seconds": fit_seconds, "models": results})
        if model is not corpus:
            del model
    for name, rows in per_screen.items():
        delta = [a["adjusted_ndcg@100"] - b["adjusted_ndcg@100"] for a, b in zip(rows, per_screen["global"])]
        results[name]["paired_vs_global"] = cluster_interval(delta, [r["source_id"] for r in rows])
    if phase == "select":
        name = max(results, key=lambda x: results[x]["mean"])
        write("final_model_freeze.json", {"name": name, "config": configs[name], "provenance": prov,
              "selection_data": "2021 validation; optimistic", "test_access_this_experiment": False,
              "historical_public_test_access": True})
        print("FINAL FREEZE", name, flush=True)
    write(f"residual_{phase}_summary.json", {"provenance": prov, "fit_seconds": fit_seconds, "models": results})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("select", "replay"))
    main(parser.parse_args().phase)
