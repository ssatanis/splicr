"""Exact duplicate/publication and metadata novelty audit; no model selection."""
from __future__ import annotations
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from controlled_benchmark import OUT, write
from splicr.assaybench_io import iter_split
from splicr.prescreen import clean
from splicr.research_protocol import cluster_interval


def main():
    metadata, publications, ids = [], defaultdict(set), defaultdict(set)
    signatures, reverse_signatures = defaultdict(list), defaultdict(list)
    for row in iter_split(None):
        split, name = row["split"], str(row["dataset_name"])
        publication = str(row.get("source_id") or "missing:" + name)
        publications[publication].add(split)
        ids[name].add(split)
        pairs = sorted(zip(row["relevance_genes"], row["relevance_scores"]))
        for store, absolute in ((signatures, False), (reverse_signatures, True)):
            values = [(g, abs(float(r)) if absolute else float(r)) for g, r in pairs]
            key = hashlib.sha256(json.dumps(values, separators=(",", ":")).encode()).hexdigest()
            store[key].append({"id": name, "publication": publication, "split": split})
        meta = {key: row.get(key) for key in ("dataset_name", "source_id", "author", "cell_line", "condition_name", "cleaned_phenotype", "library_methodology")}
        meta["split"] = split
        metadata.append(meta)
    def duplicates(store, cross):
        return [group for group in store.values() if len(group) > 1 and
                (not cross or len({r["split"] for r in group}) > 1)]
    audit = {"splits": dict(Counter(r["split"] for r in metadata)),
             "publication_cross_split": {k: sorted(v) for k, v in publications.items() if len(v) > 1},
             "id_cross_split": {k: sorted(v) for k, v in ids.items() if len(v) > 1},
             "exact_label_duplicate_groups": len(duplicates(signatures, False)),
             "exact_label_cross_split": duplicates(signatures, True),
             "absolute_label_duplicate_groups": len(duplicates(reverse_signatures, False)),
             "absolute_label_cross_split": duplicates(reverse_signatures, True),
             "limitations": ["Exact signatures do not detect all related experiments or alternate processing.",
                             "Publication IDs alone cannot certify independence.",
                             "Free-text metadata and LLM pretraining can contain post-publication clues.",
                             "Year extracted from author string is descriptive and not an independently verified date."]}
    train = [r for r in metadata if r["split"] == "train"]
    reference = json.loads((OUT / "reference_published_ensemble_screens.json").read_text())
    models = {"ensemble": reference,
              "router": json.loads((OUT / "router_replay_screens.json").read_text())}
    scored = {str(r["dataset_name"]): r for r in metadata if r["split"] == "test"}
    reports = {}
    for model, rows in models.items():
        groups = defaultdict(list)
        for row in rows:
            meta = scored[row["dataset_name"]]
            for field in ("cell_line", "condition_name", "cleaned_phenotype", "library_methodology"):
                known = {clean(t[field]) for t in train if clean(t[field])}
                value = clean(meta[field])
                novelty = "missing" if not value else "seen" if value in known else "unseen"
                groups[field + ":" + novelty].append(row)
            years = re.findall(r"\b(?:19|20)\d{2}\b", str(meta.get("author", "")))
            groups["author_year:" + (years[-1] if years else "unknown")].append(row)
        reports[model] = {key: cluster_interval([r["adjusted_ndcg@100"] for r in values],
                                               [r["source_id"] for r in values], repeats=5000)
                          for key, values in groups.items()}
    audit["retrospective_subgroups"] = reports
    write("leakage_and_novelty_audit.json", audit)
    print(json.dumps({k: v for k, v in audit.items() if k != "retrospective_subgroups"}, indent=2))


if __name__ == "__main__":
    main()
