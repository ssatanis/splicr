"""The public PMC agent contract covers JSON, XML, and manual review."""

from splicr.ingest.models import RunRecord, SampleRole, StudyPlan
from splicr.pmc_agent import StudyDesignPlan, needs_context, resolve_from_payload


def _plan() -> StudyPlan:
    runs = [
        RunRecord(run="SRR100", sample_title="plasmid", fastq_urls=["https://x/100"]),
        RunRecord(run="SRR101", sample_title="DMSO", fastq_urls=["https://x/101"]),
        RunRecord(run="SRR102", sample_title="olaparib", fastq_urls=["https://x/102"]),
    ]
    return StudyPlan(
        accession="GSE145743",
        taxid=9606,
        runs=runs,
        roles=[SampleRole(run=r.run, label=r.sample_title, role="exclude", confidence=0.2) for r in runs],
        cell_line_rrid="CVCL_0030",
        library_hint="GeCKOv2",
        confidence=0.4,
        status="needs_review",
        issues=["no valid contrast could be built from the inferred roles"],
    )


def _bioc(text: str):
    return [{"documents": [{"id": "1", "passages": [
        {"infons": {"section_type": "METHODS", "type": "title"}, "text": "Methods"},
        {"infons": {"section_type": "METHODS", "type": "paragraph"}, "text": text},
    ]}]}]


def test_json_methods_emits_strict_study_design_plan():
    plan = _plan()
    out = resolve_from_payload(
        plan,
        "PMC123",
        _bioc("SRR100 was plasmid DNA. SRR101 received DMSO vehicle. SRR102 was treated with olaparib."),
    )
    assert out.status == "resolved"
    assert isinstance(out.override, StudyDesignPlan)
    assert out.override.model_dump() == {
        "accession": "GSE145743",
        "confidence": 0.99,
        "source": "pmc_methods_extraction",
        "pmcid": "PMC123",
        "contrasts": [{
            "name": "treatment_vs_control",
            "control_samples": ["SRR100", "SRR101"],
            "treatment_samples": ["SRR102"],
            "cell_line": "CVCL_0030",
            "library": "GeCKOv2",
        }],
    }
    assert plan.status == "ready"


def test_jats_xml_methods_is_supported():
    plan = _plan()
    xml = """<article><body><sec><title>Materials and methods</title>
      <p>SRR100 was the plasmid pool. SRR101 was the untreated vehicle control.
      SRR102 was treated with olaparib for 14 days.</p></sec></body></article>"""
    out = resolve_from_payload(plan, "PMC456", xml)
    assert out.status == "resolved"
    assert out.override and out.override.pmcid == "PMC456"


def test_incomplete_methods_routes_to_manual_review_without_mutation():
    plan = _plan()
    before = plan.to_json()
    out = resolve_from_payload(plan, "PMC789", _bioc("SRR101 was the DMSO vehicle control."))
    assert out.status == "manual_review"
    assert out.override is None
    assert "SRR100" in out.reason and "SRR102" in out.reason
    assert plan.to_json() == before


def test_only_low_confidence_plans_trigger_the_agent():
    plan = _plan()
    assert needs_context(plan)
    plan.confidence = 0.9
    assert not needs_context(plan)
