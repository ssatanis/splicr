"""
Publish a fitted network to the database the console reads.

WHAT GETS PUBLISHED AND WHAT DOES NOT

The model does not. The cohort is the asset and the model is a function of it,
so what goes into `validation_models` is the manifest, the metrics measured on
laboratories the model never saw, and the hash of the cohort it was fitted on.
Anybody holding that cohort can refit and get the same head version, which is
what makes a published claim checkable rather than merely asserted.

Every stratum goes into `validation_coverage`, open or shut, with the floors it
was judged against recorded on the row. A row read a year from now says what bar
applied when it was written, which a reader cannot reconstruct from a threshold
constant that has since moved.

WHY PUBLISHING IS A SEPARATE STEP

Fitting is cheap and happens on every pipeline run. Promoting a fit to
`is_current` changes what the console tells every user about what SplicR can
claim, so it is a deliberate command with a dry run, not a side effect of
analysis. The same argument the evidence gate makes about the public benchmark
snapshot.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Iterable

from .coverage import (
    MIN_STRATUM_LABS, MIN_STRATUM_OUTCOMES, MIN_STRATUM_SCREENS,
)
from .network import ValidationNetwork


@dataclass(frozen=True)
class Published:
    question: str
    version: str
    n_strata: int
    n_open: int
    promoted: bool

    def as_dict(self) -> dict:
        return {"question": self.question, "version": self.version,
                "n_strata": self.n_strata, "n_open": self.n_open,
                "promoted": self.promoted}


def publish(conn, network: ValidationNetwork, *, cohort_sha256: str | None,
            promote: bool = False, org_id: str | None = None,
            notes: str | None = None) -> list[Published]:
    """
    Write each fitted head and its coverage. `promote` makes them current.

    Idempotent on the head's content-addressed version: publishing the same fit
    twice updates the row rather than accumulating duplicates, because the
    version is a hash of the model, the calibrator, the feature spec and the
    cohort size, and two rows with one version would be the same claim stored
    twice.
    """
    out: list[Published] = []
    for question, head in sorted(network.heads.items()):
        payload = head.as_dict()
        evaluation = payload.get("evaluation") or {}
        test = evaluation.get("test") or {}
        holdout = evaluation.get("holdout") or {}
        coverage = payload.get("coverage") or {}
        strata = coverage.get("strata") or []

        conn.execute(
            """
            insert into public.validation_models (
              version, question, algorithm, calibrator, calibration_source,
              cohort_sha256, feature_spec_sha256,
              n_outcomes, n_decided, n_labs, n_train, n_calibration, n_test,
              test_labs, brier, brier_base_rate, log_loss, ece,
              calibration_slope, calibration_intercept, beats_base_rate,
              evidenced_low, evidenced_high, reliability_bins, manifest,
              is_current, org_id, notes
            ) values (
              %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
              %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s
            )
            on conflict (version) do update set
              is_current = excluded.is_current,
              reliability_bins = excluded.reliability_bins,
              manifest = excluded.manifest,
              notes = excluded.notes
            """,
            (
                head.version, question, payload.get("model"),
                (evaluation.get("calibration") or {}).get("chosen"),
                evaluation.get("calibration_source") or "",
                cohort_sha256, payload["model_manifest"]["feature_spec_hash"],
                payload.get("n_outcomes"), payload.get("n_decided"),
                payload.get("n_labs"),
                evaluation.get("n_train"), evaluation.get("n_calibration"),
                evaluation.get("n_test"),
                list(holdout.get("test_groups") or []),
                test.get("brier"), test.get("brier_base_rate"),
                test.get("log_loss"), test.get("ece"),
                (test.get("fit") or {}).get("slope"),
                (test.get("fit") or {}).get("intercept"),
                test.get("beats_base_rate"),
                payload.get("evidenced_low"), payload.get("evidenced_high"),
                json.dumps(test.get("bins") or []),
                json.dumps(payload.get("model_manifest") or {}),
                promote, org_id, notes,
            ),
        )

        if promote:
            #  One current head per question per scope. Demote the previous one
            #  in the same statement the new one is promoted by, so the partial
            #  unique index never sees two.
            conn.execute(
                """
                update public.validation_models
                   set is_current = false
                 where question = %s
                   and version <> %s
                   and (org_id is not distinct from %s)
                """,
                (question, head.version, org_id),
            )

        conn.execute(
            "delete from public.validation_coverage where model_version = %s",
            (head.version,))
        rows = []
        for stratum in strata:
            key = stratum.get("stratum") or {}
            rows.append((
                str(uuid.uuid4()), head.version, question,
                stratum.get("key"), key.get("assay_class"),
                key.get("modality"), key.get("phenotype_family"),
                key.get("model_type"), stratum.get("describe") or "",
                stratum.get("n_decided", 0), stratum.get("n_validated", 0),
                stratum.get("n_failed", 0), stratum.get("n_inconclusive", 0),
                stratum.get("n_pending", 0), stratum.get("n_labs", 0),
                stratum.get("n_studies", 0), stratum.get("n_screens", 0),
                bool(stratum.get("open")), list(stratum.get("shortfall") or []),
                MIN_STRATUM_OUTCOMES, MIN_STRATUM_LABS, MIN_STRATUM_SCREENS,
            ))
        if rows:
            with conn.cursor().copy(
                "copy public.validation_coverage "
                "(id, model_version, question, stratum_key, assay_class, modality, "
                " phenotype_family, model_type, describe, n_decided, n_validated, "
                " n_failed, n_inconclusive, n_pending, n_labs, n_studies, n_screens, "
                " is_open, shortfall, min_outcomes, min_labs, min_screens) from stdin"
            ) as copy:
                for row in rows:
                    copy.write_row(row)

        out.append(Published(
            question, head.version, len(strata),
            sum(1 for s in strata if s.get("open")), promote))
    return out


def retract(conn, questions: Iterable[str] | None = None,
            org_id: str | None = None) -> int:
    """
    Stop claiming a question is calibrated.

    Nothing is deleted: the fit and its metrics stay on record, and only
    `is_current` moves. A published claim that turns out to rest on a bad cohort
    has to be withdrawable without erasing the evidence that it was ever made.
    """
    if questions is None:
        result = conn.execute(
            "update public.validation_models set is_current = false "
            " where is_current and (org_id is not distinct from %s)", (org_id,))
    else:
        result = conn.execute(
            "update public.validation_models set is_current = false "
            " where is_current and question = any(%s) "
            "   and (org_id is not distinct from %s)",
            (list(questions), org_id))
    return result.rowcount or 0
