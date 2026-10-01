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


@pytest.fixture(autouse=True)
def no_events(monkeypatch):
    monkeypatch.setattr(req.state, "event", lambda *a, **k: None)


def test_a_planned_study_moves_the_request_to_accepted(monkeypatch):
    monkeypatch.setattr("splicr.ingest.runner.request", lambda a: {"accession": "SRP1"})
    conn = FakeConn([
        [("req-1", "GSE1")],                                   # queued requests
        [("planned", "A HeLa olaparib screen", [], None, None)],  # the study row
    ])
    out = req.drain(conn)
    assert out["handled"] == [{"accession": "GSE1", "resolved": "SRP1", "status": "accepted"}]
    status, detail, resolved, request_id = updates(conn)[0]
    assert (status, resolved, request_id) == ("accepted", "SRP1", "req-1")
    assert detail == "A HeLa olaparib screen"


def test_an_ambiguous_design_says_what_was_ambiguous(monkeypatch):
    monkeypatch.setattr("splicr.ingest.runner.request", lambda a: {"accession": "GSE2"})
    conn = FakeConn([
        [("req-2", "GSE2")],
        [("needs_review", "A study", ["two candidate control arms", "no day zero"], None, None)],
    ])
    req.drain(conn)
    status, detail, _, _ = updates(conn)[0]
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
    status, detail, _, _ = updates(conn)[0]
    assert status == "failed"
    assert detail == "Failed at fetch: ENA returned no FASTQ for SRR9"


def test_an_accession_the_engine_refuses_is_rejected_with_its_reason(monkeypatch):
    monkeypatch.setattr("splicr.ingest.runner.request",
                        lambda a: {"error": "GSE4 is not a study accession"})
    conn = FakeConn([[("req-4", "GSE4")]])
    req.drain(conn)
    assert updates(conn)[0][:2] == ("rejected", "GSE4 is not a study accession")


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
    assert [entry["status"] for entry in out["handled"]] == ["failed", "accepted"]
    assert updates(conn)[0][0] == "failed"
    assert "NCBI timed out" in updates(conn)[0][1]


def test_a_request_with_no_study_row_is_a_bug_not_a_verdict(monkeypatch):
    # `request` returned no error and left nothing behind. Saying "rejected"
    # here would tell a researcher their deposit is not a screen, which is not
    # what happened.
    monkeypatch.setattr("splicr.ingest.runner.request", lambda a: {"accession": "GSE7"})
    conn = FakeConn([[("req-7", "GSE7")], []])
    req.drain(conn)
    status, detail, _, _ = updates(conn)[0]
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
    assert len(written) == 2
    assert all(row[0] != "queued" for row in written)


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
