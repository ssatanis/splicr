"""
Database utilities: connection, fast COPY-based bulk loading, batch upsert.
"""
import io
import json
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
from typing import Any, Iterator, List, Dict, Optional
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import DATABASE_URL


def get_conn():
    """Return a new psycopg2 connection."""
    return psycopg2.connect(DATABASE_URL)


@contextmanager
def transaction() -> Iterator[psycopg2.extensions.cursor]:
    """Context manager that yields a cursor and auto-commits/rolls back."""
    conn = get_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                yield cur
    finally:
        conn.close()


def execute_values(table: str, columns: List[str], rows: List[tuple],
                   on_conflict: str = "DO NOTHING") -> int:
    """
    Bulk-insert using psycopg2.extras.execute_values.
    Much faster than individual INSERTs.
    Returns number of rows inserted.
    """
    if not rows:
        return 0
    col_str = ", ".join(columns)
    sql = f"INSERT INTO {table} ({col_str}) VALUES %s ON CONFLICT {on_conflict}"
    with get_conn() as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, rows, page_size=2000)
        conn.commit()
    return len(rows)


def copy_from_csv(table: str, columns: List[str], rows: List[tuple]) -> int:
    """
    Load rows using COPY FROM STDIN (fastest method for large datasets).
    Converts None → \\N for NULL handling.
    Returns number of rows loaded.
    """
    if not rows:
        return 0

    buf = io.StringIO()
    for row in rows:
        parts = []
        for val in row:
            if val is None:
                parts.append("\\N")
            elif isinstance(val, (dict, list)):
                # JSON-encode dicts/lists, escape tabs and newlines
                s = json.dumps(val).replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n")
                parts.append(s)
            else:
                s = str(val).replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n")
                parts.append(s)
        buf.write("\t".join(parts) + "\n")
    buf.seek(0)

    col_str = ", ".join(columns)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.copy_expert(
                f"COPY {table} ({col_str}) FROM STDIN WITH (FORMAT text, NULL '\\N')",
                buf
            )
        conn.commit()
    finally:
        conn.close()
    return len(rows)


def upsert_rows(table: str, columns: List[str], rows: List[tuple],
                conflict_cols: List[str],
                update_cols: Optional[List[str]] = None,
                page_size: int = 10000) -> int:
    """
    Upsert (INSERT ... ON CONFLICT DO UPDATE) using execute_values.
    page_size controls rows per SQL statement (larger = fewer round trips).
    """
    if not rows:
        return 0

    if update_cols:
        update_str = ", ".join(f"{c} = EXCLUDED.{c}" for c in update_cols)
        conflict_str = f"({', '.join(conflict_cols)}) DO UPDATE SET {update_str}"
    else:
        conflict_str = f"({', '.join(conflict_cols)}) DO NOTHING"

    col_str = ", ".join(columns)
    sql = f"INSERT INTO {table} ({col_str}) VALUES %s ON CONFLICT {conflict_str}"

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, rows, page_size=page_size)
        conn.commit()
    finally:
        conn.close()
    return len(rows)


def count_rows(table: str) -> int:
    """Return approximate row count for a table."""
    with transaction() as cur:
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        return cur.fetchone()[0]


def table_exists(table: str) -> bool:
    """Check if a table exists."""
    with transaction() as cur:
        cur.execute(
            "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = %s)",
            (table,)
        )
        return cur.fetchone()[0]
