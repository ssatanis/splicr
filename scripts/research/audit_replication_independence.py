"""Audit archived benchmark dependence without refitting or reading new labels.

Run from any directory. Writes a new diagnostic; never replaces frozen results.
Screen-pair bootstraps account for A->B/B->A dependence but not shared screens
across pairs, or common publication/lab processing effects.
"""
from __future__ import annotations

import collections
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAIRS = ROOT / "engine/splicr/replication/_pairs_v1.json"
RESULTS = ROOT / "research/artifacts/20260928/replication_heldout/heldout_results.json"
OUT = ROOT / "research/artifacts/20261008/replication_independence.json"


def components(edges: list[tuple[str, str]]) -> list[list[str]]:
    adjacency: dict[str, set[str]] = collections.defaultdict(set)
    for left, right in edges:
        adjacency[left].add(right)
        adjacency[right].add(left)
    remaining = set(adjacency)
    groups = []
    while remaining:
        stack = [min(remaining)]
        group = set()
        while stack:
            node = stack.pop()
            if node in group:
                continue
            group.add(node)
            stack.extend(adjacency[node] - group)
        remaining -= group
        groups.append(sorted(group))
    return sorted(groups, key=lambda group: (-len(group), group))


def main() -> None:
    metadata = json.loads(PAIRS.read_text())
    results = json.loads(RESULTS.read_text())
    units = [unit for unit in metadata["units"] if unit["split"] == "heldout"]
    pair_units: dict[str, list[dict]] = collections.defaultdict(list)
    for unit in units:
        pair_units[unit["pair_key"]].append(unit)
    if any(len(group) != 2 for group in pair_units.values()):
        raise ValueError("Expected exactly two directions for every archived pair")
    pairs = [pair_units[key][0] for key in sorted(pair_units)]
    degree: collections.Counter[str] = collections.Counter()
    publications: collections.Counter[str] = collections.Counter()
    cells: collections.Counter[str] = collections.Counter()
    edges = []
    pub_edges = []
    for pair in pairs:
        left, right = str(pair["query_screen"]), str(pair["target_screen"])
        degree.update((left, right))
        publications.update((pair["query_publication"], pair["target_publication"]))
        cells.update((pair["cell_line_key"],))
        edges.append((left, right))
        pub_edges.append((pair["query_publication"], pair["target_publication"]))
    candidate = results["per_unit"][results["primary_model"]]
    comparator = results["per_unit"][results["comparator"]]
    expected = {unit["unit_id"] for unit in units}
    if set(candidate) != expected or set(comparator) != expected:
        raise ValueError("Archived scores and metadata do not cover identical units")
    differences = [candidate[key]["average_precision"] - comparator[key]["average_precision"] for key in sorted(expected)]
    document = {
        "schema": "splicr.replication-independence-audit/1",
        "audit_date": "2026-10-08",
        "scope": "Existing public archived metadata and per-unit scores only; no refit, selection or new held-out evaluation",
        "heldout_units": len(units),
        "heldout_pairs": len(pairs),
        "unique_screens": len(degree),
        "unique_publications": len(publications),
        "unique_cell_lines": len(cells),
        "screens_reused_across_pairs": sum(count > 1 for count in degree.values()),
        "max_pairs_per_screen": max(degree.values(), default=0),
        "cell_lines_with_multiple_pairs": {key: count for key, count in sorted(cells.items()) if count > 1},
        "screen_graph_components": components(edges),
        "publication_graph_components": components(pub_edges),
        "pairs_touching_each_publication": dict(sorted(publications.items())),
        "recomputed_mean_ap_difference": sum(differences) / len(differences),
        "archived_bootstrap_unit": "pair_key",
        "interpretation": [
            "Pair clustering handles the two ordered directions of each pair.",
            "This held-out archive has no screen or cell-line reuse across pairs; that possible dependence was checked and was not found.",
            "Pair resampling describes variation across these screen pairs, conditional on their publication pipelines; it cannot establish generalization across independent laboratories or publication pipelines.",
            "Only five held-out publications and a dominant publication comparison limit publication-level inference; no replacement superiority interval is asserted.",
            "The point estimate is an archived cross-screen hit-agreement ranking result, not biological validation precision or calibrated probability.",
        ],
        "inputs": [{"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in (PAIRS, RESULTS)],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(document, indent=2, sort_keys=True, allow_nan=False) + "\n")
    print(json.dumps({key: document[key] for key in (
        "heldout_units", "heldout_pairs", "unique_screens", "unique_publications", "unique_cell_lines",
        "screens_reused_across_pairs", "max_pairs_per_screen", "cell_lines_with_multiple_pairs", "recomputed_mean_ap_difference")}, indent=2))


if __name__ == "__main__":
    main()
