"""Independently recompute every D/E number from the original per-screen files.

This does not import the experiment runners. It re-reads the saved screen
results, recomputes the means and the publication-cluster paired bootstrap from
scratch, and compares against the summaries those runners wrote.
"""
import json, hashlib, sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[4]
A = ROOT / "research/artifacts/20260928"


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def rows(p):
    return json.loads(Path(p).read_text())


def paired(a_rows, b_rows, seed, reps):
    """Paired difference with a publication-cluster bootstrap, resampling publications."""
    a = {r["dataset_name"]: r["adjusted_ndcg@100"] for r in a_rows}
    b = {r["dataset_name"]: r["adjusted_ndcg@100"] for r in b_rows}
    pub = {r["dataset_name"]: r["source_id"] for r in a_rows}
    assert set(a) == set(b), "cohorts differ"
    ids = sorted(a)
    diff = np.array([a[i] - b[i] for i in ids])
    groups = {}
    for i in ids:
        groups.setdefault(pub[i], []).append(ids.index(i))
    keys = sorted(groups)
    idx = [np.array(groups[k]) for k in keys]
    rng = np.random.default_rng(seed)
    draws = np.empty(reps)
    for t in range(reps):
        pick = rng.integers(0, len(keys), len(keys))
        sel = np.concatenate([idx[j] for j in pick])
        draws[t] = diff[sel].mean()
    return float(diff.mean()), float(np.percentile(draws, 2.5)), float(np.percentile(draws, 97.5))


def main():
    out = {"recomputed_from": "original per-screen JSON, not the runner summaries", "checks": []}
    dv = A / "model_development/validation"
    e2 = rows(dv / "E2_history_lambdarank_screens.json")
    ens = rows(dv / "published_ensemble_screens.json")
    m_e2 = float(np.mean([r["adjusted_ndcg@100"] for r in e2]))
    m_ens = float(np.mean([r["adjusted_ndcg@100"] for r in ens]))
    d_mean, d_lo, d_hi = paired(e2, ens, 20260928, 10000)
    out["experiment_D"] = {
        "selected": "E2_history_lambdarank",
        "validation_mean_recomputed": m_e2,
        "published_ensemble_mean_recomputed": m_ens,
        "paired_difference_recomputed": d_mean,
        "n_screens": len(e2),
        "n_publications": len({r["source_id"] for r in e2}),
        "interval_note": "independent bootstrap; cluster resampling order differs from the runner, so endpoints need not match to the last digit",
        "recomputed_ci95": [d_lo, d_hi],
        "sha256": {str(p.relative_to(ROOT)): sha(p) for p in sorted(dv.glob("*screens.json"))},
    }
    ev = A / "direction_development/validation"
    p0 = rows(ev / "P0_baseline_D3_screens.json")
    out["experiment_E"] = {
        "selected": "P0_baseline_D3",
        "validation_mean_recomputed": float(np.mean([r["adjusted_ndcg@100"] for r in p0])),
        "n_screens": len(p0),
        "n_publications": len({r["source_id"] for r in p0}),
        "sha256": {str(p.relative_to(ROOT)): sha(p) for p in sorted(ev.glob("*screens.json"))},
    }
    cv = json.loads((A / "direction_development/cv_selection.json").read_text())
    out["experiment_E"]["cv_paired_vs_baseline_as_recorded"] = {
        k: {"mean": v["mean"], "ci95": v["ci95"]} for k, v in cv["paired_vs_D3"].items()
    }
    out["experiment_E"]["cv_selected"] = cv["selected"]
    fz = json.loads((A / "model_development/final_freeze.json").read_text())
    out["experiment_D"]["paired_as_recorded"] = fz["validation_comparisons"]["E2_history_lambdarank"]
    out["experiment_D"]["promotion_status"] = fz["promotion_status"]
    out["experiment_D"]["selection_multiplicity"] = fz["selection_multiplicity"]

    def agree(a, b, tol=1e-9):
        return abs(a - b) <= tol

    out["checks"].append({"name": "D mean matches runner summary",
                          "ok": agree(m_e2, 0.180985, 1e-6)})
    out["checks"].append({"name": "D ensemble matches runner summary",
                          "ok": agree(m_ens, 0.186437, 1e-6)})
    out["checks"].append({"name": "D paired difference matches runner",
                          "ok": agree(d_mean, fz["validation_comparisons"]["E2_history_lambdarank"]["mean"], 1e-12)})
    out["checks"].append({"name": "E validation mean matches runner summary",
                          "ok": agree(out["experiment_E"]["validation_mean_recomputed"], 0.099450, 1e-6)})
    out["checks"].append({"name": "E cross-validation selected the baseline",
                          "ok": cv["selected"] == "P0_baseline_D3"})
    out["all_checks_pass"] = all(c["ok"] for c in out["checks"])
    print(json.dumps(out, indent=2))
    (A / "publication/verify_de.json").write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
    return 0 if out["all_checks_pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
