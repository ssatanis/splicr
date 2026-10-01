"""PMC Methods context is evidence-bound and produces a strict plan override."""

import json

import pytest
from pydantic import ValidationError

from splicr.ingest.models import RunRecord, SampleRole, StudyPlan
from splicr.ingest.pmc_context import (ContextResolution, apply_to_plan, methods_passages,
                                       parse_context)


def _run(run, title, gsm):
    return RunRecord(run=run, geo_sample=gsm, sample_title=title,
                     fastq_urls=[f"https://example/{run}.fastq.gz"])


RUNS = [
    _run("SRR100", "library input", "GSM100"),
    _run("SRR101", "day 0 cells", "GSM101"),
    _run("SRR102", "day 21 cells", "GSM102"),
]


def _payload(method_text):
    return [{"documents": [{"id": "1", "passages": [
        {"infons": {"section_type": "INTRO", "type": "paragraph"},
         "text": "SRR999 was treated, but this is not Methods."},
        {"infons": {"section_type": "METHODS", "type": "title_1"}, "text": "Methods"},
        {"infons": {"section_type": "METHODS", "type": "paragraph"}, "text": method_text},
    ]}]}]


def test_methods_passages_excludes_non_methods_text():
    passages = methods_passages(_payload("SRR100 was the plasmid library."))
    assert passages == ["Methods", "SRR100 was the plasmid library."]


def test_explicit_accessions_resolve_control_and_treatment_with_strict_json():
    payload = _payload(
        "The plasmid library was sequenced as SRR100. SRR101 was collected at day 0. "
        "SRR102 was collected after treatment at day 21."
    )
    result = parse_context("GSE1", "PMC1", payload, RUNS)
    assert result.status == "resolved"
    assert result.confidence == 0.99
    assert result.control_accessions == ["SRR100", "SRR101"]
    assert result.treatment_accessions == ["SRR102"]
    assert json.loads(result.to_json())["schema_version"] == "1.0"


def test_missing_or_contradictory_run_never_resolves():
    payload = _payload(
        "SRR100 was the plasmid pool. SRR101 was collected at day 0. "
        "SRR101 was treated at day 21."
    )
    result = parse_context("GSE1", "PMC1", payload, RUNS)
    assert result.status == "insufficient_evidence"
    assert result.confidence < 0.90
    assert "SRR101" in result.note and "SRR102" in result.note


def test_schema_forbids_unknown_fields_and_incomplete_resolved_payloads():
    with pytest.raises(ValidationError):
        ContextResolution(study_identifier="GSE1", status="resolved", confidence=0.99,
                          control_accessions=[], treatment_accessions=[], assignments=[],
                          methods_passages=1, surprise=True)


def test_resolved_context_overwrites_roles_and_resumes_plan():
    result = parse_context(
        "GSE1", "PMC1",
        _payload("SRR100 was plasmid DNA. SRR101 was day 0. SRR102 was treated at day 21."),
        RUNS,
    )
    plan = StudyPlan(
        accession="GSE1", taxid=9606, runs=RUNS,
        roles=[SampleRole(run=r.run, label=r.sample_title.replace(" ", "_"), role="exclude",
                          confidence=0.2, evidence=["ambiguous metadata"]) for r in RUNS],
        confidence=0.1, status="needs_review",
        issues=["no valid contrast could be built from the inferred roles",
                "3 run(s) have no confident role, e.g. SRR100"],
    )
    apply_to_plan(plan, result)
    assert plan.status == "ready"
    assert [r.role for r in plan.roles] == ["plasmid", "reference", "treatment"]
    assert plan.contrasts[0].control == ["library_input", "day_0_cells"]
    assert plan.contrasts[0].treatment == ["day_21_cells"]
    assert plan.confidence == 0.99
