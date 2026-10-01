"""
Requests a lab made from the console, and what the engine did about them.

public.screen_requests is the handover between the web app and this engine. The
console records an accession a workspace wants analysed and never touches it
again; everything after that row exists happens here.

Two rules the rest of this module exists to keep.

A request is never silently dropped. Every queued row leaves this module with a
status that is not 'queued' and a sentence saying why, including the ones the
engine refuses: a researcher who asked for a deposit that holds no raw reads
has to be told that, not left watching a queue.

The sentence is the engine's. `detail` is written from what `plan` and the study
row actually recorded - the issues it raised, the stage it failed at - and never
from a template chosen by status. A reader comparing two rejected requests
should be able to see that they were rejected for different reasons.
"""

from __future__ import annotations

from typing import Any

from . import state

#: public.screen_requests.status, mapped from ingest.studies.status.
#: 'discovered' and 'planned' are both "the engine has it and is working",
#: which is one fact to a researcher even though they are two to the engine.
_FROM_STUDY = {
    "discovered": "accepted",
    "planned": "accepted",
    "fetching": "accepted",
    "analyzing": "accepted",
    "needs_review": "needs_review",
    "published": "published",
    "rejected": "rejected",
    "failed": "failed",
}


def _set(conn, request_id: str, status: str, detail: str,
         resolved: str | None = None) -> None:
    conn.execute(
        "update public.screen_requests set status = %s::public.screen_request_status, "
        "detail = %s, resolved_accession = coalesce(%s, resolved_accession) where id = %s",
        (status, detail[:2000], resolved, request_id),
    )


def _describe(row: dict[str, Any]) -> str:
    """One sentence about a study, from what the engine recorded about it."""
    issues = [str(issue) for issue in (row.get("issues") or []) if str(issue).strip()]
    if row.get("error"):
        stage = row.get("error_stage") or "an earlier stage"
        return f"Failed at {stage}: {row['error']}"
    if issues:
        return "; ".join(issues[:3])
    title = (row.get("title") or "").strip()
    return title or "No further detail was recorded."


def drain(conn, limit: int = 10) -> dict:
    """
    Take the queued console requests and put them through the ordinary path.

    `runner.request` is what a request has always meant: record the accession as
    explicitly requested, so the text classifier cannot reject it on its summary
    alone, then plan it. The plan still has to infer the design, and a study
    whose design is ambiguous goes to review exactly as a discovered one does.
    A requester is telling us it is a screen, which is better evidence than an
    abstract; it is not permission to skip the gate that spends compute.
    """
    from . import runner

    rows = conn.execute(
        "select id::text, accession from public.screen_requests "
        "where status = 'queued' order by created_at limit %s", (limit,)
    ).fetchall()

    handled: list[dict] = []
    for request_id, accession in rows:
        try:
            out = runner.request(accession)
        except Exception as exc:  # noqa: BLE001 - one bad request must not stop the queue
            #  The exception goes to the engine's own log, where somebody can
            #  act on it. What the researcher is shown is a sentence: a
            #  traceback in the console tells them nothing they can do, and
            #  "KeyError: 'accession'" reads as their mistake rather than ours.
            state.event(conn, None, "request", "error",
                        f"{accession}: {type(exc).__name__}: {exc}")
            _set(conn, request_id, "failed",
                 "SplicR could not look this accession up. The engine recorded why; "
                 "nothing was analysed. Try again, or check the accession is public.")
            handled.append({"accession": accession, "status": "failed"})
            continue

        if out.get("error"):
            _set(conn, request_id, "rejected", str(out["error"]))
            handled.append({"accession": accession, "status": "rejected"})
            continue

        resolved = out.get("accession") or accession
        row = conn.execute(
            "select status, title, issues, error, error_stage from ingest.studies where accession = %s",
            (resolved,),
        ).fetchone()
        if row is None:
            # `request` returned without an error and without a row, which is a
            # bug rather than a verdict about the study. Say so plainly.
            _set(conn, request_id, "failed",
                 "The engine accepted the accession but recorded no study for it.", resolved)
            handled.append({"accession": accession, "status": "failed"})
            continue

        fields = dict(zip(["status", "title", "issues", "error", "error_stage"], row))
        status = _FROM_STUDY.get(str(fields["status"]), "accepted")
        _set(conn, request_id, status, _describe(fields), resolved)
        handled.append({"accession": accession, "resolved": resolved, "status": status})

    if handled:
        state.event(conn, None, "request", "ok",
                    f"{len(handled)} console request(s) handled", {"requests": handled})
    return {"handled": handled}


def refresh(conn, limit: int = 100) -> dict:
    """
    Carry the study's current status back onto requests already accepted.

    A request moves on because the study did - a sweep planned it, processed it,
    sent it to review - and nothing in that path knows a workspace is watching.
    This is the only place that join is made, and it reads; it never moves a
    study.
    """
    rows = conn.execute(
        """
        select r.id::text, s.status, s.title, s.issues, s.error, s.error_stage
          from public.screen_requests r
          join ingest.studies s on s.accession = coalesce(r.resolved_accession, r.accession)
         where r.status in ('accepted', 'needs_review')
         order by r.updated_at
         limit %s
        """,
        (limit,),
    ).fetchall()

    moved = 0
    for request_id, status, title, issues, error, error_stage in rows:
        mapped = _FROM_STUDY.get(str(status), "accepted")
        _set(conn, request_id, mapped,
             _describe({"title": title, "issues": issues, "error": error, "error_stage": error_stage}))
        moved += 1
    return {"refreshed": moved}
