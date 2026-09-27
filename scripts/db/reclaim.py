#!/usr/bin/env python
"""
Reclaim disk in Postgres by dropping the bulk reference tables.

    engine/.tools/env/bin/python scripts/db/reclaim.py            # report only
    engine/.tools/env/bin/python scripts/db/reclaim.py --go
    engine/.tools/env/bin/python scripts/db/reclaim.py --go --wait

WHY

A Supabase free project gets 500 MB. The Atlas reference tables were measured at
roughly 440 MB of that, most of it atlas.guides: 129 MB of rows and another
167 MB in the five indexes it carries. A bulk COPY on top of that, with its WAL
and dead tuples, pushed the instance over and it began refusing connections with
"the database system is not accepting connections / Hot standby mode is
disabled".

WHAT THIS DELETES, AND WHY THAT IS SAFE

Only immutable published reference data that this repo can rebuild from files it
already has:

  atlas.guides       -> data/lake/guides,      rebuilt by scripts/data/build-lake.py
  atlas.copy_number  -> data/lake/copy_number, rebuilt from DepMap OmicsCNGene
  atlas.screen_hits  -> rebuilt from data/references/orcs/orcs-human.tar.gz
  atlas.screens      -> rebuilt from the same ORCS archive

No tenant data is touched. Organizations, members, screens, runs, comparisons,
hits, flags, QC, validation outcomes and API keys are all left alone, and the
script refuses to run if asked to touch anything outside the list above.

TRUNCATE rather than DELETE: DELETE writes a WAL record per row and leaves the
dead tuples behind until a vacuum, which is exactly the pressure that broke the
instance. TRUNCATE drops the underlying files.

VACUUM, never VACUUM FULL. VACUUM FULL rewrites the table into a new file, so it
needs as much free space again as the table occupies, and takes an ACCESS
EXCLUSIVE lock for the whole rewrite. On a database that is already out of disk
that is the worst available move.
"""

from __future__ import annotations

import argparse
import pathlib
import sys
import time

import psycopg

ROOT = pathlib.Path(__file__).resolve().parents[2]

# The only tables this script may touch. Everything here is reproducible from
# files in the repo; nothing here is a customer's data.
RECLAIMABLE = ("atlas.guides", "atlas.copy_number", "atlas.screen_hits", "atlas.screens")

# Small, cheap and actually joined against by the web app. Left in place.
KEEP = ("atlas.genes", "atlas.gene_stats", "atlas.gene_sets", "atlas.gene_set_members",
        "atlas.libraries", "atlas.cell_models", "atlas.validation_records")


def dsn() -> str:
    env = {}
    for line in (ROOT / ".env").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env["SUPABASE_DB_URL"]


def connect(wait: bool, timeout_min: int = 120):
    deadline = time.time() + timeout_min * 60
    attempt = 0
    while True:
        try:
            return psycopg.connect(dsn(), connect_timeout=15, autocommit=True)
        except Exception as exc:
            if not wait or time.time() > deadline:
                raise
            attempt += 1
            if attempt % 10 == 1:
                print(f"  waiting for the database: {str(exc).splitlines()[0][:90]}")
            time.sleep(30)


def report(conn) -> None:
    print("Database size:",
          conn.execute("select pg_size_pretty(pg_database_size(current_database()))").fetchone()[0])
    print(f"\n{'table':36} {'total':>10} {'rows':>12}   reclaimable")
    rows = conn.execute("""
        select schemaname || '.' || relname as name,
               pg_total_relation_size(schemaname||'.'||relname) as total,
               n_live_tup
          from pg_stat_user_tables
         order by pg_total_relation_size(schemaname||'.'||relname) desc
         limit 18
    """).fetchall()
    total_reclaim = 0
    for name, total, live in rows:
        mark = ""
        if name in RECLAIMABLE:
            mark = "yes"
            total_reclaim += total
        print(f"{name:36} {total/1048576:>9.1f}M {live or 0:>12,}   {mark}")
    print(f"\nReclaimable: {total_reclaim/1048576:.1f} MB across {len(RECLAIMABLE)} tables")


def reclaim(conn) -> None:
    present = {
        r[0] for r in conn.execute("""
            select schemaname || '.' || relname from pg_stat_user_tables
        """).fetchall()
    }
    targets = [t for t in RECLAIMABLE if t in present]
    if not targets:
        print("Nothing to reclaim: none of the bulk tables exist.")
        return

    # Belt and braces. A typo in RECLAIMABLE must not be able to truncate a
    # tenant table, so the list is re-checked against KEEP before anything runs.
    for t in targets:
        assert t not in KEEP, f"refusing to truncate {t}, it is on the keep list"

    print(f"Truncating: {', '.join(targets)}")
    conn.execute(f"truncate {', '.join(targets)} cascade")
    print("  done")

    for t in targets:
        print(f"  vacuum {t}")
        conn.execute(f"vacuum (analyze) {t}")

    print("\nAfter:")
    print("  database size:",
          conn.execute("select pg_size_pretty(pg_database_size(current_database()))").fetchone()[0])
    print("\nThe data now lives in the lake. Rebuild or read it with:")
    print("  engine/.tools/env/bin/python scripts/data/build-lake.py all --upload")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--go", action="store_true", help="actually truncate")
    ap.add_argument("--wait", action="store_true",
                    help="poll until the database accepts connections, then act")
    args = ap.parse_args()

    try:
        conn = connect(args.wait)
    except Exception as exc:
        print(f"Could not connect: {str(exc).splitlines()[0][:140]}")
        return 1

    with conn:
        report(conn)
        if args.go:
            print()
            reclaim(conn)
        else:
            print("\nReport only. Pass --go to truncate the reclaimable tables.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
