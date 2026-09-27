#!/usr/bin/env python
"""
Sync the downloaded reference data to Cloudflare R2.

    engine/.tools/env/bin/python scripts/data/upload-r2.py            # dry run
    engine/.tools/env/bin/python scripts/data/upload-r2.py --go       # upload
    engine/.tools/env/bin/python scripts/data/upload-r2.py --go --all # include huge files

Re-runnable: an object already present at the same size is skipped, so a
failed run costs nothing to resume.

Three sources may NOT be redistributed and are never uploaded:
  Addgene pooled library files  (terms forbid reproduction)
  Sanger Project Score          (internal research only, no resale)
  COSMIC                        (paid commercial licence)
They stay local. The manifest records that they were deliberately excluded,
so the gap is visible rather than looking like an oversight.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "engine"))

from splicr.r2 import R2Config, client, guess_content_type, upload  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
REFERENCES = ROOT / "data" / "references"
TESTDATA = ROOT / "data" / "testdata"

# Never upload: redistribution is not permitted.
EXCLUDED_DIRS = {
    "libraries": "Addgene terms forbid reproduction or redistribution",
    "projectscore": "Sanger Project Score is licensed for internal research only",
    "hf_cache": "local HuggingFace cache, not source data",
}

# Skip above this unless --all. Keeps a default run inside R2's free tier.
LARGE_FILE_BYTES = 400 * 1024 * 1024


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}PB"


def collect(include_large: bool) -> tuple[list[tuple[Path, str]], list[tuple[Path, str]]]:
    """Returns (to_upload, skipped) as (path, reason-or-key) pairs."""
    planned: list[tuple[Path, str]] = []
    skipped: list[tuple[Path, str]] = []

    for base, prefix in ((REFERENCES, "reference"), (TESTDATA, "testdata")):
        if not base.exists():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file() or path.name.startswith("."):
                continue
            rel = path.relative_to(base)
            top = rel.parts[0] if rel.parts else ""

            excluded = next((r for d, r in EXCLUDED_DIRS.items() if d in rel.parts), None)
            if excluded:
                skipped.append((path, excluded))
                continue

            size = path.stat().st_size
            if size > LARGE_FILE_BYTES and not include_large:
                skipped.append((path, f"larger than {human(LARGE_FILE_BYTES)}, use --all"))
                continue
            if size == 0:
                skipped.append((path, "empty file"))
                continue

            planned.append((path, f"{prefix}/{rel.as_posix()}"))
    return planned, skipped


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--go", action="store_true", help="actually upload")
    parser.add_argument("--all", action="store_true", help="include files over 400 MB")
    args = parser.parse_args()

    planned, skipped = collect(args.all)
    total = sum(p.stat().st_size for p, _ in planned)

    print(f"SplicR data sync to R2")
    print(f"  {len(planned)} files, {human(total)} to consider")
    print(f"  {len(skipped)} skipped")
    if not args.go:
        print("\nDry run. Pass --go to upload.\n")
        by_dir: dict[str, list[int]] = {}
        for p, key in planned:
            top = "/".join(key.split("/")[:2])
            by_dir.setdefault(top, []).append(p.stat().st_size)
        for d, sizes in sorted(by_dir.items()):
            print(f"  {d:<34} {len(sizes):>4} files  {human(sum(sizes))}")
        print("\n  skipped:")
        reasons: dict[str, int] = {}
        for _, reason in skipped:
            reasons[reason] = reasons.get(reason, 0) + 1
        for reason, n in sorted(reasons.items(), key=lambda kv: -kv[1]):
            print(f"    {n:>4}  {reason}")
        return

    cfg = R2Config.from_env()
    s3 = client(cfg)
    print(f"  bucket {cfg.bucket} at {cfg.endpoint}\n")

    uploaded = skipped_same = failed = 0
    moved = 0
    started = time.time()
    manifest: list[dict] = []

    for i, (path, key) in enumerate(planned, 1):
        size = path.stat().st_size
        try:
            did, _ = upload(s3, cfg.bucket, path, key, guess_content_type(path))
            if did:
                uploaded += 1
                moved += size
                print(f"  [{i:>3}/{len(planned)}] up   {key}  ({human(size)})")
            else:
                skipped_same += 1
                print(f"  [{i:>3}/{len(planned)}] have {key}")
            manifest.append({"key": key, "bytes": size,
                             "source": str(path.relative_to(ROOT))})
        except Exception as exc:
            failed += 1
            print(f"  [{i:>3}/{len(planned)}] FAIL {key}: {type(exc).__name__}: {exc}")

    # A manifest so consumers can see what is there without listing the bucket.
    index = {
        "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "bucket": cfg.bucket,
        "file_count": len(manifest),
        "total_bytes": sum(m["bytes"] for m in manifest),
        "files": manifest,
        "excluded": [
            {"path": str(p.relative_to(ROOT)), "reason": r} for p, r in skipped
        ],
        "licences": {
            "reference/genesets": "Hart lab reference sets, open",
            "reference/annotation": "HGNC CC0, NCBI public domain, Ensembl unrestricted",
            "reference/cells": "Cellosaurus CC BY 4.0",
            "reference/depmap": "DepMap CC BY 4.0, attribution required",
            "reference/offtarget": "Fortin et al. 2019, Genome Biology, CC BY",
            "reference/opentargets": "Open Targets CC0",
            "reference/orcs": "BioGRID ORCS MIT",
            "testdata": "GSE145743, Juhasz et al. Science Advances 2020",
        },
    }
    manifest_path = ROOT / "data" / "r2-manifest.json"
    manifest_path.write_text(json.dumps(index, indent=2))
    try:
        s3.put_object(Bucket=cfg.bucket, Key="manifest.json",
                      Body=json.dumps(index, indent=2).encode(),
                      ContentType="application/json")
    except Exception as exc:
        print(f"  could not write manifest.json to the bucket: {exc}")

    elapsed = time.time() - started
    print(f"\n  uploaded {uploaded}, already present {skipped_same}, failed {failed}")
    print(f"  moved {human(moved)} in {elapsed / 60:.1f} min")
    print(f"  manifest: {manifest_path.relative_to(ROOT)} and s3://{cfg.bucket}/manifest.json")


if __name__ == "__main__":
    main()
