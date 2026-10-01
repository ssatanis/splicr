"""PMC Methods fallback for study designs the deterministic planner cannot settle.

The agent is intentionally narrow: it extracts sample roles from open-access
Methods text and emits a strict, machine-checkable override.  It does not
invent run accessions or promote an incomplete extraction.  Ambiguous or
unavailable papers are represented as a manual-review outcome instead.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .ingest.models import StudyCandidate, StudyPlan
from .ingest.pmc_context import (
    CONTEXT_THRESHOLD,
    ContextResolution,
    apply_to_plan,
    parse_context,
    resolve_context,
)


class StudyDesignContrast(BaseModel):
    """One fully identified experimental comparison."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    control_samples: list[str] = Field(min_length=1)
    treatment_samples: list[str] = Field(min_length=1)
    cell_line: str | None = None
    library: str | None = None


class StudyDesignPlan(BaseModel):
    """Strict override schema handed back to the deterministic planner."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    accession: str = Field(min_length=1)
    confidence: float = Field(ge=CONTEXT_THRESHOLD, le=1.0)
    source: Literal["pmc_methods_extraction"] = "pmc_methods_extraction"
    pmcid: str = Field(pattern=r"^PMC\d+$")
    contrasts: list[StudyDesignContrast] = Field(min_length=1)

    @model_validator(mode="after")
    def _disjoint_arms(self):
        for contrast in self.contrasts:
            if set(contrast.control_samples) & set(contrast.treatment_samples):
                raise ValueError("control and treatment samples must be disjoint")
        return self


class PmcAgentResult(BaseModel):
    """Outcome of the fallback, including the manual-review path."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    status: Literal["resolved", "manual_review"]
    override: StudyDesignPlan | None = None
    reason: str = ""
    pmcid: str = ""

    @model_validator(mode="after")
    def _resolved_has_override(self):
        if self.status == "resolved" and self.override is None:
            raise ValueError("a resolved PMC result requires an override")
        if self.status == "manual_review" and self.override is not None:
            raise ValueError("manual review cannot carry an override")
        return self


def needs_context(plan: StudyPlan) -> bool:
    """Whether the deterministic plan is below the unattended-run threshold."""
    return plan.status != "unsupported" and plan.confidence < CONTEXT_THRESHOLD


def _jats_to_bioc(xml: str) -> list[dict]:
    """Convert Methods-like JATS sections to the small BioC shape we parse."""
    root = ET.fromstring(xml)
    passages: list[dict] = []
    for section in root.findall(".//sec"):
        title_node = section.find("./title")
        title = " ".join("".join(title_node.itertext()).split()) if title_node is not None else ""
        if not any(word in title.casefold() for word in ("method", "material", "experimental procedure", "screening procedure")):
            continue
        passages.append({"infons": {"section_type": "METHODS", "type": "title"}, "text": title or "Methods"})
        for paragraph in section.findall("./p"):
            text = " ".join("".join(paragraph.itertext()).split())
            if text:
                passages.append({"infons": {"section_type": "METHODS", "type": "paragraph"}, "text": text})
    return [{"documents": [{"id": "jats", "passages": passages}]}]


def normalize_pmc_payload(payload: object) -> object:
    """Accept Europe PMC/PMC BioC JSON or JATS XML without weakening parsing."""
    if isinstance(payload, bytes):
        payload = payload.decode("utf-8")
    if isinstance(payload, str):
        return _jats_to_bioc(payload)
    return payload


def override_from_resolution(plan: StudyPlan, resolution: ContextResolution) -> StudyDesignPlan | None:
    """Translate a complete evidence resolution to the public override schema."""
    if resolution.status != "resolved" or resolution.confidence < CONTEXT_THRESHOLD:
        return None
    cell_line = plan.cell_line_rrid or plan.cell_line_raw
    library = plan.learned_library or plan.library_hint
    return StudyDesignPlan(
        accession=plan.accession,
        confidence=resolution.confidence,
        pmcid=resolution.pmcid,
        contrasts=[StudyDesignContrast(
            name="treatment_vs_control",
            control_samples=resolution.control_accessions,
            treatment_samples=resolution.treatment_accessions,
            cell_line=cell_line,
            library=library,
        )],
    )


def resolve_from_payload(plan: StudyPlan, pmcid: str, payload: object) -> PmcAgentResult:
    """Resolve a plan from a supplied BioC/JATS document (useful for tests and caches)."""
    resolution = parse_context(
        plan.accession,
        pmcid.upper(),
        normalize_pmc_payload(payload),
        plan.runs,
        plan.roles,
    )
    override = override_from_resolution(plan, resolution)
    if override is None:
        return PmcAgentResult(
            status="manual_review",
            reason=resolution.note or "PMC Methods did not identify every experimental arm",
            pmcid=resolution.pmcid,
        )
    apply_to_plan(plan, resolution)
    return PmcAgentResult(status="resolved", override=override, pmcid=resolution.pmcid)


def resolve(candidate: StudyCandidate, plan: StudyPlan) -> PmcAgentResult:
    """Look up open-access Methods text and return an override or manual review."""
    if not needs_context(plan):
        return PmcAgentResult(status="manual_review", reason="deterministic plan does not require PMC fallback")
    resolution = resolve_context(candidate, plan)
    override = override_from_resolution(plan, resolution)
    if override is None:
        return PmcAgentResult(
            status="manual_review",
            reason=resolution.note or "open-access Methods text remained ambiguous",
            pmcid=resolution.pmcid,
        )
    apply_to_plan(plan, resolution)
    return PmcAgentResult(status="resolved", override=override, pmcid=resolution.pmcid)
