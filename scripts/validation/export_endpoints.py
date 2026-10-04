"""
Export the endpoint registry and a decision matrix from the engine.

    engine/.tools/env/bin/python scripts/validation/export_endpoints.py
    engine/.tools/env/bin/python scripts/validation/export_endpoints.py --check

WHY THIS EXISTS

The console has to score a recorded measurement against an endpoint, because it
shows the reader which criterion carried the decision while they are still
looking at the form. That means the decision rule exists in Python and in
TypeScript, and two copies of a rule is how a console comes to disagree with the
engine about whether an experiment validated.

So the rule's *inputs* are generated, not retyped: `endpoints.generated.json`
holds every endpoint exactly as the registry defines it, with its hash. And the
rule's *behaviour* is pinned by `endpoint-decisions.json`, a matrix of
measurements with the engine's own verdict on each one, which
`apps/web/tests/endpoint-decisions.test.mjs` replays against the TypeScript. A
divergence is a failing test naming the case, not a wrong number on a screen.

`--check` regenerates in memory and compares, so CI fails when somebody edits
the registry without regenerating. It is the same shape as the evidence gate's
`--check-public`.
"""

from __future__ import annotations

import argparse
import json
import sys
from itertools import product
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))

from splicr.validation import endpoints as E  # noqa: E402

REGISTRY_OUT = ROOT / "apps/web/src/lib/validation/endpoints.generated.json"
MATRIX_OUT = ROOT / "apps/web/tests/fixtures/endpoint-decisions.json"
CANONICAL_OUT = ROOT / "apps/web/tests/fixtures/canonical-bytes.json"
ARMS_OUT = ROOT / "apps/web/tests/fixtures/arm-comparison.json"

#: Payloads whose canonical serialisation the console must reproduce byte for
#: byte. A receipt frozen in the browser and verified by the engine is one hash
#: or it is nothing, so the two serialisers are pinned against each other on
#: the shapes that actually differ between them: unicode, escapes, floats that
#: round-trip, nested empties, and key order.
CANONICAL_CASES = [
    {},
    {"a": 1},
    {"b": 1, "a": 2, "c": {"z": 1, "y": 2}},
    {"unicode": "CDK2 \u2014 PRKDC \u00b5M \u03b2-catenin"},
    {"escapes": "line\nbreak\ttab \"quoted\" back\\slash"},
    {"solidus": "10.1158/0008-5472.CAN-24-0775"},
    {"floats": [0.1, 1.0, -1.5, 1e-9, 1234567.891, 0.0]},
    {"ints": [0, -1, 2147483647, 9007199254740991]},
    {"empties": {"list": [], "object": {}, "null": None, "false": False}},
    {"nested": [{"b": [1, {"a": None}]}, []]},
    {"mixed": {"10": "numeric key", "2": "sorts as text", "a": 1}},
]

#: The axes of the decision matrix. Every combination is scored, so the
#: TypeScript has to agree with the engine on every path through `decide`,
#: including the ones no form would produce today.
AXES = {
    "result": ["validated", "failed", "inconclusive", "pending"],
    "independent_perturbation": [True, False, None],
    "distinct_from_screen_constructs": [True, False, None],
    "n_perturbations": [None, 1, 2],
    "n_replicates": [None, 1, 3],
    "effect_size": [None, -1.4, -0.05, 1.4, 0.0],
    "laboratory_threshold": [None, 0.5],
    "controls_pass": [True, False, None],
}

#: Which endpoints to score the matrix against. One per question plus the two
#: with unusual rules: the rescue endpoint validates in the enriched direction,
#: and the catch-all accepts either.
MATRIX_ENDPOINTS = [
    "ko_fitness_independent_guide.v1",
    "ko_fitness_independent_guide_set.v1",
    "orthogonal_crispri.v1",
    "rescue_complementation.v1",
    "pharmacologic_inhibition.v1",
    "cross_model_reproduction.v1",
    "organoid_growth_arrayed.v1",
    "orthogonal_genetic_other.v1",
]


def registry_payload() -> dict:
    return {
        "schema": "splicr.endpoint-registry-export.v1",
        "generated_by": "scripts/validation/export_endpoints.py",
        "registry_sha256": E.registry_hash(),
        "questions": list(E.QUESTIONS),
        "question_label": dict(E.QUESTION_LABEL),
        "question_sentence": dict(E.QUESTION_SENTENCE),
        "validation_types": list(E.VALIDATION_TYPES),
        "validation_type_label": dict(E.VALIDATION_TYPE_LABEL),
        "type_question": dict(E.TYPE_QUESTION),
        "default_endpoint": {
            kind: (default.key if (default := E.default_endpoint(kind)) else None)
            for kind in E.VALIDATION_TYPES
        },
        "endpoints": {
            key: {**E.REGISTRY[key].canonical(), "key": key,
                  "definition_sha256": E.REGISTRY[key].hash()}
            for key in sorted(E.REGISTRY)
        },
    }


#: The full cartesian product is 77,760 cases and 59 MB of JSON, which is not a
#: fixture, it is a liability. It is sampled down to this many, stratified so
#: that every (endpoint, decision) pair the product can produce survives and
#: every individual axis value appears at least MIN_PER_VALUE times. The sample
#: is deterministic, so regenerating produces the same file and `--check` means
#: something.
MAX_CASES = 1800
MIN_PER_VALUE = 12
#: Per (endpoint, decision) stratum. 'validated' is the rarest verdict by
#: construction - it needs every criterion to pass at once - so a sample that
#: keeps one of each would test the happy path about as often as it occurs by
#: accident, which is not often enough.
MIN_PER_STRATUM = 10
SAMPLE_SEED = 20261003


def _stratify(cases: list[dict], keys: list[str]) -> list[dict]:
    """
    Keep a small sample that still covers every behaviour the product contains.

    Three passes, each additive:
      1. up to MIN_PER_STRATUM cases per (endpoint, decision), so no verdict is
         dropped and the rare ones are not down to a single example
      2. MIN_PER_VALUE cases per (axis, value), so no input path is untested
      3. a deterministic fill up to MAX_CASES
    """
    import random

    rng = random.Random(SAMPLE_SEED)
    order = sorted(range(len(cases)),
                   key=lambda i: (cases[i]["endpoint"],
                                  cases[i]["expect"]["decision"],
                                  json.dumps(cases[i]["measurement"], sort_keys=True)))
    kept: set[int] = set()

    by_stratum: dict[tuple, list[int]] = {}
    for i in order:
        stratum = (cases[i]["endpoint"], cases[i]["expect"]["decision"])
        by_stratum.setdefault(stratum, []).append(i)
    for stratum in sorted(by_stratum):
        for i in by_stratum[stratum][:MIN_PER_STRATUM]:
            kept.add(i)

    def value_of(case: dict, key: str):
        if key == "laboratory_threshold":
            return case["laboratory_threshold"]
        if key == "controls_pass":
            controls = case["measurement"].get("controls")
            if controls is None:
                return None
            return all(controls.values()) if controls else True
        return case["measurement"].get(key)

    for key in keys:
        for wanted in AXES[key]:
            have = sum(1 for i in kept if value_of(cases[i], key) == wanted)
            if have >= MIN_PER_VALUE:
                continue
            for i in order:
                if have >= MIN_PER_VALUE:
                    break
                if i in kept or value_of(cases[i], key) != wanted:
                    continue
                kept.add(i)
                have += 1

    remaining = [i for i in order if i not in kept]
    rng.shuffle(remaining)
    for i in remaining[: max(0, MAX_CASES - len(kept))]:
        kept.add(i)
    return [cases[i] for i in sorted(kept)]


def matrix_payload() -> dict:
    cases: list[dict] = []
    keys = list(AXES)
    for key in MATRIX_ENDPOINTS:
        endpoint = E.REGISTRY[key]
        for combination in product(*(AXES[k] for k in keys)):
            values = dict(zip(keys, combination))
            controls = (
                None if values["controls_pass"] is None
                else {name: bool(values["controls_pass"])
                      for name in endpoint.control_criteria}
            )
            measurement = {
                "result": values["result"],
                "independent_perturbation": values["independent_perturbation"],
                "distinct_from_screen_constructs":
                    values["distinct_from_screen_constructs"],
                "n_perturbations": values["n_perturbations"],
                "n_replicates": values["n_replicates"],
                "effect_size": values["effect_size"],
            }
            if controls is not None:
                measurement["controls"] = controls
            decision = endpoint.decide(
                measurement, laboratory_threshold=values["laboratory_threshold"])
            cases.append({
                "endpoint": key,
                "laboratory_threshold": values["laboratory_threshold"],
                "measurement": measurement,
                "expect": {
                    "decision": decision.decision,
                    "criteria": [
                        {"name": c.name, "status": c.status} for c in decision.criteria
                    ],
                },
            })
    total = len(cases)
    sampled = _stratify(cases, keys)
    decisions: dict[str, int] = {}
    for case in sampled:
        verdict = case["expect"]["decision"]
        decisions[verdict] = decisions.get(verdict, 0) + 1
    return {
        "schema": "splicr.endpoint-decision-matrix.v1",
        "generated_by": "scripts/validation/export_endpoints.py",
        "registry_sha256": E.registry_hash(),
        "n_cases": len(sampled),
        "n_cases_in_full_product": total,
        "sampling": (f"stratified: up to {MIN_PER_STRATUM} cases per "
                     f"(endpoint, decision) pair, at least {MIN_PER_VALUE} per "
                     f"axis value, filled to {MAX_CASES} with seed {SAMPLE_SEED}"),
        "decisions": decisions,
        "endpoints_covered": sorted({c["endpoint"] for c in sampled}),
        "axes": {k: [v for v in AXES[k]] for k in AXES},
        "cases": sampled,
    }


#: Arm label patterns the console has to reproduce exactly: the small
#: denominators a real round actually has, the edges where a Wilson interval
#: pins to 0 or 1, and the states where no rate can be stated at all.
ARM_CASES = [
    ([1, 1, 1, 1, 0, None, 1], 7, [1, 0, 0, 1, 0, 0, None, 0], 8),
    ([1, 1, 1], 3, [0, 0, 0], 3),
    ([0, 0, 0, 0], 4, [1, 1, 1, 1], 4),
    ([1, 0], 2, [1, 0], 2),
    ([None, None], 2, [1, 1], 2),
    ([1], 1, [None], 1),
    ([None], 1, [None], 1),
    ([1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 10, [1, 1, 1, 1, 1, 1, 1, 1, 1, 0], 10),
    ([1] * 20 + [0] * 5, 25, [1] * 10 + [0] * 15, 25),
    ([1, 0, None, 1, 0, 1, None, 0], 10, [0, 0, 1, None, 0], 10),
]


#: (a_confirmed, n) pairs the console's exact binomial must reproduce.
BINOM_CASES = [(0, 1), (1, 1), (0, 2), (1, 2), (2, 2), (1, 3), (3, 4), (7, 11),
               (4, 4), (0, 6), (10, 20), (13, 20), (1, 25), (25, 50)]


def arms_payload() -> dict:
    """The engine's own arm rates and differences, for the console to match."""
    from splicr.validation.evaluation import arm_rate, compare_arms

    cases = []
    for a_labels, a_drawn, b_labels, b_drawn in ARM_CASES:
        a = arm_rate("splicr", a_labels, a_drawn)
        b = arm_rate("fdr", b_labels, b_drawn)
        difference = compare_arms(a, b)
        cases.append({
            "a": {"labels": a_labels, "n_drawn": a_drawn, "expect": a.as_dict()},
            "b": {"labels": b_labels, "n_drawn": b_drawn, "expect": b.as_dict()},
            "difference": difference.as_dict(),
            "sentence": difference.sentence(),
        })
    from scipy.stats import binomtest

    binomials = [{"successes": k, "n": n,
                  "p_value": float(binomtest(k, n, 0.5, alternative="two-sided").pvalue)}
                 for k, n in BINOM_CASES]
    return {
        "binomials": binomials,
        "schema": "splicr.arm-comparison.v1",
        "generated_by": "scripts/validation/export_endpoints.py",
        "note": "Wilson rates per arm and a Newcombe interval on the difference. "
                "The console computes these for a round's results page and must "
                "agree with the engine to the last digit.",
        "n_cases": len(cases),
        "cases": cases,
    }


def canonical(payload: dict) -> str:
    return json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n"


def canonical_payload() -> dict:
    """The serialisation fixture, with each case's exact bytes and sha256."""
    import hashlib

    from splicr.validation.receipts import canonical_bytes

    cases = []
    for case in CANONICAL_CASES:
        body = canonical_bytes(case)
        cases.append({
            "payload": case,
            "bytes": body.decode("utf-8"),
            "sha256": hashlib.sha256(body).hexdigest(),
        })
    return {
        "schema": "splicr.canonical-bytes.v1",
        "generated_by": "scripts/validation/export_endpoints.py",
        "note": "A receipt frozen in the console and verified by the engine is "
                "one hash or it is nothing. These are the engine's exact bytes.",
        "n_cases": len(cases),
        "cases": cases,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="fail if the committed files are stale, and write nothing")
    args = parser.parse_args(argv)

    wanted = {REGISTRY_OUT: canonical(registry_payload()),
              MATRIX_OUT: canonical(matrix_payload()),
              CANONICAL_OUT: canonical(canonical_payload()),
              ARMS_OUT: canonical(arms_payload())}

    if args.check:
        stale: list[str] = []
        for path, body in wanted.items():
            relative = path.relative_to(ROOT)
            if not path.exists():
                stale.append(f"{relative} is missing")
            elif path.read_text() != body:
                stale.append(f"{relative} is stale")
        if stale:
            print("The generated endpoint files do not match the registry:",
                  file=sys.stderr)
            for problem in stale:
                print(f"  {problem}", file=sys.stderr)
            print("\nRegenerate with:\n  npm run validation:export", file=sys.stderr)
            return 1
        print(f"Up to date. registry {E.registry_hash()[:12]}, "
              f"{len(E.REGISTRY)} endpoints, "
              f"{matrix_payload()['n_cases']} decision cases.")
        return 0

    for path, body in wanted.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(body)
        temporary.replace(path)
        print(f"wrote {path.relative_to(ROOT)} ({len(body):,} bytes)")
    print(f"registry {E.registry_hash()[:12]}, {len(E.REGISTRY)} endpoints")
    return 0


if __name__ == "__main__":
    sys.exit(main())
