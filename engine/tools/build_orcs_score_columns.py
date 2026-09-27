#!/usr/bin/env python
"""Extend the safe ORCS cache with SCORE.2 through SCORE.5.

WHY THIS EXISTS

``build_orcs_safe_cache.py`` keeps only ``SCORE.1``, because that is all the
pipeline needed. The replication benchmark's baselines need more: 139 of the 269
screens that appear in a pair report a significance column as well as an effect
size (126 an ``FDR``, 13 a ``p-Value``), and the question "does significance
alone do what the method does" cannot be answered without reading it. ORCS ships
five score columns per screen and the index says what each one means, in
``SCORE.n_TYPE``.

WHAT IT WRITES

``orcs_human_safe_scores.parquet``: one row per ORCS record, for the screens
named on the command line only, with ``score1`` through ``score5``. It is a
sidecar and not a replacement: ``hit`` and ``score1`` still come from the long
cache, so nothing that already works changes, and the deduplication rule lives
in one place, in ``dataset._rows_sql``.

THE BOUNDARY

Screens outside ``splicr.orcs_safe.safe_ids`` are refused at the point of read,
exactly as the original builder does, so an AssayBench validation or test screen
cannot enter even if the caller asks for it.

    python engine/tools/build_orcs_score_columns.py --screens benchmark
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import tarfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from splicr.orcs_safe import PARSED_DIR, assert_safe, safe_ids  # noqa: E402

ARCHIVE = "/Users/sahaj/Documents/Projects/SplicR/data/references/orcs/orcs-human.tar.gz"
OUT_NAME = "orcs_human_safe_scores.parquet"
_SID = re.compile(r"SCREEN_(\d+)-")


def benchmark_screens() -> list[int]:
    """Every screen that appears on either side of a replication benchmark unit."""
    from splicr.replication import dataset

    bench = dataset.load()
    ids = set()
    for u in bench.all_units:
        ids.add(u.query_screen)
        ids.add(u.target_screen)
    return sorted(ids)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--screens",
        default="benchmark",
        help="'benchmark' for the screens in a replication pair, 'eligible' for the "
        "whole eligible set, or a comma-separated list of ids",
    )
    ap.add_argument("--archive", default=ARCHIVE)
    ap.add_argument("--out", default=os.path.join(PARSED_DIR, OUT_NAME))
    a = ap.parse_args()

    import pyarrow as pa
    import pyarrow.parquet as pq

    if a.screens == "benchmark":
        wanted = set(benchmark_screens())
    elif a.screens == "eligible":
        from splicr.replication import dataset

        wanted = set(dataset.eligible_screens()[0])
    else:
        wanted = {int(x) for x in a.screens.split(",") if x.strip()}

    # The boundary, asserted on the request itself and again on every file read.
    assert_safe(wanted)
    ok = safe_ids()

    schema = pa.schema(
        [("screen_id", pa.int32()), ("gene", pa.string()), ("hit", pa.bool_())]
        + [(f"score{i}", pa.float32()) for i in range(1, 6)]
    )
    buf: dict[str, list] = {f.name: [] for f in schema}
    writer = None

    def flush():
        nonlocal writer
        if not buf["screen_id"]:
            return
        tb = pa.table(
            {k: pa.array(v, schema.field(k).type) for k, v in buf.items()}, schema=schema
        )
        if writer is None:
            writer = pq.ParquetWriter(a.out, schema, compression="zstd")
        writer.write_table(tb)
        for v in buf.values():
            v.clear()

    def num(text: str) -> float:
        # ORCS writes "-" for a column a screen does not report, and occasionally
        # a non-numeric placeholder. Both become NaN, which is how a missing
        # significance column has to read: absent, not zero.
        try:
            return float(text)
        except ValueError:
            return float("nan")

    kept = refused = 0
    t0 = time.time()
    with tarfile.open(a.archive, "r:gz") as tf:
        for m in tf:
            if not m.isfile() or "SCREEN_INDEX" in m.name:
                continue
            mm = _SID.search(m.name)
            if not mm:
                continue
            sid = int(mm.group(1))
            if sid not in wanted:
                continue
            if sid not in ok:
                refused += 1
                continue
            lines = tf.extractfile(m).read().decode("utf-8", "replace").split("\n")
            ix = {c: i for i, c in enumerate(lines[0].lstrip("#").split("\t"))}
            gi, hi = ix["OFFICIAL_SYMBOL"], ix["HIT"]
            si = [ix[f"SCORE.{i}"] for i in range(1, 6)]
            for ln in lines[1:]:
                if not ln:
                    continue
                p = ln.split("\t")
                if len(p) <= hi:
                    continue
                g = p[gi].strip()
                if not g or g == "-":
                    continue
                buf["screen_id"].append(sid)
                buf["gene"].append(g)
                buf["hit"].append(p[hi].strip().upper() == "YES")
                for i, col in enumerate(si, start=1):
                    buf[f"score{i}"].append(num(p[col]) if col < len(p) else float("nan"))
            kept += 1
            if len(buf["screen_id"]) > 2_000_000:
                flush()
    flush()
    if writer:
        writer.close()

    missing = sorted(wanted - {int(x) for x in []}) if kept != len(wanted) else []
    print(
        f"screens requested={len(wanted)} written={kept} refused={refused} "
        f"{time.time() - t0:.0f}s -> {a.out}"
    )
    if kept != len(wanted):
        print(f"WARNING: {len(wanted) - kept} requested screens were not found in the archive")
        _ = missing
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
