"""
What is actually in the ingest queue, and why each study is where it is.

WHY THIS EXISTS

A status column says `discovered` for a study nobody has looked at, for one
deliberately deferred until ENA publishes its reads, and for one whose planning
died on a database constraint. Those are three different facts and only one of
them is a problem, but an operator reading the table sees one word.

Worse, a failure can leave no trace on the row at all. GSE308841's planning hit
a CheckViolation on ingest.runs; the transaction unwound, the study kept its
deferral, and `error` stayed null. The only record is in ingest.events. So this
reads both, and a study is classified by the worst thing either of them says.

DRY RUN BY DEFAULT

`classify` reads. `retryable` selects. Neither writes. Moving a study is
`release`, which is explicit, bounded, logged, and refuses anything it did not
classify as an infrastructure failure: a historical outage is a reason to try
planning again, never a reason to approve the science.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

#: Stable internal categories. The first six are ours to fix; the rest are the
#: pipeline working as intended, and must never be retried as though they were
#: failures.
INFRASTRUCTURE = {
    "database_failure",
    "dependency_missing",
    "network_failure",
}
#: Not our fault and not retryable without new information from the source.
SOURCE = {
    "source_not_found",
    "metadata_incomplete",
    "unsupported_assay",
}
#: Working as intended.
EXPECTED = {
    "scientific_review_required",
    "deferred_waiting_for_reads",
    "classifier_rejected",
    "published",
    "awaiting_planning",
    "in_progress",
}

CATEGORY_HELP = {
    "database_failure": "A write to the ingest tables was refused. Ours to fix, and retryable once it is.",
    "dependency_missing": "The container could not import or find something it needs. Ours to fix, and retryable.",
    "network_failure": "A source API did not answer. Retryable without changing anything.",
    "source_not_found": "The accession is not in the archive it should be in.",
    "metadata_incomplete": "The deposit does not say enough to infer a design, and no retry will change that.",
    "unsupported_assay": "The deposit is not a pooled screen SplicR can process.",
    "scientific_review_required": "The design could not be inferred confidently. A person has to settle it.",
    "deferred_waiting_for_reads": "Planned, but the archive has not released the FASTQ yet. The engine re-checks on its own.",
    "classifier_rejected": "The classifier did not consider it a screen. Not attempted.",
    "published": "Reanalysed and in the Atlas.",
    "awaiting_planning": "Discovered and not yet attempted.",
    "in_progress": "A worker holds it now.",
}

#: Error text to category. Ordered: the first match wins, so the specific
#: patterns come before the general ones.
_PATTERNS: list[tuple[str, str]] = [
    (r"CheckViolation|UniqueViolation|ForeignKeyViolation|violates check constraint|psycopg\.errors", "database_failure"),
    (r"ModuleNotFoundError|ImportError|No module named|cannot import name", "dependency_missing"),
    (r"ConnectionError|Timeout|timed out|TemporaryFailure|HTTPError|502|503|504", "network_failure"),
    (r"not found in GEO|not found in ENA|no such accession", "source_not_found"),
    (r"not a pooled|unsupported assay|no library", "unsupported_assay"),
]


@dataclass
class StudyAudit:
    accession: str
    status: str
    category: str
    detail: str
    attempts: int
    #: Why it is not currently visible to the sweep, when it is not.
    held_until: Any = None
    #: Set when the failure is only in the event log and not on the study row.
    hidden_failure: bool = False
    events: list[str] = field(default_factory=list)

    @property
    def retryable(self) -> bool:
        return self.category in INFRASTRUCTURE

    def as_row(self) -> dict:
        return {
            "accession": self.accession,
            "status": self.status,
            "category": self.category,
            "retry": "yes" if self.retryable else "no",
            "attempts": self.attempts,
            "detail": self.detail[:160],
            "hidden_failure": self.hidden_failure,
        }


def _categorise_error(text: str | None) -> str | None:
    if not text:
        return None
    for pattern, category in _PATTERNS:
        if re.search(pattern, text, re.I):
            return category
    return "database_failure" if "relation" in text.lower() else None


def classify(conn, limit: int = 1000) -> list[StudyAudit]:
    """
    Every study, with the category that explains where it is.

    Reads only. The study row and the event log are both consulted because a
    failure can leave the row untouched.
    """
    rows = conn.execute(
        """
        select s.accession, s.status, s.attempts, s.error, s.error_stage,
               s.lease_owner, s.lease_expires, s.issues, s.plan_confidence
          from ingest.studies s
         order by s.updated_at desc
         limit %s
        """,
        (limit,),
    ).fetchall()

    #: The worst failure each study ever logged, whether or not the row kept it.
    failures: dict[str, tuple[str, str]] = {}
    for accession, message in conn.execute(
        """
        select accession, message from ingest.events
         where status = 'failed' and accession is not null
         order by at
        """
    ).fetchall():
        category = _categorise_error(message)
        if category:
            failures[accession] = (category, message)

    out: list[StudyAudit] = []
    for (accession, status, attempts, error, error_stage, lease_owner,
         lease_expires, issues, confidence) in rows:
        logged = failures.get(accession)
        row_category = _categorise_error(error)

        if row_category:
            category, detail, hidden = row_category, f"{error_stage or 'unknown stage'}: {error}", False
        elif logged and status not in ("published",):
            # The row says nothing; the event log says the planning died. This
            # is the case that would otherwise be invisible.
            category, detail, hidden = logged[0], logged[1], True
        elif status == "published":
            category, detail, hidden = "published", "In the Atlas.", False
        elif status == "rejected":
            category, detail, hidden = "classifier_rejected", "Not considered a screen.", False
        elif status == "needs_review":
            first = (issues or ["the design could not be inferred"])[0]
            category, detail, hidden = "scientific_review_required", str(first), False
        elif status in ("fetching", "analyzing"):
            category, detail, hidden = "in_progress", f"held by {lease_owner or 'a worker'}", False
        elif lease_owner and str(lease_owner).startswith("deferred"):
            category, detail, hidden = "deferred_waiting_for_reads", str(lease_owner), False
        elif attempts == 0:
            category, detail, hidden = "awaiting_planning", "Discovered, not yet attempted.", False
        else:
            category, detail, hidden = "metadata_incomplete", "Attempted and not planned, with no recorded reason.", False

        out.append(StudyAudit(
            accession=accession, status=status, category=category, detail=detail,
            attempts=attempts or 0, held_until=lease_expires, hidden_failure=hidden,
            events=[logged[1]] if logged else [],
        ))
    _ = confidence
    return out


def summarise(audits: list[StudyAudit]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for audit in audits:
        counts[audit.category] = counts.get(audit.category, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: -kv[1]))


def retryable(audits: list[StudyAudit]) -> list[StudyAudit]:
    """Only the ones an outage explains. Never a scientific verdict."""
    return [audit for audit in audits if audit.retryable]


def release(conn, audits: list[StudyAudit], *, max_studies: int = 25) -> dict:
    """
    Clear the lease on studies an infrastructure failure explains, so the next
    sweep can plan them again.

    It does not change status, does not touch attempts, and does not delete the
    original failure from the event log. A study that fails again for the same
    reason comes back here with the same category, which is the point.
    """
    chosen = retryable(audits)[:max_studies]
    released: list[str] = []
    for audit in chosen:
        # Guarded by status as well as by category: a study that moved on since
        # it was classified is left alone.
        updated = conn.execute(
            """
            update ingest.studies
               set lease_owner = null, lease_expires = null
             where accession = %s and status in ('discovered', 'failed')
            returning accession
            """,
            (audit.accession,),
        ).fetchone()
        if updated:
            released.append(audit.accession)
            conn.execute(
                "insert into ingest.events (accession, stage, status, message, detail) "
                "values (%s, 'audit', 'ok', %s, %s)",
                (audit.accession, f"lease released for retry after {audit.category}",
                 '{"source": "audit.release"}'),
            )
    return {"released": released, "considered": len(chosen)}
