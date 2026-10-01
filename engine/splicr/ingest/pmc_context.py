"""Resolve an uncertain screen design from the paper's PMC Methods section.

This module is deliberately evidence-bound.  It downloads PMC Open Access
full text in BioC JSON, reads only Methods/Experimental Procedure passages,
and assigns a run only when that passage names one of the deposited sample
accessions (or its exact deposited title) next to an explicit plasmid, day-0,
or treatment phrase.  It never invents an accession and it never returns a
ready resolution when an included run is unassigned or contradictory.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Literal

import requests
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .models import Contrast, RunRecord, SampleRole, StudyCandidate, StudyPlan

PMC_BIOC = "https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi/BioC_json/{id}/unicode"
ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
UA = "SplicR-context/1.0 (mailto:ss4497@cornell.edu)"
SCHEMA_VERSION = "1.0"
CONTEXT_THRESHOLD = 0.90

Role = Literal["plasmid", "reference", "treatment"]
Status = Literal["resolved", "insufficient_evidence", "not_found"]

ACCESSION = re.compile(r"\b(?:[SED]RR\d+|[SED]RX\d+|[SED]RS\d+|SAM[NED]\d+|GSM\d+)\b", re.I)
METHOD_SECTION = re.compile(r"method|materials?|experimental procedures?|screening procedure|cell culture", re.I)
PLASMID = re.compile(r"\b(?:plasmid|pDNA|library\s+(?:pool|DNA)|input\s+library)\b", re.I)
REFERENCE = re.compile(
    r"\b(?:day[\s_-]*0|d0|t0|time[\s_-]*0|baseline|initial|pre[-\s]?(?:selection|treatment)|"
    r"input\s+(?:cells?|sample)|reference|untreated|vehicle|mock(?:[-\s]treated)?|DMSO)\b", re.I
)
TREATMENT = re.compile(
    r"\b(?:treated|treatment|selected|selection|endpoint|survivors?|sorted|stimulated|infected|"
    r"day[\s_-]*(?:[1-9]\d*)|d(?:[1-9]\d*)|time[\s_-]*(?:[1-9]\d*))\b", re.I
)
CLAUSE = re.compile(r"(?<=[.;])\s+|\s+(?:whereas|while|but)\s+", re.I)


class SampleAssignment(BaseModel):
    """One accession-to-role claim supported by one Methods clause."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    sample_accession: str = Field(pattern=r"^(?:[SED]RR\d+|[SED]RX\d+|[SED]RS\d+|SAM[NED]\d+|GSM\d+)$")
    run_accession: str = Field(pattern=r"^[SED]RR\d+$")
    role: Role
    matched_by: Literal["accession", "sample_title"]
    evidence: str = Field(min_length=1, max_length=600)


class ContextResolution(BaseModel):
    """Strict JSON contract consumed by the deterministic planner."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    study_identifier: str
    pmcid: str = Field(default="", pattern=r"^(?:PMC\d+)?$")
    status: Status
    confidence: float = Field(ge=0.0, le=1.0)
    control_accessions: list[str]
    treatment_accessions: list[str]
    assignments: list[SampleAssignment]
    methods_passages: int = Field(ge=0)
    source_url: str = ""
    note: str = ""

    @model_validator(mode="after")
    def _resolved_is_complete(self):
        assigned = {a.run_accession for a in self.assignments}
        controls = set(self.control_accessions)
        treatments = set(self.treatment_accessions)
        if not controls <= assigned or not treatments <= assigned:
            raise ValueError("control/treatment accessions must be present in assignments")
        if controls & treatments:
            raise ValueError("an accession cannot be both control and treatment")
        if self.status == "resolved":
            if self.confidence < CONTEXT_THRESHOLD or not controls or not treatments:
                raise ValueError("resolved context needs >=0.90 confidence and both arms")
        return self

    def to_json(self) -> str:
        return self.model_dump_json(indent=2, exclude_none=False)


def _get(url: str, *, params: dict | None = None):
    headers = {"User-Agent": UA, "Accept": "application/json"}
    for attempt in range(3):
        response = requests.get(url, params=params, headers=headers, timeout=60)
        if response.status_code not in (429, 500, 502, 503, 504):
            response.raise_for_status()
            return response.json()
        if attempt < 2:
            delay = float(response.headers.get("Retry-After") or (2 ** attempt))
            time.sleep(min(delay, 10.0))
    response.raise_for_status()
    raise AssertionError("unreachable")


def _search_pmc(identifier: str) -> list[str]:
    """Return PMC IDs for a DOI, accession, PMID, or other exact identifier."""
    identifier = identifier.strip()
    if re.fullmatch(r"PMC\d+", identifier, re.I):
        return [identifier.upper()]
    if not identifier:
        return []
    if re.fullmatch(r"10\.\d{4,9}/\S+", identifier, re.I):
        term = f'"{identifier}"[DOI]'
    elif identifier.isdigit():
        term = f'"{identifier}"[PMID]'
    else:
        term = f'"{identifier}"[All Fields]'
    params = {"db": "pmc", "term": term, "retmode": "json", "retmax": 5,
              "tool": "splicr-context", "email": "ss4497@cornell.edu"}
    if os.environ.get("NCBI_API_KEY"):
        params["api_key"] = os.environ["NCBI_API_KEY"]
    data = _get(ESEARCH, params=params)
    return [f"PMC{x}" for x in data.get("esearchresult", {}).get("idlist", [])]


def _document(payload) -> dict | None:
    collections = payload if isinstance(payload, list) else [payload]
    for collection in collections:
        docs = collection.get("documents", []) if isinstance(collection, dict) else []
        if docs:
            return docs[0]
    return None


def methods_passages(payload) -> list[str]:
    """Extract only Methods-like BioC passages, preserving document order."""
    doc = _document(payload)
    if not doc:
        return []
    out = []
    in_methods = False
    for passage in doc.get("passages", []):
        text = " ".join(str(passage.get("text") or "").split())
        infons = passage.get("infons") or {}
        section = " ".join(str(infons.get(k) or "") for k in
                           ("section_type", "section", "title", "type"))
        ptype = str(infons.get("type") or "")
        if "title" in ptype.lower():
            in_methods = bool(METHOD_SECTION.search(text) or METHOD_SECTION.search(section))
        is_method = bool(METHOD_SECTION.search(section)) or in_methods
        if text and is_method:
            out.append(text)
    return out


def _aliases(run: RunRecord) -> dict[str, str]:
    return {
        str(value).upper(): run.run
        for value in (run.run, run.experiment, run.sample, run.geo_sample)
        if value
    }


def _role(clause: str) -> Role | None:
    hits = []
    if PLASMID.search(clause):
        hits.append("plasmid")
    if REFERENCE.search(clause):
        hits.append("reference")
    if TREATMENT.search(clause):
        hits.append("treatment")
    return hits[0] if len(set(hits)) == 1 else None


def parse_context(study_identifier: str, pmcid: str, payload, runs: list[RunRecord],
                  current_roles: list[SampleRole] | None = None) -> ContextResolution:
    """Map deposited sample accessions to roles from Methods evidence only."""
    passages = methods_passages(payload)
    by_alias: dict[str, str] = {}
    run_by_id = {r.run: r for r in runs}
    for run in runs:
        by_alias.update(_aliases(run))

    claims: dict[str, list[tuple[Role, str, str, str]]] = {}
    for passage in passages:
        for clause in CLAUSE.split(passage):
            role = _role(clause)
            if role is None:
                continue
            found: dict[str, tuple[str, str]] = {}
            for accession in ACCESSION.findall(clause):
                key = accession.upper()
                if key in by_alias:
                    found[by_alias[key]] = (key, "accession")
            lower = clause.casefold()
            for run in runs:
                title = " ".join(run.sample_title.split())
                if len(title) >= 4 and title.casefold() in lower:
                    found.setdefault(run.run, (run.geo_sample or run.sample or run.run, "sample_title"))
            evidence = clause.strip()[:600]
            for run_id, (sample_accession, matched_by) in found.items():
                claims.setdefault(run_id, []).append((role, evidence, sample_accession, matched_by))

    assignments = []
    contradictory = []
    for run_id in sorted(claims):
        roles = {c[0] for c in claims[run_id]}
        if len(roles) != 1:
            contradictory.append(run_id)
            continue
        role, evidence, sample_accession, matched_by = claims[run_id][0]
        assignments.append(SampleAssignment(
            sample_accession=sample_accession.upper(), run_accession=run_id,
            role=role, matched_by=matched_by, evidence=evidence,
        ))

    controls = sorted(a.run_accession for a in assignments if a.role in ("plasmid", "reference"))
    treatments = sorted(a.run_accession for a in assignments if a.role == "treatment")
    role_by_run = {r.run: r for r in current_roles or []}
    required = {
        r.run for r in runs if r.fastq_urls
        and not (role_by_run.get(r.run) and role_by_run[r.run].role == "exclude"
                 and role_by_run[r.run].confidence >= CONTEXT_THRESHOLD)
    }
    assigned = {a.run_accession for a in assignments}
    missing = sorted(required - assigned)
    exact = all(a.matched_by == "accession" for a in assignments)
    confidence = 0.99 if exact else 0.94
    status: Status = "resolved"
    notes = []
    if contradictory:
        status = "insufficient_evidence"
        notes.append("contradictory roles for " + ", ".join(contradictory))
    if missing:
        status = "insufficient_evidence"
        notes.append("Methods did not assign " + ", ".join(missing))
    if not controls or not treatments:
        status = "insufficient_evidence"
        notes.append("both a control and treatment accession were not identified")
    if not assignments:
        confidence = 0.0
    elif status != "resolved":
        confidence = min(confidence, 0.89)
    return ContextResolution(
        study_identifier=study_identifier, pmcid=pmcid, status=status,
        confidence=confidence, control_accessions=controls,
        treatment_accessions=treatments, assignments=assignments,
        methods_passages=len(passages), source_url=PMC_BIOC.format(id=pmcid),
        note="; ".join(notes),
    )


def resolve_context(candidate: StudyCandidate, plan: StudyPlan) -> ContextResolution:
    """Find the candidate's PMC article and return the first complete resolution."""
    identifiers = []
    for value in [candidate.xrefs.get("doi"), *candidate.pubmed_ids,
                  candidate.accession, *candidate.xrefs.values()]:
        if value and str(value) not in identifiers:
            identifiers.append(str(value))
    tried = []
    best = None
    for identifier in identifiers:
        for pmcid in _search_pmc(identifier):
            if pmcid in tried:
                continue
            tried.append(pmcid)
            try:
                payload = _get(PMC_BIOC.format(id=pmcid))
            except (requests.RequestException, ValueError):
                continue
            result = parse_context(candidate.accession, pmcid, payload, plan.runs, plan.roles)
            if result.status == "resolved":
                return result
            if best is None or result.confidence > best.confidence:
                best = result
    if best is not None:
        return best
    return ContextResolution(
        study_identifier=candidate.accession, status="not_found", confidence=0.0,
        control_accessions=[], treatment_accessions=[], assignments=[], methods_passages=0,
        note="no PMC Open Access full text matched the study identifiers",
    )


def apply_to_plan(plan: StudyPlan, result: ContextResolution) -> StudyPlan:
    """Overwrite role uncertainty only when the strict resolution is complete."""
    if result.status != "resolved" or result.confidence < CONTEXT_THRESHOLD:
        return plan
    by_run = {a.run_accession: a for a in result.assignments}
    for role in plan.roles:
        assignment = by_run.get(role.run)
        if assignment is None:
            continue
        role.role = assignment.role
        role.confidence = result.confidence
        role.evidence = [f"PMC Methods ({result.pmcid}): {assignment.evidence}"]

    by_run_role = {r.run: r for r in plan.roles}
    controls = list(dict.fromkeys(by_run_role[r].label for r in result.control_accessions))
    treatments = list(dict.fromkeys(by_run_role[r].label for r in result.treatment_accessions))
    plan.contrasts = [Contrast(name="pmc_treatment_vs_control", treatment=treatments,
                               control=controls, kind="dropout")]

    design_markers = (
        "no valid contrast", "run(s) have no confident role", "distinct sample contexts",
        "stratum ", "runs merged into one sample disagree on its role", "contrast ",
        "sorted runs at ", "no vehicle arm at the same time point",
    )
    plan.issues = [i for i in plan.issues if not any(m in i for m in design_markers)]
    plan.notes.append(
        f"PMC Methods resolved {len(controls)} control and {len(treatments)} treatment sample(s) "
        f"from {result.pmcid}; schema {result.schema_version}"
    )
    plan.confidence = result.confidence if not plan.issues else round(result.confidence * 0.6, 3)
    plan.status = "ready" if not plan.issues else "needs_review"
    return plan
