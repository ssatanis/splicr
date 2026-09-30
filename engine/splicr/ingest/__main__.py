"""
Command line for the discovery, classification and design stages.

    python -m splicr.ingest discover --since 2026-09-01 [--until 2026-09-29] [--json] [--sources geo,sra,ena]
    python -m splicr.ingest classify GSE145743 [GSE...]
    python -m splicr.ingest runs GSE145743
    python -m splicr.ingest plan GSE145743 [PRJNA... ...]
    python -m splicr.ingest eval-classifier

`plan` prints the StudyPlan JSON exactly as it would be stored in
ingest.studies.plan. Nothing here writes to the database; that is runner.py's
job (see state.py).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

from . import classify as classify_mod
from . import discover as discover_mod
from . import design as design_mod
from . import metadata as metadata_mod
from .models import StudyCandidate

ARTIFACTS = Path(__file__).resolve().parents[3] / "research" / "artifacts" / "ingest"


def candidate_for(accession: str) -> StudyCandidate:
    """A classified candidate for one accession, from GEO when it is a GSE, else ENA."""
    acc = accession.strip().upper()
    if re.fullmatch(r"GSE\d+", acc):
        docs = discover_mod.gds_summaries([acc])
        if not docs:
            raise SystemExit(f"{acc}: not found in GEO")
        return classify_mod.classify(discover_mod.candidate_from_gds(docs[0]))
    if re.fullmatch(r"PRJ[EDN][A-Z]\d+|[SED]RP\d+", acc):
        field = "study_accession" if acc.startswith("PRJ") else "secondary_study_accession"
        rows = discover_mod._ena_search(f'{field}="{acc}"')
        if not rows:
            raise SystemExit(f"{acc}: not found in ENA")
        return classify_mod.classify(discover_mod.candidate_from_ena(rows[0]))
    raise SystemExit(f"{accession}: expected a GSE, PRJNA/PRJEB/PRJDB or SRP/ERP/DRP accession")


def _date(s: str) -> date:
    return date.fromisoformat(s)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m splicr.ingest")
    sub = ap.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("discover", help="search GEO/SRA/ENA and classify")
    d.add_argument("--since", type=_date, required=True)
    d.add_argument("--until", type=_date, default=None)
    d.add_argument("--sources", default="geo,sra,ena")
    d.add_argument("--json", action="store_true", help="one JSON object per line")
    d.add_argument("--all", action="store_true", help="include not_screen candidates in the table")

    c = sub.add_parser("classify", help="classify explicit accessions")
    c.add_argument("accessions", nargs="+")

    r = sub.add_parser("runs", help="run-level metadata (ENA + GEO) as JSON")
    r.add_argument("accession")

    p = sub.add_parser("plan", help="infer the study plan and print it as JSON")
    p.add_argument("accessions", nargs="+")

    sub.add_parser("eval-classifier", help="rerun the labelled classifier evaluation")

    a = ap.parse_args(argv)

    if a.cmd == "discover":
        cands = discover_mod.discover(a.since, a.until, sources=tuple(a.sources.split(",")))
        if a.json:
            for x in cands:
                print(x.to_json())
            return 0
        shown = [x for x in cands if a.all or x.verdict != "not_screen"]
        counts = {v: sum(1 for x in cands if x.verdict == v) for v in ("screen", "maybe", "not_screen")}
        print(f"{len(cands)} candidates ({counts['screen']} screen, {counts['maybe']} maybe, "
              f"{counts['not_screen']} not_screen)" + ("" if a.all else "; not_screen hidden, --all shows them"))
        for x in shown:
            print(f"{x.score:5.2f}  {x.verdict:<10} {x.accession:<13} {x.source:<4} "
                  f"{(x.organism or '?')[:14]:<14} {x.title[:90]}")
        return 0

    if a.cmd == "classify":
        for acc in a.accessions:
            x = candidate_for(acc)
            print(json.dumps({"accession": x.accession, "verdict": x.verdict, "score": x.score,
                              "reasons": x.reasons, "title": x.title}, indent=1))
        return 0

    if a.cmd == "runs":
        runs = metadata_mod.fetch_runs(candidate_for(a.accession))
        print(json.dumps([json.loads(x.to_json()) for x in runs], indent=1))
        return 0

    if a.cmd == "plan":
        for acc in a.accessions:
            cand = candidate_for(acc)
            plan = design_mod.plan_study(cand, metadata_mod.fetch_runs(cand))
            print(json.dumps(json.loads(plan.to_json()), indent=1))
        return 0

    if a.cmd == "eval-classifier":
        res = classify_mod.evaluate(str(ARTIFACTS / "labels.csv"), str(ARTIFACTS / "classifier_inputs.json.gz"))
        print(json.dumps({k: res[k] for k in ("n", "thresholds", "train", "test")}, indent=1))
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
