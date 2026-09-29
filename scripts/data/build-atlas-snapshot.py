#!/usr/bin/env python
"""
Build the web console's Atlas snapshot from the ingested BioGRID ORCS store.

    engine/.tools/env/bin/python scripts/data/build-atlas-snapshot.py
    engine/.tools/env/bin/python scripts/data/build-atlas-snapshot.py --check

The Atlas explorer in the console has to work without a database, because the
Atlas is public reference data and the workspace database is neither where it
lives nor a thing a signed-out reader should need. The system of record is the
parquet store written by `scripts/data/ingest-orcs.py` (450 MB, 26 million gene
rows). This script reads that store and writes the two small files the web app
queries:

  screens.json   one record per screen: the publication, the library, the
                 cell model, the assay and, unchanged, the original authors'
                 hit definition (analysis, significance indicator, criteria).
  genes.json     a columnar index of every gene the ORCS resolved to an NCBI
                 Gene identifier or that any screen called a hit, with its
                 counts and, per gene, the ids of the screens that called it.
  manifest.json  release, counts and a sha-256 of each file, so a test can tell
                 a stale snapshot from a current one without the parquet.
  NOTICE         the ORCS licence, which must travel with a substantial copy.

Nothing is recomputed. Every count is one the ingest already wrote, and the
per-gene screen lists are read straight from the per-screen `is_hit` column, so
a gene's list is exactly the set of screens whose own authors called it a hit.
The hit definitions differ between studies. That is the point of retaining
them, and it is why the console never sums them into one score.

What is deliberately left out, and counted in the manifest so the omission is
visible: identifiers the ORCS could not resolve to a gene (non-targeting
control labels such as "NTC_new_5421", plasmid and pseudo-gene tags, retired
clone names) unless some screen called them a hit.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sys
from pathlib import Path

import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[2]
STORE = ROOT / "data" / "references" / "orcs" / "atlas"
OUT = ROOT / "apps" / "web" / "src" / "lib" / "atlas" / "data"

#: Free text is trimmed so one verbose screen cannot dominate the payload.
NOTE_LIMIT = 600

SCREEN_FIELDS = {
    "screen_id": "id",
    "source_id": "sourceId",
    "source_type": "sourceType",
    "pmid": "pmid",
    "author": "author",
    "year": "year",
    "scores_size": "nGenes",
    "number_of_hits": "nHits",
    "analysis": "analysis",
    "significance_indicator": "significanceIndicator",
    "significance_criteria": "significanceCriteria",
    "throughput": "throughput",
    "screen_type": "screenType",
    "screen_format": "screenFormat",
    "experimental_setup": "setup",
    "duration": "duration",
    "condition_name": "condition",
    "condition_dosage": "dosage",
    "moi": "moi",
    "library": "library",
    "library_type": "libraryType",
    "library_methodology": "libraryMethodology",
    "modality": "modality",
    "enzyme": "enzyme",
    "cell_line": "cellLine",
    "cell_type": "cellType",
    "phenotype": "phenotype",
    "screen_rationale": "rationale",
    "notes": "notes",
    "is_hit_list_only": "hitListOnly",
    "usable_background": "background",
    "targets_tss": "targetsTss",
}


def clean(value):
    """None for missing, trimmed strings, plain Python numbers."""
    if value is None:
        return None
    if isinstance(value, float):
        return None if value != value else value
    if isinstance(value, str):
        text = " ".join(value.split())
        return text or None
    if hasattr(value, "item"):
        return value.item()
    return value


def build_screens() -> list[dict]:
    table = pq.read_table(STORE / "screens.parquet").to_pylist()
    table.sort(key=lambda row: row["screen_id"])
    out = []
    for row in table:
        rec = {new: clean(row.get(old)) for old, new in SCREEN_FIELDS.items()}
        rec["scoreTypes"] = [
            clean(row.get(f"score_{i}_type")) for i in range(1, 6) if clean(row.get(f"score_{i}_type"))
        ]
        if rec["notes"] and len(rec["notes"]) > NOTE_LIMIT:
            rec["notes"] = rec["notes"][: NOTE_LIMIT - 1].rstrip() + "…"
        out.append(rec)
    return out


def read_hits(screen_ids: list[int]) -> dict[str, list[int]]:
    """gene symbol -> ascending list of screen ids whose authors called it a hit."""
    hits: dict[str, list[int]] = {}
    for sid in screen_ids:
        path = STORE / "gene_hits" / f"screen_id={sid}" / "rows.parquet"
        if not path.exists():
            raise SystemExit(f"missing per-screen rows for screen {sid}: {path}")
        table = pq.read_table(path, columns=["gene_symbol", "is_hit"])
        symbols = table.column("gene_symbol").to_pylist()
        flags = table.column("is_hit").to_pylist()
        seen: set[str] = set()
        for symbol, flag in zip(symbols, flags):
            if flag and symbol not in seen:
                seen.add(symbol)
                hits.setdefault(symbol, []).append(sid)
    return hits


def build_genes(screen_ids: list[int]) -> tuple[dict, dict]:
    stats = pq.read_table(
        STORE / "gene_stats.parquet",
        columns=[
            "symbol", "entrez_id", "n_screens_tested", "n_hits", "n_screens_all", "n_hits_all",
            "n_phenotypes", "n_cell_lines", "n_conditions",
        ],
    ).to_pylist()
    hits = read_hits(screen_ids)

    kept, dropped = [], 0
    for row in stats:
        symbol = row["symbol"]
        resolved = row["entrez_id"] is not None and row["entrez_id"] == row["entrez_id"]
        if resolved or symbol in hits:
            kept.append(row)
        else:
            dropped += 1
    kept.sort(key=lambda row: row["symbol"])

    keep_symbols = {row["symbol"] for row in kept}
    aliases_raw = pq.read_table(STORE / "gene_aliases.parquet").to_pylist()
    aliases = {}
    for row in aliases_raw:
        if row["symbol"] in keep_symbols and row["alias"] and row["alias"] not in keep_symbols:
            aliases[row["alias"]] = row["symbol"]

    # Cross-check the inverted index against the counts the ingest wrote. If
    # they disagree the snapshot would tell two stories about one gene.
    mismatches = [
        row["symbol"] for row in kept
        if len(hits.get(row["symbol"], [])) != int(row["n_hits_all"])
    ]
    if mismatches:
        raise SystemExit(
            f"{len(mismatches)} genes whose screen list disagrees with n_hits_all, "
            f"for example {mismatches[:5]}"
        )

    def delta(ids: list[int]) -> list[int]:
        out, prev = [], 0
        for value in ids:
            out.append(value - prev)
            prev = value
        return out

    genes = {
        "symbols": [row["symbol"] for row in kept],
        "entrez": [None if row["entrez_id"] != row["entrez_id"] or row["entrez_id"] is None
                   else int(row["entrez_id"]) for row in kept],
        "tested": [int(row["n_screens_all"]) for row in kept],
        "testedBackground": [int(row["n_screens_tested"]) for row in kept],
        "hitsBackground": [int(row["n_hits"]) for row in kept],
        "phenotypes": [int(row["n_phenotypes"]) for row in kept],
        "cellLines": [int(row["n_cell_lines"]) for row in kept],
        "conditions": [int(row["n_conditions"]) for row in kept],
        # Screen ids where the gene was called, ascending and delta encoded:
        # [3, 10, 4] is screens 3, 13 and 17. An empty list is a gene measured
        # and never called, which is a fact, not a missing value.
        "hitScreens": [delta(sorted(hits.get(row["symbol"], []))) for row in kept],
        "aliases": aliases,
    }
    return genes, {
        "genes": len(kept),
        "genesDroppedUnresolved": dropped,
        "aliases": len(aliases),
        "hitRows": sum(len(v) for v in genes["hitScreens"]),
    }


def dump(path: Path, payload) -> str:
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=False)
    data = text.encode("utf-8")
    path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--check", action="store_true",
                        help="rebuild in memory and fail if the committed snapshot differs")
    args = parser.parse_args()

    source_manifest = json.loads((STORE / "manifest.json").read_text())
    screens = build_screens()
    genes, gene_counts = build_genes([s["id"] for s in screens])

    manifest = {
        "schemaVersion": 1,
        "release": source_manifest["release"],
        "sourceGeneratedUtc": source_manifest["generated_utc"],
        "source": "BioGRID ORCS, https://orcs.thebiogrid.org",
        "licence": "MIT, Copyright 2021 Mike Tyers; see NOTICE",
        "organism": "H. sapiens (9606) only",
        "screens": len(screens),
        "backgroundScreens": int(source_manifest["n_background_screens"]),
        "hitListOnlyScreens": sum(1 for s in screens if s["hitListOnly"]),
        "geneRowsInSource": int(source_manifest["n_gene_rows"]),
        "hitRowsInSource": int(source_manifest["n_hit_rows"]),
        **gene_counts,
    }

    OUT.mkdir(parents=True, exist_ok=True)
    if args.check:
        current = json.loads((OUT / "manifest.json").read_text())
        rebuilt = {**manifest, "sha256": current.get("sha256")}
        if rebuilt != current:
            print("Atlas snapshot manifest is stale; rebuild it.", file=sys.stderr)
            return 1
        for name, payload in (("screens.json", screens), ("genes.json", genes)):
            text = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            if hashlib.sha256(text).hexdigest() != current["sha256"][name]:
                print(f"{name} differs from the committed snapshot; rebuild it.", file=sys.stderr)
                return 1
        print("Atlas snapshot is current.")
        return 0

    manifest["sha256"] = {
        "screens.json": dump(OUT / "screens.json", screens),
        "genes.json": dump(OUT / "genes.json", genes),
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    notice = (STORE / "NOTICE").read_text()
    (OUT / "NOTICE").write_text(notice)

    for name in ("screens.json", "genes.json"):
        raw = (OUT / name).stat().st_size
        packed = len(gzip.compress((OUT / name).read_bytes(), 6))
        print(f"{name:14s} {raw / 1e6:6.2f} MB  ({packed / 1e6:5.2f} MB gzipped)")
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
