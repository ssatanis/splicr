"""
Discovery parsing, de-duplication and the screen classifier, offline.

Every fixture under tests/fixtures/ingest is a recorded response from the real
API (NCBI E-utilities, ENA Portal, GEO), so these tests check the parsers
against what the archives actually return, without the network. The one
network test at the bottom is marked and skipped by default.
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

import pytest

from splicr.ingest import classify as cl
from splicr.ingest import discover as d
from splicr.ingest.models import StudyCandidate

FIX = Path(__file__).parent / "fixtures" / "ingest"
ARTIFACTS = Path(__file__).resolve().parents[2] / "research" / "artifacts" / "ingest"
# ingest.studies.accession check constraint, verbatim.
DB_ACCESSION = re.compile(r"^(GSE[0-9]+|PRJ[EDN][A-Z][0-9]+|[SED]RP[0-9]+)$")


def _gds() -> dict[str, dict]:
    return {x["accession"]: x for x in json.loads((FIX / "gds_esummary.json").read_text())}


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def test_gds_record_parses_to_candidate_with_links():
    c = d.candidate_from_gds(_gds()["GSE145743"])
    assert c.accession == "GSE145743" and c.source == "geo"
    assert c.xrefs == {"geo": "GSE145743", "bioproject": "PRJNA608032", "sra_study": "SRP250346"}
    # GEO files the plasmid pool as "synthetic construct"; the study organism is human.
    assert c.taxid == 9606 and c.organism == "Homo sapiens"
    assert c.first_public == "2020-08-01"
    assert "GeCKO-A plasmid library" in c.sample_titles


def test_sra_experiments_group_to_one_study_keyed_by_bioproject():
    docs = json.loads((FIX / "sra_esummary_SRP250346.json").read_text())
    cands = d.candidates_from_sra(docs)
    assert len(cands) == 1
    c = cands[0]
    assert c.accession == "PRJNA608032"
    assert c.xrefs["sra_study"] == "SRP250346"
    assert c.library_strategies == ["OTHER"]
    # The GEO prefix "GSMnnn: " is stripped from experiment titles.
    assert all(not t.startswith("GSM") for t in c.sample_titles)


def test_ena_rows_prefer_gse_when_the_study_is_in_geo():
    rows = {r["study_accession"]: r for r in json.loads((FIX / "ena_study_rows.json").read_text())}
    geo = d.candidate_from_ena(rows["PRJNA608032"])
    assert geo.accession == "GSE145743" and geo.xrefs["bioproject"] == "PRJNA608032"
    ena_only = d.candidate_from_ena(rows["PRJEB101799"])
    assert ena_only.accession == "PRJEB101799"
    assert DB_ACCESSION.match(ena_only.accession)


def test_merge_collapses_geo_sra_ena_records_of_one_study():
    geo = d.candidate_from_gds(_gds()["GSE145743"])
    sra = d.candidates_from_sra(json.loads((FIX / "sra_esummary_SRP250346.json").read_text()))[0]
    ena = d.candidate_from_ena({r["study_accession"]: r for r in
                                json.loads((FIX / "ena_study_rows.json").read_text())}["PRJNA608032"])
    merged = d.merge([sra, ena, geo])
    assert len(merged) == 1
    m = merged[0]
    assert m.accession == "GSE145743"
    assert m.source == "geo"                       # GEO's text wins
    assert m.xrefs["bioproject"] == "PRJNA608032" and m.xrefs["sra_study"] == "SRP250346"
    assert m.library_strategies == ["OTHER"]       # carried over from SRA


def test_merge_chains_ids_no_single_record_has_all_of():
    a = StudyCandidate("GSE1", "geo", "t", xrefs={"geo": "GSE1", "bioproject": "PRJNA1"})
    b = StudyCandidate("SRP9", "sra", "t", xrefs={"sra_study": "SRP9", "bioproject": "PRJNA1"})
    c = StudyCandidate("PRJEB5", "ena", "other study", xrefs={"bioproject": "PRJEB5"})
    merged = {x.accession: x for x in d.merge([a, b, c])}
    assert set(merged) == {"GSE1", "PRJEB5"}
    assert merged["GSE1"].xrefs["sra_study"] == "SRP9"


def test_canonical_accessions_satisfy_the_database_constraint():
    for doc in _gds().values():
        assert DB_ACCESSION.match(d.candidate_from_gds(doc).accession)
    assert d._canonical({"sra_study": "DRP019488"}, "x") == "DRP019488"
    assert d._canonical({"bioproject": "PRJDB39803"}, "x") == "PRJDB39803"


# ---------------------------------------------------------------------------
# Classifier behaviour on real records
# ---------------------------------------------------------------------------

def test_a_real_pooled_screen_is_a_screen():
    c = cl.classify(d.candidate_from_gds(_gds()["GSE145743"]))
    assert c.verdict == "screen" and c.score >= cl.SCREEN_AT
    assert any("plasmid" in r for r in c.reasons)


def test_superseries_is_never_a_screen():
    c = cl.classify(d.candidate_from_gds(_gds()["GSE130414"]))
    assert c.verdict == "not_screen"
    assert any("SuperSeries" in r for r in c.reasons)


def test_single_cell_crispr_readout_is_maybe_with_reason():
    c = cl.classify(d.candidate_from_gds(_gds()["GSE119450"]))    # CROP-seq in primary T cells
    assert c.verdict == "maybe"
    assert any("single-cell" in r for r in c.reasons)


def test_rna_seq_subseries_of_a_screen_paper_is_not_called_a_screen():
    # The summary describes the paper's screen; the samples are RNA-seq of single knockouts.
    c = cl.classify(d.candidate_from_gds(_gds()["GSE125403"]))
    assert c.verdict != "screen"


def test_chip_subseries_with_screen_summary_is_capped_below_screen():
    c = cl.classify(d.candidate_from_gds(_gds()["GSE243456"]))
    assert c.verdict != "screen"


def test_unsupported_organism_is_recorded_as_not_screen():
    base = d.candidate_from_gds(_gds()["GSE145743"])
    fly = StudyCandidate.from_dict(base.__dict__ | {"taxid": 7227, "organism": "Drosophila melanogaster"})
    c = cl.classify(fly)
    assert c.verdict == "not_screen"
    assert any("unsupported organism" in r for r in c.reasons)


def test_every_reason_carries_its_weight():
    c = cl.classify(d.candidate_from_gds(_gds()["GSE130413"]))
    weighted = [r for r in c.reasons if re.match(r"^[+-]\d+\.\d ", r)]
    assert weighted, "reasons must show the weight each rule contributed"


def test_score_and_verdict_stay_within_database_bounds():
    for doc in _gds().values():
        c = cl.classify(d.candidate_from_gds(doc))
        assert 0.0 <= c.score <= 1.0
        assert c.verdict in ("screen", "maybe", "not_screen")


# ---------------------------------------------------------------------------
# The recorded evaluation reproduces
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not (ARTIFACTS / "labels.csv").exists(), reason="evaluation artifacts not present")
def test_recorded_classifier_evaluation_reproduces():
    recorded = json.loads((ARTIFACTS / "classifier_eval.json").read_text())
    now = cl.evaluate(str(ARTIFACTS / "labels.csv"), str(ARTIFACTS / "classifier_inputs.json.gz"))
    assert now["n"] >= 200
    for split in ("train", "test"):
        for q in ("screen", "screen_or_maybe"):
            assert now[split][q] == recorded[split][q], f"{split}/{q} drifted from classifier_eval.json"
    labels = [l for l in (ARTIFACTS / "labels.csv").read_text().splitlines()[1:] if l]
    assert sum(",screen," in l for l in labels) >= 100
    assert sum(",not_screen," in l for l in labels) >= 100


# ---------------------------------------------------------------------------
# Live
# ---------------------------------------------------------------------------

@pytest.mark.network
def test_discover_live_returns_classified_valid_candidates():
    cands = d.discover(date(2026, 9, 20), date(2026, 9, 29))
    assert cands, "a ten-day window with no CRISPR-related deposits at all would be surprising"
    for c in cands:
        assert DB_ACCESSION.match(c.accession), c.accession
        assert c.verdict in ("screen", "maybe", "not_screen") and 0 <= c.score <= 1
    assert len({c.accession for c in cands}) == len(cands)
