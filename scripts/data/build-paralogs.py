#!/usr/bin/env python
"""
Build the pinned paralog reference the Escape engine reads.

    # HGNC gene groups only. No network; works in any checkout with the HGNC file.
    engine/.tools/env/bin/python scripts/data/build-paralogs.py --hgnc

    # Ensembl Compara paralogues for a gene list, resumable.
    engine/.tools/env/bin/python scripts/data/build-paralogs.py --ensembl --genes GENES.txt

    # Everything the Atlas has ever called a hit, over as many nights as it takes.
    engine/.tools/env/bin/python scripts/data/build-paralogs.py --ensembl --from-atlas

Two channels, two files, two provenance records. See
engine/splicr/escape/paralogs.py for why they are not merged.

WHY THE ENSEMBL PASS IS INCREMENTAL

Compara has no bulk human-only paralogue export that is smaller than the
all-species homology dump, and the REST service answers one gene per request at
15 requests a second. A genome-wide build is therefore tens of thousands of
requests, and while this script was written the service was returning 500 on its
own metadata endpoints. So the pass:

  - writes after every batch, and re-reads what is already on disk on start, so an
    interrupted build resumes instead of restarting
  - records each gene it actually covered, so a gene that was never reached is
    reported as uncovered rather than as having no paralogs
  - never writes a gene it could not fetch

A partial Ensembl build is useful: the store answers `covered = False` for
everything it does not hold, and the evidence model treats that as a missing
channel rather than as a negative result.
"""

from __future__ import annotations

import argparse
import http.client
import json
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "engine"))

from splicr.escape import paralogs  # noqa: E402

ENSEMBL = "https://rest.ensembl.org/homology/id/human/{gene}"
#: Ensembl asks for no more than 15 requests a second and returns Retry-After when
#: it means it. One at a time with a small pause stays well inside that and keeps
#: the failure mode boring.
PAUSE_SECONDS = 0.12
BATCH = 200
UA = "SplicR-paralogs/1.0 (mailto:ss4497@cornell.edu)"


def _fetch(gene: str, attempts: int = 3) -> list[dict] | None:
    """One gene's paralogues, or None when Ensembl did not answer."""
    url = (ENSEMBL.format(gene=gene)
           + "?type=paralogues;format=condensed;content-type=application/json")
    for attempt in range(attempts):
        request = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.loads(response.read().decode("utf-8"))
            data = payload.get("data") or []
            return (data[0].get("homologies") or []) if data else []
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return []          # a current id Compara holds no paralogue for
            if error.code not in (429, 500, 502, 503, 504) or attempt == attempts - 1:
                return None
            wait = float(error.headers.get("Retry-After") or 2 ** attempt)
            time.sleep(min(wait, 10.0))
        # http.client raises RemoteDisconnected and BadStatusLine straight through
        # urllib rather than wrapping them, and a partially built reference file is
        # not a reason to lose the whole pass: an unanswered gene is recorded as
        # unanswered and retried on the next run.
        except (urllib.error.URLError, http.client.HTTPException, socket.error,
                TimeoutError, ValueError, OSError):
            if attempt == attempts - 1:
                return None
            time.sleep(2 ** attempt)
    return None


def _existing(path: Path) -> tuple[list[dict], set[str]]:
    """Rows already built, and the genes they cover."""
    if not path.exists():
        return [], set()
    import pandas as pd

    frame = pd.read_parquet(path)
    rows = frame.where(frame.notna(), None).to_dict("records")
    return rows, {str(row["gene"]) for row in rows}


def _gene_list(args) -> list[str]:
    if args.genes:
        text = Path(args.genes).read_text()
        return sorted({line.strip() for line in text.splitlines()
                       if line.strip().startswith("ENSG")})
    if args.from_atlas:
        from splicr import db

        with db.connect() as conn:
            return [row[0] for row in conn.execute(
                "select distinct ensembl_gene_id from atlas.screen_hits "
                "where ensembl_gene_id is not null order by 1").fetchall()]
    raise SystemExit("--ensembl needs --genes FILE or --from-atlas")


def build_ensembl(args) -> int:
    path = paralogs.ENSEMBL_PARALOGS
    rows, covered = _existing(path)
    wanted = [gene for gene in _gene_list(args) if gene not in covered]
    if args.limit:
        wanted = wanted[: args.limit]
    print(f"{len(covered):,} genes already built; {len(wanted):,} to fetch")
    if not wanted:
        return 0

    release = args.release
    failed: list[str] = []
    for index, gene in enumerate(wanted, start=1):
        homologies = _fetch(gene)
        if homologies is None:
            failed.append(gene)
        else:
            if not homologies:
                # Covered, and Compara records no paralogue. Written as a self row
                # so the store can tell this from a gene it never reached.
                rows.append({
                    "gene": gene, "paralog": "", "relation": "", "taxonomy_level": "",
                    "sequence_identity": None, "group_size": None,
                    "source": "Ensembl Compara paralogues (REST, condensed)",
                    "release": release,
                })
            for homology in homologies:
                if homology.get("species") != "homo_sapiens":
                    continue
                rows.append({
                    "gene": gene,
                    "paralog": str(homology.get("id") or ""),
                    "relation": str(homology.get("type") or ""),
                    "taxonomy_level": str(homology.get("taxonomy_level") or ""),
                    # The condensed response carries no percent identity and it is
                    # not estimated from anything else.
                    "sequence_identity": None,
                    "group_size": None,
                    "source": "Ensembl Compara paralogues (REST, condensed)",
                    "release": release,
                })
        time.sleep(PAUSE_SECONDS)
        if index % BATCH == 0 or index == len(wanted):
            paralogs.write_rows(rows, path)
            print(f"  {index:,}/{len(wanted):,} fetched, {len(rows):,} rows, "
                  f"{len(failed):,} unanswered")
    paralogs.write_rows(rows, path)
    if failed:
        unanswered = path.with_name("ensembl_unanswered.txt")
        unanswered.write_text("\n".join(failed) + "\n")
        print(f"{len(failed):,} genes went unanswered; they are NOT recorded as "
              f"having no paralogs. Re-run to retry: {unanswered}")
    print(f"wrote {path}")
    return 0


def build_hgnc(args) -> int:
    rows = paralogs.hgnc_group_rows(max_group=args.max_group)
    pairs = sum(1 for row in rows if row["paralog"])
    genes = len({row["gene"] for row in rows})
    path = paralogs.write_rows(rows, paralogs.HGNC_GROUPS)
    print(f"HGNC gene groups: {pairs:,} directed pairs over {genes:,} genes "
          f"(groups of at most {args.max_group}); wrote {path}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--hgnc", action="store_true", help="build the HGNC gene-group channel")
    parser.add_argument("--ensembl", action="store_true", help="build the Ensembl Compara channel")
    parser.add_argument("--genes", help="file of canonical Ensembl gene ids, one per line")
    parser.add_argument("--from-atlas", action="store_true",
                        help="every gene atlas.screen_hits has called")
    parser.add_argument("--limit", type=int, default=0, help="stop after this many new genes")
    parser.add_argument("--max-group", type=int, default=paralogs.HGNC_GROUP_MAX,
                        help="drop HGNC groups larger than this")
    parser.add_argument("--release", default="Compara, fetched via REST",
                        help="release label written onto every Ensembl row")
    args = parser.parse_args()
    if not args.hgnc and not args.ensembl:
        parser.error("pass --hgnc, --ensembl, or both")
    status = 0
    if args.hgnc:
        status |= build_hgnc(args)
    if args.ensembl:
        status |= build_ensembl(args)
    return status


if __name__ == "__main__":
    raise SystemExit(main())
