"""Local real-count smoke run for methods/provenance recording, not a benchmark.

Uses the already audited Millman study inputs. Writes new outputs; does not
rewrite the original study audit or persist to a database.
"""
import hashlib
import json
import time
from pathlib import Path

from splicr.pipeline import ScreenInput, run_pipeline


def main():
    root = Path(__file__).resolve().parents[2]
    inputs = root / "artifacts/millman-20261008/input"
    work = root / "data/research/lab-workspace-20261008/tools/control-normalization"
    evidence = root / "research/artifacts/20261008"
    evidence.mkdir(parents=True, exist_ok=True)
    counts = inputs / "counts.tsv"
    library = inputs / "study_library.tsv"
    spec = ScreenInput(
        name="Millman 2026 CRISPRa — local methods-record verification",
        count_table=counts, library_slug="millman_cellecta_kahgw106p", library_path=library,
        roles={"D0": "reference", "kidney": "treatment"}, treatment=["kidney"], control=["D0"],
        normalization="control", fdr_threshold=0.1, hit_callers=["mageck_rra"],
        cell_line="HUES8-VPR stem-cell-derived islets", model_type="in_vivo",
        phenotype="transplantation enrichment", modality="crispra",
        condition="day 10 kidney capsule vs differentiated day 0", fitness_assay=False,
    )
    start = time.perf_counter()
    result = run_pipeline(spec, work, persist=False, verbose=True)
    if not result.ok:
        raise RuntimeError(result.error)
    report = json.loads(result.report_path.read_text())
    stage = next(s for s in report["execution"]["stages"] if s["stage"] == "hits")
    metrics = stage["metrics"]
    controls = work / "normalization_controls.txt"
    assert metrics["methods"] == ["mageck_rra"]
    assert metrics["normalization"] == "control"
    assert metrics["mle_design"] is None and metrics["drugz_options"] is None
    assert metrics["normalization_controls"] == {
        "sha256": hashlib.sha256(controls.read_bytes()).hexdigest(),
        "n_guides": len(controls.read_text().splitlines()),
    }
    assert metrics["normalization_controls"]["n_guides"] == 3755
    summary = {
        "schema": "splicr.lab-methods-smoke.v1", "persisted": False,
        "scope": "Real-count local pipeline/metadata verification; not independent biological validation or superiority evidence.",
        "runtime_seconds": time.perf_counter() - start,
        "input_sha256": {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
                         for p in (counts, library)},
        "report_path": str(result.report_path.relative_to(root)),
        "report_sha256": hashlib.sha256(result.report_path.read_bytes()).hexdigest(),
        "engine_version": report["provenance"]["engine_version"],
        "analyzed_counts": report["provenance"]["analyzed_counts"],
        "n_guides": len(result.matrix.guide_ids), "n_genes": len(result.hits.genes),
        "qc_verdict": report["qc"]["verdict"], "hit_stage": stage,
    }
    (evidence / "lab-methods-smoke.json").write_text(json.dumps(summary, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"verified": True, "n_guides": summary["n_guides"],
                      "n_genes": summary["n_genes"], "runtime_seconds": summary["runtime_seconds"]}))


if __name__ == "__main__":
    main()
