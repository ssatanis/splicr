#!/usr/bin/env python
"""Prepare existing Atlas rows before strict harmonization is enabled.

Dry-run (default):
    engine/.tools/env/bin/python scripts/data/prepare-harmonization.py

Apply one all-or-nothing cleanup transaction:
    engine/.tools/env/bin/python scripts/data/prepare-harmonization.py --apply
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "engine"))

from splicr import db  # noqa: E402
from splicr.harmonization_prepare import prepare  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true",
                        help="write canonical IDs, ledger rejects, and remove rejected rows")
    args = parser.parse_args()

    conn = db.open_connection()
    try:
        report = prepare(conn, apply=args.apply)
        if args.apply:
            conn.commit()
        else:
            conn.rollback()
        print(json.dumps(report, indent=2, sort_keys=True))
        if not args.apply:
            print("Dry run only; pass --apply to commit the cleanup.")
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
