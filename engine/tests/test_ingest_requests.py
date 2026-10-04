"""
The handover between the console and the ingest engine.

A workspace writes a row into public.screen_requests and never touches it
again. Everything these tests guard is about the row coming back: a queued
request always leaves `drain` with a status that is not 'queued', the sentence
beside it is the engine's own and not a template chosen by status, and a
request already accepted follows its study without anybody moving the study.

No database and no network. The connection is a stub that records statements,
which is enough because the module is the SQL plus the mapping.
"""

from __future__ import annotations

import pytest

from splicr.ingest import requests as req


class FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None


class FakeConn:
    """Answers each statement from `answers`, in order, and records every write."""

    def __init__(self, answers):
        self.answers = list(answers)
        self.statements = []

    def execute(self, sql, params=()):
        flat = " ".join(sql.split())
        self.statements.append((flat, params))
        # Only a read consumes an answer, so a write between two reads does not
        # shift the next one onto the wrong statement.
        rows = (self.answers.pop(0) if self.answers else []) if flat.lower().startswith("select") else []
        return FakeCursor(rows)


def updates(conn):
    """The (status, detail, resolved, id) tuples written back to screen_requests."""
    return [params for sql, params in conn.statements if sql.startswith("update public.screen_requests set status")]


def final_update(conn):
    return updates(conn)[-1]


@pytest.fixture(autouse=True)
def no_events(monkeypatch):
    monkeypatch.setattr(req.state, "event", lambda *a, **k: None)


def test_a_request_is_marked_planning_before_slow_metadata_work(monkeypatch):
    def no_study(_accession):
        return {"accession": "GSE0"}

    monkeypatch.setattr("splicr.ingest.runner.request", no_study)
    conn = FakeConn([[("req-0", "GSE0")], []])
    req.drain(conn)
    status, detail, resolved, request_id = updates(conn)[0]
    assert (status, resolved, request_id) == ("planning", None, "req-0")
    assert "picked this up" in detail


def test_a_planned_study_is_reported_as_planning_not_as_analysing(monkeypatch):
    monkeypatch.setattr("splicr.ingest.runner.request", lambda a: {"accession": "SRP1"})
    conn = FakeConn([
        [("req-1", "GSE1")],                                   # queued requests
        [("planned", "A HeLa olaparib screen", [], None, None)],  # the study row
    ])
    out = req.drain(conn)
    assert out["handled"] == [{"accession": "GSE1", "resolved": "SRP1", "status": "planning"}]
    status, detail, resolved, request_id = final_update(conn)
    assert (status, resolved, request_id) == ("planning", "SRP1", "req-1")
    assert detail == "A HeLa olaparib screen"


def test_an_ambiguous_design_says_what_was_ambiguous(monkeypatch):
    monkeypatch.setattr("splicr.ingest.runner.request", lambda a: {"accession": "GSE2"})
    conn = FakeConn([
        [("req-2", "GSE2")],
        [("needs_review", "A study", ["two candidate control arms", "no day zero"], None, None)],
    ])
    req.drain(conn)
    status, detail, _, _ = final_update(conn)
    assert status == "needs_review"
    # The engine's own issues, not a sentence chosen from the status.
    assert detail == "two candidate control arms; no day zero"


def test_a_failed_study_carries_its_stage_and_message(monkeypatch):
    monkeypatch.setattr("splicr.ingest.runner.request", lambda a: {"accession": "GSE3"})
    conn = FakeConn([
        [("req-3", "GSE3")],
        [("failed", "A study", [], "ENA returned no FASTQ for SRR9", "fetch")],
    ])
    req.drain(conn)
    status, detail, _, _ = final_update(conn)
    assert status == "failed"
    assert detail == "Failed at fetch: ENA returned no FASTQ for SRR9"


def test_an_accession_the_engine_refuses_is_rejected_with_its_reason(monkeypatch):
    monkeypatch.setattr("splicr.ingest.runner.request",
                        lambda a: {"error": "GSE4 is not a study accession"})
    conn = FakeConn([[("req-4", "GSE4")]])
    req.drain(conn)
    assert final_update(conn)[:2] == ("rejected", "GSE4 is not a study accession")


def test_a_traceback_never_reaches_the_researcher(monkeypatch):
    """What broke goes to the engine log; what is shown is a sentence."""
    logged = []
    monkeypatch.setattr(req.state, "event",
                        lambda conn, acc, stage, status, message, *a, **k: logged.append(message))
    monkeypatch.setattr("splicr.ingest.runner.request",
                        lambda a: (_ for _ in ()).throw(KeyError("accession")))
    conn = FakeConn([[("req-x", "GSE999999991")]])
    req.drain(conn)
    status, detail, _, _ = final_update(conn)
    assert status == "failed"
    for leak in ["KeyError", "Traceback", "accession'", "None"]:
        assert leak not in detail, f"{leak!r} leaked into user-visible copy: {detail!r}"
    assert "nothing was analysed" in detail
    # And an engineer can still find out what happened.
    assert any("KeyError" in message for message in logged)


def test_one_broken_request_does_not_stop_the_queue(monkeypatch):
    def boom(accession):
        if accession == "GSE5":
            raise RuntimeError("NCBI timed out")
        return {"accession": accession}

    monkeypatch.setattr("splicr.ingest.runner.request", boom)
    conn = FakeConn([
        [("req-5", "GSE5"), ("req-6", "GSE6")],
        [("planned", "Fine", [], None, None)],   # the study row for GSE6
    ])
    out = req.drain(conn)
    assert [entry["status"] for entry in out["handled"]] == ["failed", "planning"]
    assert updates(conn)[1][0] == "failed"
    # The second request is still handled, which is the point of this test.
    assert updates(conn)[3][0] == "planning"


def test_a_request_with_no_study_row_is_a_bug_not_a_verdict(monkeypatch):
    # `request` returned no error and left nothing behind. Saying "rejected"
    # here would tell a researcher their deposit is not a screen, which is not
    # what happened.
    monkeypatch.setattr("splicr.ingest.runner.request", lambda a: {"accession": "GSE7"})
    conn = FakeConn([[("req-7", "GSE7")], []])
    req.drain(conn)
    status, detail, _, _ = final_update(conn)
    assert status == "failed"
    assert "recorded no study" in detail


def test_no_queued_request_is_left_queued(monkeypatch):
    monkeypatch.setattr("splicr.ingest.runner.request", lambda a: {"accession": a})
    conn = FakeConn([
        [("a", "GSE8"), ("b", "GSE9")],
        [("published", "One", [], None, None)],
        [("rejected", "Two", ["no raw reads are deposited"], None, None)],
    ])
    req.drain(conn)
    written = updates(conn)
    assert len(written) == 4
    assert all(row[0] != "queued" for row in written)
    assert [row[0] for row in written[::2]] == ["planning", "planning"]


def test_refresh_follows_the_study_and_moves_nothing(monkeypatch):
    conn = FakeConn([[("req-1", "published", "A screen", [], None, None)]])
    assert req.refresh(conn) == {"refreshed": 1}
    assert updates(conn)[0][0] == "published"
    # Reading only: nothing in this path writes to ingest.studies.
    assert not any("ingest.studies set" in sql for sql, _ in conn.statements)


def test_every_ingest_status_maps_to_a_request_status():
    from splicr.ingest.models import STATUSES

    missing = set(STATUSES) - set(req._FROM_STUDY)
    assert not missing, f"ingest statuses with no request mapping: {sorted(missing)}"


def test_waiting_for_a_design_reads_differently_from_waiting_for_reads():
    # The two waits are minutes and hours. Collapsing them, as 'accepted' did,
    # tells a researcher nothing about which one they are in.
    assert req._FROM_STUDY["discovered"] == req._FROM_STUDY["planned"] == "planning"
    assert req._FROM_STUDY["fetching"] == req._FROM_STUDY["analyzing"] == "running"
    assert "accepted" not in req._FROM_STUDY.values()
