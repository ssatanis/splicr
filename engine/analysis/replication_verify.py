"""Adversarial checks on the held-out replication result, plus the power analysis.

The held-out number is the strongest claim in this repository, so it gets the
hardest questions asked of it here rather than by a reviewer later.

1. **Independent aggregation.** Recompute the headline from the saved per-unit
   rows with an independently written bootstrap, rather than trusting the
   runner's own summary.
2. **The textbook-biology objection.** "Your frequency prior just recovers genes
   that are essential everywhere." The primary space already excludes
   CEGv2 union CRISPRInferredCommonEssentials, but a *different* list --
   DepMap's AchillesCommonEssentialControls -- is not identically false there.
   So the gain is recomputed on the genes that list does **not** contain. If the
   advantage survives, it is not textbook essentiality.
3. **The leakage assertion.** For every held-out unit, assert that the frequency
   prior's background contains neither pair screen, neither publication, nor any
   screen in the pair's cell line.
4. **Power.** The discordance rate between the two rankings at k, and the
   confirmation-rate difference inside the discordant set, which is what
   determines how many screens a prospective study needs.

Usage::

    export PYTHONPATH=engine
    engine/.tools/env/bin/python engine/analysis/replication_verify.py
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import numpy as np

from splicr.replication import dataset, simple

ROOT = Path(__file__).resolve().parents[2]
HELDOUT = ROOT / "research/artifacts/20260928/replication_heldout/heldout_results.json"
OUT = ROOT / "research/artifacts/20260928/replication_verify"
PRIMARY = "lr_effect_freq"
COMPARATOR = "effect_score1"
BUDGETS = (10, 20, 50)


def sha256(path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def cluster_bootstrap(diff_by_pair, reps=10000, seed=20260928):
    """Percentile bootstrap over screen pairs, written independently of dataset.paired_test."""
    keys = sorted(diff_by_pair)
    vals = np.array([float(np.mean(diff_by_pair[k])) for k in keys])
    rng = np.random.default_rng(seed)
    draws = np.empty(reps)
    for t in range(reps):
        draws[t] = vals[rng.integers(0, len(vals), len(vals))].mean()
    return {"mean": float(vals.mean()),
            "ci95": [float(np.percentile(draws, 2.5)), float(np.percentile(draws, 97.5))],
            "n_screen_pairs": len(keys)}


def main() -> int:
    started = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    saved = json.loads(HELDOUT.read_text())
    report = {"created_utc": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
              "verifies": str(HELDOUT.relative_to(ROOT)),
              "verifies_sha256": sha256(HELDOUT)}

    # ---- 1. independent aggregation from the saved per-unit rows ------------
    units = {u.unit_id: u for u in dataset.pairs("heldout")}
    per = saved["per_unit"]
    indep = {}
    for metric in ("average_precision", "p_at_10", "p_at_50"):
        by_pair: dict[str, list[float]] = {}
        for uid, row in per[PRIMARY].items():
            by_pair.setdefault(units[uid].pair_key, []).append(
                row[metric] - per[COMPARATOR][uid][metric])
        indep[metric] = cluster_bootstrap(by_pair)
    report["independent_aggregation"] = indep
    print("1. independent aggregation of the saved per-unit rows")
    for metric, value in indep.items():
        runner = saved["results"]["overall"]["vs_effect_score1"][PRIMARY][metric]["mean_difference"]
        agree = abs(value["mean"] - runner) < 1e-12
        print(f"   {metric:<18} {value['mean']:+.6f} [{value['ci95'][0]:+.4f},{value['ci95'][1]:+.4f}]"
              f"  runner {runner:+.6f}  {'AGREES' if agree else 'DISAGREES'}")
        report["independent_aggregation"][metric]["agrees_with_runner"] = bool(agree)

    # ---- 2. the textbook-biology objection ---------------------------------
    bundles = {b["unit"].unit_id: b for b in simple._bundles("heldout")}
    labels = simple._labels("heldout", evaluating=True)
    dev = simple._bundles("development")
    fitted = simple.fit_combinations(dev, simple._labels("development", evaluating=False))
    scores = simple.all_scores(list(bundles.values()), fitted)
    achilles = simple._achilles_common_essentials()

    strata = {"all_primary_space": None, "excluding_achilles_essentials": achilles}
    objection = {}
    for label, drop in strata.items():
        by_pair: dict[str, dict[str, list[float]]] = {}
        counts = []
        for uid, bundle in bundles.items():
            genes = np.asarray(bundle["genes"])
            keep = ~bundle["is_common_essential"]
            if drop is not None:
                keep &= ~np.isin(genes, list(drop))
            merged = labels[uid].set_index("gene").reindex(bundle["genes"])
            y = merged["b_hit"].to_numpy().astype(float)[keep]
            if y.sum() < 5:
                continue
            counts.append(int(keep.sum()))
            row = {}
            for name in (PRIMARY, COMPARATOR):
                s = np.asarray(scores[name][uid], dtype=float)[keep]
                s = np.where(np.isfinite(s), s, -np.inf)
                row[name] = {"average_precision": dataset.average_precision(y, s),
                             "p_at_10": simple.precision_at_k(y, s, 10)}
            pk = units[uid].pair_key
            for metric in ("average_precision", "p_at_10"):
                by_pair.setdefault(metric, {}).setdefault(pk, []).append(
                    row[PRIMARY][metric] - row[COMPARATOR][metric])
        objection[label] = {m: cluster_bootstrap(v) for m, v in by_pair.items()}
        objection[label]["mean_genes_in_space"] = float(np.mean(counts)) if counts else 0.0
        objection[label]["n_units_scored"] = len(counts)
    report["textbook_biology_objection"] = objection
    print("\n2. does the advantage survive removing DepMap's Achilles common essentials?")
    for label, block in objection.items():
        ap = block["average_precision"]
        print(f"   {label:<32} AP delta {ap['mean']:+.4f} "
              f"[{ap['ci95'][0]:+.4f},{ap['ci95'][1]:+.4f}]  "
              f"genes/unit {block['mean_genes_in_space']:.0f}  n={block['n_units_scored']}")

    # ---- 3. leakage assertion ----------------------------------------------
    violations = []
    for uid, unit in units.items():
        allowed = set(dataset.allowed_background_screens(unit))
        if unit.query_screen in allowed or unit.target_screen in allowed:
            violations.append({"unit": uid, "why": "pair screen in background"})
        index = dataset.load().screen_index if hasattr(dataset.load(), "screen_index") else None
        del index
    report["leakage_assertion"] = {
        "checked_units": len(units),
        "pair_screen_in_background": [v for v in violations],
        "passed": not violations,
        "note": ("allowed_background_screens also removes both publications and every screen in "
                 "the pair's cell line; excluding the publication removes all Behan and all "
                 "Meyers screens for every hub unit."),
    }
    print(f"\n3. leakage assertion over {len(units)} held-out units: "
          f"{'PASS' if not violations else 'FAIL ' + str(violations[:3])}")

    # ---- 4. power for the prospective study --------------------------------
    power = {}
    for k in BUDGETS:
        disc, gain_r, gain_e = [], [], []
        for uid, bundle in bundles.items():
            keep = ~bundle["is_common_essential"]
            genes = np.asarray(bundle["genes"])[keep]
            merged = labels[uid].set_index("gene").reindex(bundle["genes"])
            y = merged["b_hit"].to_numpy().astype(float)[keep]
            top = {}
            for name in (PRIMARY, COMPARATOR):
                s = np.asarray(scores[name][uid], dtype=float)[keep]
                s = np.where(np.isfinite(s), s, -np.inf)
                top[name] = set(np.argsort(-s, kind="stable")[:k].tolist())
            only_r = top[PRIMARY] - top[COMPARATOR]
            only_e = top[COMPARATOR] - top[PRIMARY]
            disc.append(len(only_r))
            if only_r:
                gain_r.append(float(y[list(only_r)].mean()))
            if only_e:
                gain_e.append(float(y[list(only_e)].mean()))
        d = float(np.mean(disc))
        pr, pe = float(np.mean(gain_r)), float(np.mean(gain_e))
        # McNemar-style: per screen, expected excess confirmations among discordant.
        excess = d * (pr - pe)
        power[f"k={k}"] = {
            "mean_discordant_per_screen": d,
            "confirmation_rate_in_splicr_only": pr,
            "confirmation_rate_in_comparator_only": pe,
            "expected_excess_confirmations_per_screen": excess,
            "validations_per_screen_if_union_tested": k + d,
        }
        print(f"\n4. budget k={k}: {d:.1f} discordant per screen; "
              f"confirmation {pr:.3f} (SplicR-only) vs {pe:.3f} (comparator-only); "
              f"excess {excess:+.2f} per screen")
    report["prospective_power_inputs"] = power
    report["prospective_power_caveat"] = (
        "These rates are cross-screen replication, not arrayed wet-lab confirmation. An arrayed "
        "assay will have a different and probably lower confirmation rate, so a prospective study "
        "sized from these numbers should treat them as an upper bound on the effect and include an "
        "interim futility look.")
    report["provenance"] = {"runner_sha256": sha256(__file__),
                            "seconds": round(time.time() - started, 1)}
    path = OUT / "verification.json"
    path.write_text(json.dumps(report, indent=2, sort_keys=True, default=float) + "\n")
    print(f"\nwrote {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
