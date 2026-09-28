"""Offline pre-screen prediction from real historical records and metadata.

python -m splicr.predict --training historical_screens.json --context experiment.json \
    --output prediction.json [--router router_freeze.json --external expert.json]

No credentials, database writes, target labels, or model API calls are needed.
External expert JSON must contain genes and a nonempty provenance object.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import time

import numpy as np

from .evidence_router import EvidenceRouter
from .prescreen import FIELDS, HistoricalRanker, PriorConfig, ScreenContext
from .research_protocol import freeze_predictions, sha256_file


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--training", required=True, type=Path)
    parser.add_argument("--context", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--router", type=Path, help="frozen route JSON from development evaluation")
    parser.add_argument("--external", type=Path, help="independently generated expert genes and provenance")
    parser.add_argument("--receipt", type=Path, help="exclusive-create prospective prediction commitment")
    args = parser.parse_args(argv)
    context_record = json.loads(args.context.read_text())
    if (not isinstance(context_record, dict)
            or set(context_record) - (set(FIELDS) | {"dataset_name", "source_id"})
            or any(not isinstance(value, (str, int, float, type(None))) for value in context_record.values())
            or any(isinstance(value, (int, float)) and not np.isfinite(value) for value in context_record.values())):
        parser.error("context must contain only pre-experimental fields, dataset_name and source_id")
    context = ScreenContext.from_record(context_record)
    training = json.loads(args.training.read_text())
    if not isinstance(training, list):
        parser.error("training file must contain a list of historical screen records")
    start = time.perf_counter()
    route = "phenotype"
    external = None
    external_provenance = None
    if args.router:
        routes = json.loads(args.router.read_text())["routes"]
        route = routes.get(context.get("cleaned_phenotype"), "external")
        if route not in {"global", "phenotype", "external"}:
            parser.error("unsupported frozen expert")
    elif args.external:
        parser.error("external expert requires a frozen router")
    if route == "external":
        if not args.external:
            parser.error("selected route requires an independently generated external ranking")
        expert = json.loads(args.external.read_text())
        external, external_provenance = expert.get("genes"), expert.get("provenance")
        if not isinstance(external_provenance, dict) or not external_provenance:
            parser.error("external expert must include traceable provenance")
    config = PriorConfig(hierarchy=route if route != "external" else "phenotype")
    model = HistoricalRanker(config).fit(training)
    if args.router:
        # Bind only the selected expert, with the exact fitted configuration.
        router = EvidenceRouter({context.get("cleaned_phenotype"): route},
                                {route: model} if route != "external" else {})
        ranking = router.rank(context, external=external)
    else:
        ranking = model.rank(context)
    values = model.scores(context) if route != "external" else None
    lookup = {gene: i for i, gene in enumerate(model.genes)}
    permitted = model.publications != context.source_id if context.source_id else np.ones(len(training), bool)
    details = []
    for rank, gene in enumerate(ranking, 1):
        row = {"rank": rank, "gene": gene, "evidence_type": "historical ranking" if values is not None else "external prediction",
               "ranking_score": float(values[lookup[gene]]) if values is not None else None,
               "validation_probability": None}
        if gene in lookup:
            column = lookup[gene]
            measured = np.asarray(model.measured[:, column].toarray()).ravel().astype(bool) & permitted
            row.update({"historical_measured_screens": int(measured.sum()),
                        "historical_measured_publications": len(set(model.publications[measured])),
                        "historical_positive_screens": int(model.positive[permitted, column].sum()),
                        "historical_opposite_screens": int(model.negative[permitted, column].sum())})
        details.append(row)
    manifest = {**model.specification(), "expert": route,
                "training_sha256": sha256_file(args.training), "context_sha256": sha256_file(args.context),
                "model_code_sha256": sha256_file(Path(__file__).with_name("prescreen.py")),
                "external_provenance": external_provenance,
                "router_sha256": sha256_file(args.router) if args.router else None,
                "external_sha256": sha256_file(args.external) if args.external else None}
    output = {"task": "pre_screen_prediction", "input_contract": "metadata only",
              "model": manifest, "context": dict(context.values), "ranked_genes": details,
              "inference_seconds": time.perf_counter() - start,
              "limitations": ["Ranking evidence is not a calibrated probability of validation.",
                              "No independent prospective performance established.",
                              "Historical support counts describe all permitted training screens; ranking may condition on phenotype."]}
    with args.output.open("x") as stream:
        json.dump(output, stream, indent=2, allow_nan=False)
    if args.receipt:
        name = str(context_record.get("dataset_name") or "new_experiment")
        digest = freeze_predictions(args.receipt, predictions={name: ranking},
                                    model_manifest=manifest, contexts={name: context_record},
                                    training_publications=model.publications.tolist())
        print(f"Prediction receipt SHA256: {digest}; retain with an independent custodian.")
    print(f"Wrote {len(ranking)} predictions to {args.output}; expert={route}; validation probability unavailable.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
