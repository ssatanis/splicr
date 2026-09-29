"""Select one replication-reliability model, using development data only.

Why this script exists
----------------------
``splicr.replication.simple`` fits its logistic combinations on the development
labels and then, when asked for development results, scores them on the same
labels. Those numbers are in-sample: ``lr_effect_freq_depmap`` reads 0.3580
against effect size's 0.2517 on development, and essentially all of that gap
could be fit. Choosing the model a held-out evaluation will see on the basis of
an in-sample number would waste the one-shot held-out set.

So the choice is made here by **leave-one-publication-out cross-validation inside
development**. For each development publication the combinations are refit on the
units whose two screens both come from other publications, then scored on the
units that publication participates in. Nothing in this file opens a held-out
label: ``dataset.load_pair_labels`` refuses held-out units unless a caller passes
``evaluating=True``, and this module never passes it.

What is frozen here
-------------------
The output ``selection.json`` records, before any held-out label is read:

* the model selected, and the honest out-of-fold estimate that selected it,
* the primary metric (mean average precision over the non-common-essential
  space, paired-tested by screen pair) and the secondary decision metrics
  (precision at 10, 20, 50),
* the comparator (``effect_score1``, screen A's own effect size, which is the
  published margin to beat),
* the pre-declared stratification of the held-out set into the Behan-2019 /
  Meyers-2017 block and the remainder, because the benchmark's documentation
  names that concentration as its single biggest weakness and a result that
  holds only on the block must be reported that way,
* source hashes for the runner, the benchmark artifact and the baselines module.

Usage::

    export PYTHONPATH=engine
    engine/.tools/env/bin/python engine/analysis/replication_selection.py
"""
from __future__ import annotations

import collections
import hashlib
import json
import time
from pathlib import Path

import numpy as np

from splicr.replication import dataset, simple

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "research/artifacts/20260928/replication_selection"

#: The comparator. Screen A's own effect size is what a lab already has without
#: SplicR, so it is the only honest thing to beat.
COMPARATOR = "effect_score1"
#: Primary and secondary metrics, fixed here and not re-chosen later.
PRIMARY_METRIC = "average_precision"
SECONDARY_METRICS = ("p_at_10", "p_at_20", "p_at_50")


def sha256(path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def publications(unit) -> set[str]:
    return {str(unit.query_publication), str(unit.target_publication)}


def lopo_folds(units):
    """One fold per development publication.

    A unit is *evaluated* in the fold of a publication it participates in, and is
    available for *fitting* only in folds where neither of its publications is
    the held-out one. A unit with two publications is therefore evaluated twice;
    its scores are averaged so no unit is counted more than once overall.
    """
    pubs = sorted({p for u in units for p in publications(u)})
    for held in pubs:
        evaluate = [u for u in units if held in publications(u)]
        fit = [u for u in units if held not in publications(u)]
        if evaluate and fit:
            yield held, fit, evaluate


def score_everything(bundles, fitted, labels, space=dataset.PRIMARY_SPACE):
    scores = simple.all_scores(bundles, fitted)
    out = {}
    for name, by_unit in scores.items():
        out[name] = {
            b["unit"].unit_id: simple.score_unit(b, by_unit[b["unit"].unit_id],
                                                 labels[b["unit"].unit_id], space)
            for b in bundles
        }
    return out


def main() -> int:
    started = time.time()
    OUT.mkdir(parents=True, exist_ok=True)

    dev_units = list(dataset.pairs("development"))
    bundles = {b["unit"].unit_id: b for b in simple._bundles("development")}
    labels = simple._labels("development", evaluating=False)
    print(f"development: {len(dev_units)} units, "
          f"{len({u.pair_key for u in dev_units})} screen pairs, "
          f"{len({p for u in dev_units for p in publications(u)})} publications", flush=True)

    # Out-of-fold scores, accumulated per unit then averaged over the folds a
    # unit appears in.
    acc: dict[str, dict[str, list[dict]]] = collections.defaultdict(lambda: collections.defaultdict(list))
    fold_report = []
    for held, fit_units, eval_units in lopo_folds(dev_units):
        fit_bundles = [bundles[u.unit_id] for u in fit_units]
        eval_bundles = [bundles[u.unit_id] for u in eval_units]
        fitted = simple.fit_combinations(fit_bundles, labels)
        rows = score_everything(eval_bundles, fitted, labels)
        for name, by_unit in rows.items():
            for uid, row in by_unit.items():
                acc[name][uid].append(row)
        fold_report.append({"held_out_publication": held,
                            "n_fit_units": len(fit_units), "n_eval_units": len(eval_units)})
        print(f"  fold pub={held:<10} fit={len(fit_units):>3} eval={len(eval_units):>3}", flush=True)

    # Average the folds a unit appeared in, then summarise per method.
    per_unit: dict[str, dict[str, dict]] = {}
    for name, by_unit in acc.items():
        per_unit[name] = {}
        for uid, rows in by_unit.items():
            merged = {"pair_key": rows[0]["pair_key"]}
            for metric in (PRIMARY_METRIC, "auc", *SECONDARY_METRICS, "marginal"):
                vals = [r[metric] for r in rows if metric in r]
                merged[metric] = float(np.nanmean(vals)) if vals else float("nan")
            per_unit[name][uid] = merged

    summary = {}
    for name, rows in per_unit.items():
        vals = list(rows.values())
        summary[name] = {m: float(np.nanmean([v[m] for v in vals]))
                         for m in (PRIMARY_METRIC, "auc", *SECONDARY_METRICS)}
        summary[name]["n_units"] = len(vals)

    tests = {}
    ref = per_unit[COMPARATOR]
    for name, rows in per_unit.items():
        if name == COMPARATOR:
            continue
        tests[name] = {m: dataset.paired_test({u: r[m] for u, r in rows.items()},
                                              {u: r[m] for u, r in ref.items()})
                       for m in (PRIMARY_METRIC, *SECONDARY_METRICS)}

    # The selection rule, stated before the numbers were produced: among the
    # fitted combinations only, take the highest out-of-fold primary metric.
    # Single features are not eligible -- they need no fitting, so selecting one
    # here would just be reporting the best baseline as if it were a method.
    eligible = [n for n in summary if n in simple.COMBOS]
    selected = max(eligible, key=lambda n: summary[n][PRIMARY_METRIC])

    order = sorted(summary.items(), key=lambda kv: -kv[1][PRIMARY_METRIC])
    print(f"\n{'method':<30}{'AP(oof)':>9}{'P@10':>7}{'P@50':>7}   vs {COMPARATOR}")
    for name, value in order:
        t = tests.get(name, {}).get(PRIMARY_METRIC)
        tail = "" if not t else (f"  {t['mean_difference']:+.4f} "
                                 f"[{t['ci95'][0]:+.4f},{t['ci95'][1]:+.4f}]"
                                 f"{'*' if t.get('significant') else ''}")
        mark = " <= SELECTED" if name == selected else ""
        print(f"{name:<30}{value[PRIMARY_METRIC]:>9.4f}{value['p_at_10']:>7.3f}"
              f"{value['p_at_50']:>7.3f}{tail}{mark}")

    frozen = {
        "created_utc": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
        "purpose": "select one replication-reliability model using development data only",
        "selection_rule": "highest leave-one-publication-out mean average precision among "
                          "the fitted combinations in simple.COMBOS; single features ineligible",
        "selected": selected,
        "selected_features": simple.COMBOS[selected],
        "out_of_fold_estimate": summary[selected],
        "comparator": COMPARATOR,
        "comparator_out_of_fold": summary[COMPARATOR],
        "primary_metric": PRIMARY_METRIC,
        "secondary_metrics": list(SECONDARY_METRICS),
        "space": dataset.PRIMARY_SPACE,
        "paired_test": "percentile bootstrap resampled by screen pair, plus Wilcoxon; "
                       "a difference whose CI crosses zero is not an improvement",
        "heldout_stratification_declared_in_advance": {
            "hub": "pairs whose two publications are Behan 2019 and Meyers 2017",
            "rest": "every other held-out pair",
            "reason": "docs/07-replication-benchmark.md records that 113 of 124 held-out pairs "
                      "are that one comparison, so the effective n for cross-library "
                      "generalisation is near 1 and a result must be reported both ways"},
        "heldout_labels_read_by_this_script": False,
        "folds": fold_report,
        "all_out_of_fold": summary,
        "paired_tests_vs_comparator": tests,
        "provenance": {
            "runner_sha256": sha256(__file__),
            "simple_sha256": sha256(ROOT / "engine/splicr/replication/simple.py"),
            "dataset_sha256": sha256(ROOT / "engine/splicr/replication/dataset.py"),
            "pairs_artifact_sha256": sha256(ROOT / "engine/splicr/replication/_pairs_v1.json"),
            "seconds": round(time.time() - started, 1)},
    }
    path = OUT / "selection.json"
    path.write_text(json.dumps(frozen, indent=2, sort_keys=True, default=float) + "\n")
    print(f"\nSELECTED {selected} ({', '.join(simple.COMBOS[selected])})")
    print(f"  out-of-fold AP {summary[selected][PRIMARY_METRIC]:.4f} "
          f"vs {COMPARATOR} {summary[COMPARATOR][PRIMARY_METRIC]:.4f}")
    print(f"wrote {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
