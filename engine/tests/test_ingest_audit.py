"""
The backlog audit: what each study's position actually means.

WHY THESE MATTER

`discovered` is the status of a study nobody has attempted, one the engine
deliberately deferred until ENA publishes its reads, and one whose planning
died on a database constraint. Treating those alike is how an operator either
retries the whole queue for no reason or never notices the one real failure.

The case that drove this: GSE308841's planning hit a CheckViolation writing to
ingest.runs. The transaction unwound, the study kept its deferral, and
studies.error stayed null. The only record was in ingest.events. An audit that
read the row alone would have reported a perfectly healthy backlog.
"""

from __future__ import annotations

import pytest

from splicr.ingest import audit


class FakeConn:
    """Answers the two reads `classify` makes, in the order it makes them."""

    def __init__(self, studies, events=()):
        self.studies = studies
        self.events = list(events)
        self.writes = []

    def execute(self, sql, params=()):
        flat = " ".join(sql.split()).lower()
        if flat.startswith("update") or flat.startswith("insert"):
            self.writes.append((flat, params))
            class Cur:
                def fetchone(_self):
                    #  The guarded update returns a row only for a study whose
                    #  status still allows it.
                    return (params[0],) if "status in ('discovered', 'failed')" in flat else None
            return Cur()
        rows = self.events if "ingest.events" in flat else self.studies
        class Cur:
            def fetchall(_self):
                return rows
        return Cur()


def study(accession, status="discovered", *, attempts=0, error=None, error_stage=None,
          lease_owner=None, lease_expires=None, issues=None, confidence=None):
    return (accession, status, attempts, error, error_stage, lease_owner, lease_expires,
            issues, confidence)


def only(audits, accession):
    return next(a for a in audits if a.accession == accession)


def test_a_deliberate_deferral_is_not_a_failure():
    conn = FakeConn([study("GSE1", lease_owner="deferred: ENA lists no runs yet", attempts=1)])
    result = only(audit.classify(conn), "GSE1")
    assert result.category == "deferred_waiting_for_reads"
    assert not result.retryable, "retrying a deferral spends compute to learn nothing"


def test_an_unattempted_study_is_not_a_failure_either():
    conn = FakeConn([study("GSE2", attempts=0)])
    assert only(audit.classify(conn), "GSE2").category == "awaiting_planning"


def test_needs_review_is_scientific_and_never_retryable():
    conn = FakeConn([study("GSE3", status="needs_review",
                           issues=["several cell lines in one study; the plan needs one per cell line"])])
    result = only(audit.classify(conn), "GSE3")
    assert result.category == "scientific_review_required"
    assert not result.retryable
    # The reason shown is the engine's own first issue, not a generic phrase.
    assert "several cell lines" in result.detail


def test_a_failure_recorded_only_in_the_event_log_is_still_found():
    # The GSE308841 case: the row looks like every other deferral.
    conn = FakeConn(
        [study("GSE308841", lease_owner="deferred: ENA lists no runs yet", attempts=1)],
        [("GSE308841", 'CheckViolation: new row for relation "runs" violates check constraint')],
    )
    result = only(audit.classify(conn), "GSE308841")
    assert result.category == "database_failure"
    assert result.hidden_failure, "the audit must say the row did not carry this"
    assert result.retryable


@pytest.mark.parametrize("message, category", [
    ("ModuleNotFoundError: No module named 'pydantic'", "dependency_missing"),
    ("psycopg.errors.CheckViolation: violates check constraint", "database_failure"),
    ("ConnectionError: HTTPSConnectionPool read timed out", "network_failure"),
    ("GSE999999991: not found in GEO", "source_not_found"),
])
def test_failures_are_categorised_by_what_broke(message, category):
    conn = FakeConn([study("X", attempts=1)], [("X", message)])
    assert only(audit.classify(conn), "X").category == category


def test_infrastructure_and_science_never_share_a_category():
    assert audit.INFRASTRUCTURE.isdisjoint(audit.EXPECTED)
    assert audit.INFRASTRUCTURE.isdisjoint(audit.SOURCE)
    # Every category the classifier can emit has an operator-facing sentence.
    for category in audit.INFRASTRUCTURE | audit.SOURCE | audit.EXPECTED:
        assert category in audit.CATEGORY_HELP


def test_only_infrastructure_failures_are_retryable():
    conn = FakeConn(
        [
            study("A", status="needs_review", issues=["ambiguous"]),
            study("B", status="rejected"),
            study("C", lease_owner="deferred: ENA lists no runs yet", attempts=1),
            study("D", attempts=1),
        ],
        [("D", "ModuleNotFoundError: No module named 'pydantic'")],
    )
    assert [a.accession for a in audit.retryable(audit.classify(conn))] == ["D"]


def test_release_is_bounded_logged_and_changes_no_status():
    conn = FakeConn([study("D", attempts=1)], [("D", "psycopg.errors.CheckViolation: nope")])
    audits = audit.classify(conn)
    out = audit.release(conn, audits, max_studies=25)
    assert out["released"] == ["D"]

    updates = [sql for sql, _ in conn.writes if sql.startswith("update")]
    assert len(updates) == 1
    sql = updates[0]
    # It clears the lease and nothing else: no status, no attempts, no verdict.
    assert "lease_owner = null" in sql and "lease_expires = null" in sql
    for forbidden in ["set status", "status =", "attempts =", "verdict =", "score ="]:
        assert forbidden not in sql.replace("where status in", ""), f"release touched {forbidden}"
    # And it is recorded, so a second operator can see it happened.
    assert any(sql.startswith("insert into ingest.events") for sql, _ in conn.writes)


def test_release_refuses_anything_it_did_not_classify_as_infrastructure():
    conn = FakeConn([
        study("A", status="needs_review", issues=["ambiguous"]),
        study("C", lease_owner="deferred: ENA lists no runs yet", attempts=1),
    ])
    out = audit.release(conn, audit.classify(conn), max_studies=25)
    assert out == {"released": [], "considered": 0}
    assert conn.writes == [], "a historical outage is not a reason to approve any science"


def test_release_honours_its_ceiling():
    studies = [study(f"S{i}", attempts=1) for i in range(10)]
    events = [(f"S{i}", "ConnectionError: timed out") for i in range(10)]
    conn = FakeConn(studies, events)
    out = audit.release(conn, audit.classify(conn), max_studies=3)
    assert out["considered"] == 3
    assert len(out["released"]) == 3


def test_the_summary_adds_up():
    conn = FakeConn([
        study("A", status="published"),
        study("B", status="rejected"),
        study("C", status="rejected"),
    ])
    audits = audit.classify(conn)
    assert sum(audit.summarise(audits).values()) == len(audits)
