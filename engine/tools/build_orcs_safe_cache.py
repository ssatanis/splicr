#!/usr/bin/env python
"""Parse the BioGRID ORCS human archive into a SAFE-ONLY cache.

Screens on the AssayBench validation/test side of the leakage boundary are never
written, so nothing downstream can read them by accident. The boundary itself is
``engine/splicr/_assaybench_safe_orcs.json``; see ``splicr.orcs_safe``.

    python engine/tools/build_orcs_safe_cache.py [--policy publication]
"""
from __future__ import annotations

import argparse, json, os, re, sys, tarfile, time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from splicr.orcs_safe import safe_ids, boundary  # noqa: E402

ARCHIVE = "/Users/sahaj/Documents/Projects/SplicR/data/references/orcs/orcs-human.tar.gz"
OUT_DIR = "/Users/sahaj/Documents/Projects/SplicR/data/references/orcs/parsed"
_SID = re.compile(r"SCREEN_(\d+)-")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--policy", default="publication", choices=["publication", "screen", "strict"])
    ap.add_argument("--archive", default=ARCHIVE)
    ap.add_argument("--out", default=OUT_DIR)
    a = ap.parse_args()

    import pyarrow as pa, pyarrow.parquet as pq

    ok = safe_ids(a.policy)
    os.makedirs(a.out, exist_ok=True)
    schema = pa.schema([("screen_id", pa.int32()), ("gene", pa.string()),
                        ("hit", pa.bool_()), ("score1", pa.float32())])
    buf: dict[str, list] = {"screen_id": [], "gene": [], "hit": [], "score1": []}
    writer = None

    def flush():
        nonlocal writer
        if not buf["screen_id"]:
            return
        tb = pa.table({k: pa.array(v, schema.field(k).type) for k, v in buf.items()}, schema=schema)
        if writer is None:
            writer = pq.ParquetWriter(os.path.join(a.out, "orcs_human_safe_long.parquet"),
                                      schema, compression="zstd")
        writer.write_table(tb)
        for v in buf.values():
            v.clear()

    hits: dict[int, list[str]] = {}
    measured: dict[int, int] = {}
    kept = skipped = 0
    t0 = time.time()
    with tarfile.open(a.archive, "r:gz") as tf:
        for m in tf:
            if not m.isfile() or "SCREEN_INDEX" in m.name:
                continue
            mm = _SID.search(m.name)
            if not mm:
                continue
            sid = int(mm.group(1))
            if sid not in ok:                      # the boundary, enforced at read
                skipped += 1
                continue
            lines = tf.extractfile(m).read().decode("utf-8", "replace").split("\n")
            ix = {c: i for i, c in enumerate(lines[0].lstrip("#").split("\t"))}
            gi, hi, si = ix["OFFICIAL_SYMBOL"], ix["HIT"], ix["SCORE.1"]
            h, n = [], 0
            for ln in lines[1:]:
                if not ln:
                    continue
                p = ln.split("\t")
                if len(p) <= hi:
                    continue
                g = p[gi].strip()
                if not g or g == "-":
                    continue
                yes = p[hi].strip().upper() == "YES"
                n += 1
                if yes:
                    h.append(g)
                try:
                    sc = float(p[si])
                except ValueError:
                    sc = float("nan")
                buf["screen_id"].append(sid); buf["gene"].append(g)
                buf["hit"].append(yes); buf["score1"].append(sc)
            hits[sid] = h
            measured[sid] = n
            kept += 1
            if len(buf["screen_id"]) > 2_000_000:
                flush()
    flush()
    if writer:
        writer.close()

    assert not (set(hits) - ok), "BUG: an excluded screen reached the cache"
    with open(os.path.join(a.out, "orcs_human_safe_hits.json"), "w") as fh:
        json.dump({"policy": a.policy,
                   "boundary_generated_utc": boundary()["generated_utc"],
                   "n_screens": len(hits),
                   "hits": {str(k): v for k, v in hits.items()},
                   "measured_n": {str(k): v for k, v in measured.items()}}, fh)
    print(f"policy={a.policy}  kept={kept}  refused={skipped}  {time.time()-t0:.0f}s -> {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
