"""Score the frozen replication model on the held-out split. Runs once.

This is the only script in the repository that passes ``evaluating=True`` to
``dataset.load_pair_labels``. The held-out split had never been scored before
this run, so it is a genuine one-shot resource and everything it depends on was
fixed beforehand in
``research/artifacts/20260928/replication_selection/selection.json``:

* the model (``lr_effect_freq``: screen A's own effect size plus a
  frequent-hitter prior fitted only on ``allowed_background_screens``),
* why it, and not the higher-scoring ``lr_effect_freq_depmap``, carries the
  headline (that model's DepMap breadth feature is the Broad Avana experiment
  aggregated, and Avana/Meyers 2017 is the label side of 113 of 124 held-out
  pairs),
* the comparator (``effect_score1``, what a lab already has),
* the metrics, and
* the stratification into the Behan-2019 / Meyers-2017 block and the remainder.

The models are fitted on **all** development units, with development labels, and
then applied unchanged. Nothing is refit, tuned or re-selected here.

Usage::

    export PYTHONPATH=engine
    engine/.tools/env/bin/python engine/analysis/replication_heldout.py
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import numpy as np

from splicr.replication import dataset, simple

ROOT = Path(__file__).resolve().parents[2]
SELECTION = ROOT / "research/artifacts/20260928/replication_selection/selection.json"
OUT = ROOT / "research/artifacts/20260928/replication_heldout"

HUB = {"29083409", "30971826"}  # Meyers 2017 (Broad, Avana) and Behan 2019 (Sanger, KY)
REPORT = ("lr_effect_freq", "lr_effect_freq_depmap", "effect_score1", "a_hit",
          "freq_shrunk", "depmap_breadth", "marginal_rate")
METRICS = ("average_precision", "p_at_10", "p_at_20", "p_at_50", "auc")


def sha256(path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def stratum(unit) -> str:
    return "hub" if {str(unit.query_publication), str(unit.target_publication)} == HUB else "rest"


def summarise(per_unit, uids, comparator="effect_score1"):
    block = {"n_units": len(uids),
             "n_screen_pairs": len({per_unit[comparator][u]["pair_key"] for u in uids}),
             "summary": {}, "vs_effect_score1": {}}
    for name, rows in per_unit.items():
        block["summary"][name] = {m: float(np.nanmean([rows[u][m] for u in uids])) for m in METRICS}
    ref = {u: per_unit[comparator][u] for u in uids}
    for name, rows in per_unit.items():
        if name == comparator:
            continue
        block["vs_effect_score1"][name] = {
            m: dataset.paired_test({u: rows[u][m] for u in uids},
                                   {u: ref[u][m] for u in uids})
            for m in ("average_precision", "p_at_10", "p_at_50")}
    return block


def main() -> int:
    started = time.time()
    frozen = json.loads(SELECTION.read_text())
    primary = frozen["amendment"]["primary_model"]
    secondary = frozen["amendment"]["secondary_model"]
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"frozen primary   = {primary} {frozen['all_out_of_fold'][primary]['average_precision']:.4f} (out of fold)")
    print(f"frozen secondary = {secondary}")
    print(f"comparator       = {frozen['comparator']}\n")

    dev_bundles = simple._bundles("development")
    dev_labels = simple._labels("development", evaluating=False)
    fitted = simple.fit_combinations(dev_bundles, dev_labels)
    print(f"fitted on {len(dev_bundles)} development units, "
          f"{fitted[primary]['n_rows']} gene rows\n", flush=True)

    bundles = simple._bundles("heldout")
    labels = simple._labels("heldout", evaluating=True)   # the one sanctioned read
    scores = simple.all_scores(bundles, fitted)
    per_unit = {}
    for name in REPORT:
        if name == "marginal_rate":
            continue
        per_unit[name] = {
            b["unit"].unit_id: simple.score_unit(b, scores[name][b["unit"].unit_id],
                                                 labels[b["unit"].unit_id], dataset.PRIMARY_SPACE)
            for b in bundles}
    per_unit["marginal_rate"] = {}
    for b in bundles:
        row = simple.score_unit(b, np.zeros(len(b["genes"])), labels[b["unit"].unit_id],
                                dataset.PRIMARY_SPACE)
        row["average_precision"] = row["marginal"]
        row["auc"] = 0.5
        for k in simple.PRECISION_K:
            row[f"p_at_{k}"] = row["marginal"]
        per_unit["marginal_rate"][b["unit"].unit_id] = row

    strata = {"overall": [b["unit"].unit_id for b in bundles],
              "hub": [b["unit"].unit_id for b in bundles if stratum(b["unit"]) == "hub"],
              "rest": [b["unit"].unit_id for b in bundles if stratum(b["unit"]) == "rest"]}
    result = {name: summarise(per_unit, uids) for name, uids in strata.items() if uids}

    for name, block in result.items():
        print(f"=== {name}: {block['n_units']} units, {block['n_screen_pairs']} screen pairs")
        order = sorted(block["summary"].items(), key=lambda kv: -kv[1]["average_precision"])
        for method, value in order:
            t = block["vs_effect_score1"].get(method, {}).get("average_precision")
            tail = "" if not t else (f"  {t['mean_difference']:+.4f} "
                                     f"[{t['ci95'][0]:+.4f},{t['ci95'][1]:+.4f}]"
                                     f"{'*' if t.get('significant') else ''}")
            print(f"  {method:<24} AP {value['average_precision']:.4f}  "
                  f"P@10 {value['p_at_10']:.3f}  P@50 {value['p_at_50']:.3f}{tail}")
        print()

    doc = {
        "created_utc": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
        "split": "heldout",
        "space": dataset.PRIMARY_SPACE,
        "scored_once": True,
        "frozen_selection": str(SELECTION.relative_to(ROOT)),
        "frozen_selection_sha256": sha256(SELECTION),
        "primary_model": primary,
        "secondary_model": secondary,
        "comparator": frozen["comparator"],
        "results": result,
        "per_unit": {n: {u: {m: r[m] for m in METRICS} for u, r in rows.items()}
                     for n, rows in per_unit.items()},
        "promotion_status": "research_only",
        "interpretation": (
            "Cross-screen replication is a proxy for reproducibility, not proof that a gene passes "
            "an independent biological validation assay. B's hit call depends on B's significance "
            "criteria. The held-out block is dominated by one library comparison, which is why the "
            "hub and rest strata are reported separately."),
        "provenance": {
            "runner_sha256": sha256(__file__),
            "simple_sha256": sha256(ROOT / "engine/splicr/replication/simple.py"),
            "dataset_sha256": sha256(ROOT / "engine/splicr/replication/dataset.py"),
            "pairs_artifact_sha256": sha256(ROOT / "engine/splicr/replication/_pairs_v1.json"),
            "seconds": round(time.time() - started, 1)},
    }
    path = OUT / "heldout_results.json"
    path.write_text(json.dumps(doc, indent=2, sort_keys=True, default=float) + "\n")
    print(f"wrote {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
