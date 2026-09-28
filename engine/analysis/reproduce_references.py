"""Re-score shipped upstream predictions and old SplicR using official code.

This replays historical results; no model decisions are made here. Does not
filter, pad, backfill, or reorder any published ranking.
"""
from __future__ import annotations

import ast
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from controlled_benchmark import OUT, ROOT, provenance, summarize, write
from splicr.assaybench_io import load_split
from splicr.benchmark import GeneFrequencyPrior
from splicr.research_protocol import evaluate_predictions, sha256_file

PATHS = {
    "published_ensemble": "ensemble/LLM__RRF__Ensemble.json",
    "published_gemini3pro": "llm/gemini-3-pro.json",
    "published_gpt54": "llm/gpt-5.4.json",
    "published_phenotype_frequency": "baselines/baseline__coarse-phenotype-hit-freq.json",
    "published_embedding_knn": "knn/Embedding__kNN.json",
    "published_oracle_knn": "knn/Oracle__kNN.json",
}


def published_predictions(relative, screens, split="test"):
    path = ROOT / "engine/.tools/assaybench/benchmarking/predictions" / relative
    doc = json.loads(path.read_text())
    wanted = {str(s["dataset_name"]) for s in screens}
    predictions = {}
    upstream_split = "val" if split == "validation" else split
    for records in doc["records_by_dataset"].values():
        for record in records if isinstance(records, list) else [records]:
            name = str(record["dataset_name"])
            if name not in wanted or record.get("split") != upstream_split or record.get("split_layout") != "year":
                continue
            if name in predictions:
                raise ValueError(f"ambiguous published prediction for {name}")
            genes = record["predicted_genes"]
            predictions[name] = ast.literal_eval(genes) if isinstance(genes, str) else genes
    return predictions, sha256_file(path)


def main():
    test = load_split("test")
    summary = {"provenance": provenance(), "models": {}}
    for name, path in PATHS.items():
        predictions, digest = published_predictions(path, test)
        rows = evaluate_predictions(test, predictions)
        summary["models"][name] = {**summarize(rows), "predictions_sha256": digest,
                                     "postprocessing": "none"}
        write(f"reference_{name}_screens.json", rows)
        write("official_references.json", summary)
        print(name, summary["models"][name]["mean"], flush=True)
    train = load_split("train") + load_split("validation")
    old = GeneFrequencyPrior(stratify_by="cleaned_phenotype", stratum_backoff=False).fit(train)
    seeds = []
    for seed in range(8):
        old.seed = seed
        predictions = {str(s["dataset_name"]): old.rank(s) for s in test}
        rows = evaluate_predictions(test, predictions)
        seeds.append(sum(r["adjusted_ndcg@100"] for r in rows) / len(rows))
        if seed == 0:
            write("reference_splicr_legacy_screens.json", rows)
            summary["models"]["splicr_legacy_seed0"] = summarize(rows)
        print("legacy seed", seed, seeds[-1], flush=True)
    summary["legacy_seed_average"] = {"andcg100": sum(seeds) / len(seeds), "seeds": seeds,
                                        "train": "1349 train + 218 validation", "input": "target library aware"}
    write("official_references.json", summary)


if __name__ == "__main__":
    main()
