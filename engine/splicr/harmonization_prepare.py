"""Prepare existing Atlas rows for strict identifier enforcement.

The database migration is deliberately split in two.  The first migration
adds canonical columns and a rejection ledger.  This module then resolves the
existing rows with the same Ensembl 116 and Cellosaurus references used by
ingestion.  Only after that transaction succeeds may the second migration make
the identifiers mandatory.

Rows that cannot be resolved are written to ``atlas.harmonization_rejects``
before they are removed from the strict query tables.  The operation is a
single transaction and the command-line wrapper defaults to a read-only dry
run, so a partial cleanup cannot leave the corpus in an unenforceable state.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
from typing import Iterable, Protocol

from . import harmonize


class Resolver(Protocol):
    def resolve(self, query: str): ...


@dataclass(frozen=True)
class Decision:
    """One raw identifier and the canonical decision made for it."""

    raw_value: str
    canonical_id: str | None
    canonical_label: str | None
    status: str
    reason: str
    candidates: tuple[str, ...] = ()

    @property
    def resolved(self) -> bool:
        return self.status == "resolved" and self.canonical_id is not None


def decide(values: Iterable[object], resolver: Resolver) -> dict[str, Decision]:
    """Resolve each distinct non-empty value once, deterministically."""
    out: dict[str, Decision] = {}
    for value in values:
        raw = "" if value is None else str(value).strip()
        if raw in out:
            continue
        result = resolver.resolve(raw)
        out[raw] = Decision(
            raw_value=raw,
            canonical_id=result.id if result.ok else None,
            canonical_label=result.label if result.ok else None,
            status=result.status,
            reason=result.reason or ("resolved" if result.ok else result.status),
            candidates=tuple(result.candidates),
        )
    return out


def _reject(conn, *, source: str, source_id: str, kind: str, decision: Decision,
            n_rows: int = 1) -> None:
    conn.execute(
        """
        insert into atlas.harmonization_rejects
          (source, source_id, entity_kind, raw_value, reason, candidates, n_rows)
        values (%s,%s,%s,%s,%s,%s,%s)
        on conflict (source, source_id, entity_kind, raw_value) do update set
          reason = excluded.reason, candidates = excluded.candidates,
          n_rows = excluded.n_rows, at = now()
        """,
        (source, source_id or "", kind, decision.raw_value or "<missing>",
         f"{decision.status}: {decision.reason}", list(decision.candidates), n_rows),
    )


def _reject_many(conn, rows: list[tuple[str, str, str, Decision, int]]) -> None:
    """Write rejection rows in one psycopg pipeline instead of one round trip each."""
    if not rows:
        return
    with conn.cursor() as cur:
        cur.executemany(
            """
            insert into atlas.harmonization_rejects
              (source, source_id, entity_kind, raw_value, reason, candidates, n_rows)
            values (%s,%s,%s,%s,%s,%s,%s)
            on conflict (source, source_id, entity_kind, raw_value) do update set
              reason = excluded.reason, candidates = excluded.candidates,
              n_rows = excluded.n_rows, at = now()
            """,
            [
                (source, source_id or "", kind, d.raw_value or "<missing>",
                 f"{d.status}: {d.reason}", list(d.candidates), n_rows)
                for source, source_id, kind, d, n_rows in rows
            ],
        )


def _summary(decisions: Iterable[Decision]) -> dict[str, int]:
    counts = Counter("resolved" if d.resolved else d.status for d in decisions)
    return dict(sorted(counts.items()))


def prepare(conn, *, apply: bool = False) -> dict:
    """Plan or apply the complete cleanup using an open psycopg connection.

    ``apply=False`` issues SELECTs only.  With ``apply=True`` callers must own
    the transaction; any error is allowed to propagate so they can roll it
    back.  The return value is JSON-serializable and includes exact row counts.
    """
    report: dict[str, dict] = {}

    # These two rollups are human-only today.  Existing Ensembl IDs are still
    # passed through the current GTF, so a retired ID is rejected rather than
    # grandfathered by its shape.
    gene_resolver = harmonize.genes(harmonize.HUMAN)
    for table, source, key_column in (
        ("gene_stats", "orcs", "gene_symbol"),
        ("gene_dependency", "depmap", "gene_symbol"),
    ):
        weight = "greatest(n_screens, 1)" if table == "gene_stats" else "1"
        rows = conn.execute(
            f"select {key_column}, ensembl_gene_id, {weight} from atlas.{table} order by {key_column}"
        ).fetchall()
        raw = [existing or symbol for symbol, existing, _ in rows]
        choices = decide(raw, gene_resolver)
        rejected = 0
        if apply:
            updates = []
            rejects = []
            delete_keys = []
            for (symbol, existing, reject_weight), value in zip(rows, raw):
                d = choices[value]
                if d.resolved:
                    updates.append((d.canonical_id, symbol))
                else:
                    rejects.append((source, "", "gene", d, int(reject_weight)))
                    delete_keys.append(symbol)
                    rejected += 1
            with conn.cursor() as cur:
                cur.executemany(
                    f"update atlas.{table} set ensembl_gene_id = %s where {key_column} = %s",
                    updates,
                )
            _reject_many(conn, rejects)
            if delete_keys:
                conn.execute(f"delete from atlas.{table} where {key_column} = any(%s)",
                             (delete_keys,))
        else:
            rejected = sum(not choices[v].resolved for v in raw)
        report[table] = {
            "rows": len(rows), "resolved_rows": len(rows) - rejected,
            "rejected_rows": rejected, "identifiers": _summary(choices.values()),
        }

    # Per-screen hits can include mouse screens, so resolve under the screen's
    # taxon rather than assuming human.
    hit_rows = conn.execute(
        """
        select h.screen_id, h.gene_symbol, h.ensembl_gene_id,
               s.source::text, s.source_id, coalesce(s.taxid, 9606)
          from atlas.screen_hits h join atlas.screens s on s.id = h.screen_id
         order by h.screen_id, h.gene_symbol
        """
    ).fetchall()
    hit_cache: dict[tuple[int, str], Decision] = {}
    hit_rejected = 0
    for screen_id, symbol, existing, source, source_id, taxid in hit_rows:
        raw = str(existing or symbol)
        cache_key = (int(taxid), raw)
        if cache_key not in hit_cache:
            try:
                hit_cache[cache_key] = decide([raw], harmonize.genes(int(taxid)))[raw]
            except ValueError:
                hit_cache[cache_key] = Decision(raw, None, None, "unresolved",
                                                f"unsupported taxid {taxid}")
        d = hit_cache[cache_key]
        if d.resolved:
            if apply:
                conn.execute(
                    "update atlas.screen_hits set ensembl_gene_id = %s "
                    "where screen_id = %s and gene_symbol = %s",
                    (d.canonical_id, screen_id, symbol),
                )
        else:
            hit_rejected += 1
            if apply:
                _reject(conn, source=source, source_id=str(source_id), kind="gene", decision=d)
                conn.execute(
                    "delete from atlas.screen_hits where screen_id = %s and gene_symbol = %s",
                    (screen_id, symbol),
                )
    report["screen_hits"] = {
        "rows": len(hit_rows), "resolved_rows": len(hit_rows) - hit_rejected,
        "rejected_rows": hit_rejected, "identifiers": _summary(hit_cache.values()),
    }

    # A strict Atlas screen is a cell-line experiment.  Primary material and
    # unresolved names remain auditable in the ledger but cannot enter this
    # table without a Cellosaurus identity.
    screen_rows = conn.execute(
        "select id, source::text, source_id, cell_line, cell_line_rrid, coalesce(taxid, 9606) "
        "from atlas.screens order by id"
    ).fetchall()
    cell_cache: dict[tuple[int, str], Decision] = {}
    screen_rejected = 0
    for screen_id, source, source_id, cell_line, existing, taxid in screen_rows:
        raw = str(existing or cell_line or "")
        cache_key = (int(taxid), raw)
        if cache_key not in cell_cache:
            try:
                cell_cache[cache_key] = decide(
                    [raw], harmonize.cell_lines(taxid=int(taxid))
                )[raw]
            except (KeyError, ValueError):
                cell_cache[cache_key] = Decision(raw, None, None, "unresolved",
                                                 f"unsupported taxid {taxid}")
        d = cell_cache[cache_key]
        if d.resolved:
            if apply:
                conn.execute("update atlas.screens set cell_line_rrid = %s where id = %s",
                             (d.canonical_id, screen_id))
        else:
            screen_rejected += 1
            if apply:
                _reject(conn, source=source, source_id=str(source_id), kind="cell_line",
                        decision=d)
                conn.execute("delete from atlas.screens where id = %s", (screen_id,))
    report["screens"] = {
        "rows": len(screen_rows), "resolved_rows": len(screen_rows) - screen_rejected,
        "rejected_rows": screen_rejected, "identifiers": _summary(cell_cache.values()),
    }
    report["applied"] = apply
    return report


def decision_dict(decision: Decision) -> dict:
    """Stable serialization helper used by the CLI and tests."""
    return asdict(decision)
