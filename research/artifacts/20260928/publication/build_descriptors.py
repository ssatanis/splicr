"""Build registration descriptors for experiments D and E.

The shapes here are dictated by ``scripts/research/evidence_gate.mjs``
(``validateExperiment``): a declared cohort, a summary whose mean recomputes
from the per-screen rows, predictions covering exactly that cohort, and
provenance pinned to the same dataset and evaluator hashes as the approved
snapshot. Nothing is invented; every value is read from the experiment's own
outputs or recomputed from its per-screen results.
"""
import json, hashlib
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[4]
A = ROOT / "research/artifacts/20260928"
PUB = A / "publication"
GIT = "25e0feec0b226158b732b3a662383a8f62529c0c"


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def rel(p):
    return str(Path(p).resolve().relative_to(ROOT))


def cluster_ci(rows, seed=20260928, reps=10000):
    """Publication-cluster bootstrap interval for a single method's own mean."""
    vals = np.array([r["adjusted_ndcg@100"] for r in rows])
    pubs = [r["source_id"] for r in rows]
    groups = {}
    for i, p in enumerate(pubs):
        groups.setdefault(p, []).append(i)
    keys = sorted(groups)
    idx = [np.array(groups[k]) for k in keys]
    rng = np.random.default_rng(seed)
    draws = np.empty(reps)
    for t in range(reps):
        pick = rng.integers(0, len(keys), len(keys))
        draws[t] = vals[np.concatenate([idx[j] for j in pick])].mean()
    return float(vals.mean()), [float(np.percentile(draws, 2.5)), float(np.percentile(draws, 97.5))], len(keys)


def write(obj, path):
    Path(path).write_text(json.dumps(obj, indent=2, sort_keys=True) + "\n")
    return path


def build(tag, screens, preds, model_code, notes, config):
    rows = json.loads(Path(screens).read_text())
    mean, ci, npub = cluster_ci(rows)
    summary = {"mean": mean, "ci95": ci, "n_screens": len(rows), "n_publications": npub,
               "unit": "publication", "seed": 20260928, "repeats": 10000,
               "recomputed_from": rel(screens)}
    spath = write(summary, PUB / f"experiment_{tag}_summary.json")
    cohort = {"n_screens": len(rows), "n_publications": npub,
              "dataset_sha256": "25e00c380358486137d1f25c490db98d007dfc5230f8ad502276dc6ccc741a5c",
              "metric_sha256": "d1b638c9aa3ee1cbd984028595b7af009f00736d203fa9cc10405732d182fbae",
              "assaybench_version": "0.2.0"}
    artifacts = {rel(p): sha(p) for p in [screens, preds, spath]}
    desc = {
        "schema_version": 1,
        "experiment_id": f"20260928_experiment_{tag}",
        "task": "pre_screen_prediction",
        "input_contract": "metadata_only",
        "evaluation_kind": "validation_selection",
        "split": "validation_2021",
        "promotion_status": "research_only",
        "calibration_status": "not_fitted",
        "validation_probability": None,
        "cohort": cohort,
        "summary": rel(spath),
        "screen_results": rel(screens),
        "predictions": rel(preds),
        "artifacts": artifacts,
        "configuration": config,
        "notes": notes,
        "provenance": {"assaybench_version": "0.2.0",
                       "data_sha256": cohort["dataset_sha256"],
                       "metric_sha256": cohort["metric_sha256"],
                       "model_code_sha256": sha(ROOT / model_code),
                       "git_revision": GIT,
                       "model_code": model_code,
                       "seed": 20260928,
                       "public_test_accessed": False,
                       "modern_model_memorization_risk": tag == "D"},
    }
    return write(desc, PUB / f"experiment_{tag}_descriptor.json")


d = build("D",
          A / "model_development/validation/E2_history_lambdarank_screens.json",
          A / "model_development/validation/E2_history_lambdarank_predictions.json",
          "engine/splicr/context_ranking.py",
          "Gene-level LambdaRank over 57 features, selected by publication-grouped "
          "cross-validation on the 1349 training screens; scored once on the 2021 "
          "validation split. Paired against the published ensemble on the same 218 "
          "screens: -0.005452 [-0.016147, +0.010805]. No superiority established.",
          {"kind": "ranker", "objective": "lambdarank", "history": True, "n_features": 57,
           "selection_multiplicity": 14})
e = build("E",
          A / "direction_development/validation/P0_baseline_D3_screens.json",
          A / "direction_development/validation/P0_baseline_D3_predictions.json",
          "engine/splicr/direction_ranking.py",
          "Requested-effect polarity conditioning. Cross-validation selected the "
          "unconditioned baseline P0_baseline_D3; the polarity prior scored "
          "-0.007931 [-0.023172, +0.004531] against it. The parser separates all 47 "
          "metadata-matched increase/decrease comparisons, which is a representation "
          "improvement, not an established ranking improvement.",
          {"kind": "prior", "conditional": True, "signed": True, "strength": 10.0,
           "exposure_power": 0.5, "requested_effect_prior": False})
print(rel(d)); print(rel(e))
