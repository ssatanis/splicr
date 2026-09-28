"""Metadata-only routing, frozen on validation, with unchanged upstream ranks."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from controlled_benchmark import OUT, ROOT, provenance, write, summarize, predict
from reproduce_references import published_predictions
from splicr.assaybench_io import load_split
from splicr.prescreen import HistoricalRanker, PriorConfig, ScreenContext
from splicr.evidence_router import EvidenceRouter, choose_routes
from splicr.research_protocol import cluster_interval, evaluate_predictions, sha256_file

EXTERNAL = "ensemble/LLM__RRF__Ensemble.json"


def main(phase):
    prov = provenance()
    prov.update({"router_sha256": sha256_file(ROOT / "engine/splicr/evidence_router.py"),
                 "router_runner_sha256": sha256_file(__file__),
                 "prediction_loader_sha256": sha256_file(ROOT / "engine/analysis/reproduce_references.py")})
    if phase == "select":
        write("router_preregistration.json", {"provenance": prov,
              "experts": ["external", "global", "phenotype"], "min_publications": 3,
              "hypothesis": "historical priors specialize in recurrent fitness hits; external knowledge covers context-specific hits",
              "no_library_information": True, "no_padding_or_gene_backfill": True})
        split = "validation"
    else:
        frozen = json.loads((OUT / "router_freeze.json").read_text())
        if frozen["provenance"] != prov:
            raise ValueError("frozen router code/data changed")
        split = "test"
    screens = load_split(split)
    external, external_hash = published_predictions(EXTERNAL, screens, split)
    if set(external) != {str(s["dataset_name"]) for s in screens}:
        raise ValueError("external expert lacks complete predictions")
    corpus = HistoricalRanker(PriorConfig(hierarchy="global")).fit(load_split("train"))
    predictions = {"external": external}
    for name in ("global", "phenotype"):
        corpus.config = PriorConfig(hierarchy=name)
        predictions[name] = predict(corpus, screens)
    rows = {name: evaluate_predictions(screens, p) for name, p in predictions.items()}
    if phase == "select":
        routes, evidence = choose_routes(rows)
        write("router_freeze.json", {"routes": routes, "evidence": evidence, "provenance": prov,
              "expert_file_sha256": external_hash, "input": "metadata only; no target library",
              "selection_split": "validation", "memorization_risk": "published LLMs may have trained on screen publications"})
        print("FROZEN ROUTES", json.dumps(evidence, indent=2), flush=True)
    else:
        routes = frozen["routes"]
    routed = {str(s["dataset_name"]): predictions[routes.get(str(s["cleaned_phenotype"]).lower(), "external")][str(s["dataset_name"])] for s in screens}
    write(f"router_{phase}_predictions.json", routed)
    routed_rows = evaluate_predictions(screens, routed)
    write(f"router_{phase}_screens.json", routed_rows)
    delta = [a["adjusted_ndcg@100"] - b["adjusted_ndcg@100"] for a, b in zip(routed_rows, rows["external"])]
    summary = {"provenance": prov, "split": split, "external_file_sha256": external_hash,
               "router": summarize(routed_rows), "experts": {name: summarize(r) for name, r in rows.items()},
               "paired_vs_external": cluster_interval(delta, [r["source_id"] for r in routed_rows])}
    write(f"router_{phase}_summary.json", summary)
    print(phase, summary["router"]["mean"], summary["paired_vs_external"], flush=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("phase", choices=("select", "replay"))
    main(p.parse_args().phase)
