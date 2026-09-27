#!/usr/bin/env python
"""
Build the reference lake: bulk Atlas data as Parquet, locally then on R2.

    engine/.tools/env/bin/python scripts/data/build-lake.py guides
    engine/.tools/env/bin/python scripts/data/build-lake.py guides --upload
    engine/.tools/env/bin/python scripts/data/build-lake.py all --upload

This replaces loading the same rows into Postgres. See engine/splicr/lake.py for
why: the guide table alone was 129 MB of heap plus 167 MB of indexes against a
500 MB free-tier disk, and the bulk load is what took the database down.

The rows come from the engine's own parsers, so the guide a screen is counted
against and the guide recorded in the lake cannot drift apart.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "engine"))

from splicr import lake  # noqa: E402
from splicr.config import DEPMAP_DIR  # noqa: E402


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"


def build_guides():
    """Every parseable library's guides, with measured off-target counts."""
    from splicr.references import annotate_offtarget, available_libraries, load_library

    cols: dict[str, list] = {k: [] for k in (
        "library_slug", "library_name", "taxid", "guide_key", "sequence", "gene_symbol",
        "is_control", "chrom", "cut_pos", "strand",
        "perfect_sites", "mismatch1_sites", "multi_gene",
    )}

    for slug in available_libraries():
        library = load_library(slug)
        annotate_offtarget(library)
        for g in library.guides:
            cols["library_slug"].append(slug)
            cols["library_name"].append(library.name)
            cols["taxid"].append(library.taxid)
            cols["guide_key"].append(g.guide_id)
            cols["sequence"].append(g.sequence)
            cols["gene_symbol"].append(g.gene)
            cols["is_control"].append(g.is_control)
            cols["chrom"].append(g.chrom)
            cols["cut_pos"].append(g.cut_pos)
            cols["strand"].append(g.strand)
            cols["perfect_sites"].append(g.perfect_alignments)
            cols["mismatch1_sites"].append(g.mismatch1_alignments)
            # None, not False, when the guide is not in the alignment table:
            # unknown and "does not target two genes" are different facts.
            cols["multi_gene"].append(
                None if g.perfect_alignments is None else g.perfect_alignments > 1
            )
        print(f"  {slug:18} {len(library.guides):>8,} guides")

    import pyarrow as pa
    return pa.table(cols, schema=pa.schema([
        ("library_slug", pa.string()), ("library_name", pa.string()), ("taxid", pa.int32()),
        ("guide_key", pa.string()), ("sequence", pa.string()), ("gene_symbol", pa.string()),
        ("is_control", pa.bool_()), ("chrom", pa.string()), ("cut_pos", pa.int64()),
        ("strand", pa.string()), ("perfect_sites", pa.int32()),
        ("mismatch1_sites", pa.int32()), ("multi_gene", pa.bool_()),
    ]))


def build_copy_number() -> str:
    """
    DepMap relative copy number, long form.

    OmicsCNGene is 1,929 rows by 38,591 columns and 1.39 GB on disk, so a Python
    loop over its 74 million cells is the wrong tool: DuckDB reads the CSV and
    unpivots it in one streaming statement instead.

    Returns SQL rather than a table, so `copy (...) to` never materialises the
    long form in memory. Nulls are dropped, which is most of the saving: the
    matrix is sparse and only the measured values are worth storing.

    The values are LINEAR relative copy ratio, not log2, from DepMap 24Q2 onward.
    Nothing here transforms them, and anything reading them must not assume log2.
    """
    path = DEPMAP_DIR / "OmicsCNGene.csv"
    if not path.exists():
        raise FileNotFoundError(path)

    conn = lake.connect()
    # The first column holds the ModelID; everything else is "SYMBOL (1234)".
    conn.execute(
        f"create or replace view _cn as select * from read_csv('{path}', header=true, "
        "sample_size=4000, all_varchar=false)"
    )
    first = conn.execute("select name from (describe _cn) limit 1").fetchone()[0]
    return (
        f'select "{first}" as model_id, '
        "regexp_replace(gene_label, ' \\(.*', '') as gene_symbol, "
        "cast(value as float) as relative_cn "
        f'from _cn unpivot (value for gene_label in (* exclude ("{first}"))) '
        "where value is not null"
    )


BUILDERS = {"guides": build_guides, "copy_number": build_copy_number}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset", choices=[*BUILDERS, "all"])
    ap.add_argument("--upload", action="store_true", help="push to R2 after writing")
    args = ap.parse_args()

    names = list(BUILDERS) if args.dataset == "all" else [args.dataset]
    for name in names:
        print(f"\nBuilding {name}")
        started = time.time()
        built = BUILDERS[name]()
        out = lake.write_dataset(name, built)
        files = sorted(out.rglob("*.parquet"))
        size = sum(f.stat().st_size for f in files)
        rows = lake.query("select count(*) from {%s}" % name).fetchone()[0]
        print(f"  {rows:,} rows -> {len(files)} parquet files, {human(size)} "
              f"in {time.time() - started:.1f}s")
        print(f"  at {out}")

        if args.upload:
            sent = lake.upload_dataset(name)
            print(f"  uploaded {sent} file(s) to R2 under {lake.DATASETS[name].key}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
