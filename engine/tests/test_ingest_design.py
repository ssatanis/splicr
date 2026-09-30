"""
Run metadata parsing and design inference, offline, on recorded real studies.

The costly error here is a plan marked "ready" that is wrong: it runs
unattended and publishes a gene list with the design upside down. So most of
these tests are about the planner declining: two cell lines, an unnamed arm, a
reference that could belong to either of two arms. GSE145743 is the positive
control, checked against the hand-built sample sheet in data/testdata, not
against this module's own output.
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

import pytest

from splicr.design import build_design
from splicr.ingest import design as dz
from splicr.ingest import metadata as md
from splicr.ingest.models import RunRecord, StudyCandidate, StudyPlan

FIX = Path(__file__).parent / "fixtures" / "ingest"
SAMPLE_SHEET = Path(__file__).resolve().parents[2] / "data" / "testdata" / "GSE145743" / "metadata" / "sample_sheet.tsv"
SAFE_LABEL = re.compile(r"^[A-Za-z0-9._-]+$")


def _gse145743() -> tuple[StudyCandidate, list[RunRecord], dict]:
    rows = md.parse_tsv((FIX / "filereport_PRJNA608032.tsv").read_text())
    runs = [md.run_from_filereport(r) for r in rows]
    samples = {a: r for a, r in md.parse_soft((FIX / "geo_soft_GSE145743_gsm.txt").read_text()).items()
               if r["kind"] == "sample"}
    md.join_geo(runs, samples)
    md._restore_ena(runs, rows)
    s = md.parse_soft((FIX / "geo_soft_GSE145743_self.txt").read_text())["GSE145743"]
    series = {"title": s["title"], "summary": " ".join(s["summary"]),
              "overall_design": " ".join(s["overall_design"]), "supplementary": s["supplementary"]}
    cand = StudyCandidate("GSE145743", "geo", s["title"], summary=series["summary"], taxid=9606,
                          organism="Homo sapiens", xrefs={"geo": "GSE145743", "bioproject": "PRJNA608032"})
    return cand, sorted(runs, key=lambda r: r.run), series


def _recorded(acc: str) -> tuple[StudyCandidate, list[RunRecord], dict]:
    v = json.loads((FIX / "planner_inputs.json").read_text())[acc]
    return (StudyCandidate.from_dict(v["candidate"]), [RunRecord.from_dict(r) for r in v["runs"]], v["series"])


def _assert_contrasts_validate(plan: StudyPlan) -> None:
    roles = {r.label: r.role for r in plan.roles if r.role != "exclude"}
    for c in plan.contrasts:
        build_design(list(roles), roles, c.treatment, c.control)   # raises on anything invalid


def _assert_labels_safe(plan: StudyPlan) -> None:
    labels = [r.label for r in plan.roles]
    assert len(labels) == len(set(labels)), "labels must be unique within a study"
    assert all(SAFE_LABEL.match(l) for l in labels), labels


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------

def test_filereport_rows_become_https_runs_with_checksums():
    rows = md.parse_tsv((FIX / "filereport_PRJNA608032.tsv").read_text())
    runs = [md.run_from_filereport(r) for r in rows]
    assert len(runs) == 12
    for r in runs:
        assert r.fastq_urls and all(u.startswith("https://ftp.sra.ebi.ac.uk/") for u in r.fastq_urls)
        assert len(r.fastq_md5) == len(r.fastq_urls) == len(r.fastq_bytes)
        assert re.fullmatch(r"GSM\d+", r.geo_sample or ""), "GEO-brokered runs carry the GSM in sample_alias"


def test_paired_runs_list_only_read_one():
    rows = md.parse_tsv((FIX / "filereport_GSE232614_paired.tsv").read_text())
    runs = [md.run_from_filereport(r) for r in rows]
    assert runs and all(r.library_layout == "PAIRED" for r in runs)
    for r in runs:
        assert len(r.fastq_urls) == 1 and r.fastq_urls[0].endswith("_1.fastq.gz")
        assert len(r.fastq_md5) == 1


def test_geo_characteristics_are_joined_by_gsm():
    _, runs, _ = _gse145743()
    by = {r.run: r for r in runs}
    assert by["SRR11144449"].sample_title == "GeCKO-A input control, Day 0"
    assert by["SRR11144449"].characteristics["treatment"] == "Input"
    assert by["SRR11144449"].characteristics["library"] == "A"
    assert by["SRR11144449"].characteristics["ena_tax_id"] == "9606"


def test_supplementary_count_table_is_found_from_series_soft():
    _, _, series = _gse145743()
    tables = [u for u in series["supplementary"] if md._COUNT_TABLE.search(u.rsplit("/", 1)[-1])]
    assert tables == ["https://ftp.ncbi.nlm.nih.gov/geo/series/GSE145nnn/GSE145743/suppl/"
                      "GSE145743_my_counts_anno_merged.txt.gz"]


# ---------------------------------------------------------------------------
# GSE145743: the known design
# ---------------------------------------------------------------------------

EXPECTED_ROLE = {"plasmid": "plasmid", "T0_input": "reference", "DMSO": "control", "olaparib": "treatment"}


def test_gse145743_plan_is_ready_and_matches_the_hand_built_sample_sheet():
    cand, runs, series = _gse145743()
    plan = dz.plan_study(cand, runs, series=series)
    assert plan.status == "ready", plan.issues
    assert plan.issues == []
    roles = {r.run: r for r in plan.roles}
    with open(SAMPLE_SHEET) as fh:
        sheet = list(csv.DictReader(fh, delimiter="\t"))
    assert len(sheet) == 12
    for row in sheet:
        r = roles[row["run_accession"]]
        assert r.role == EXPECTED_ROLE[row["arm"]], (row["run_accession"], row["arm"], r.role)
        assert r.library_part == row["half_library"]
        assert r.confidence >= dz.READY_CONFIDENCE

    kinds = sorted((c.kind, c.name) for c in plan.contrasts)
    assert [k for k, _ in kinds] == ["dropout", "dropout", "drug_modifier", "drug_modifier"]
    for c in plan.contrasts:
        parts = {roles_by_label.library_part for roles_by_label in plan.roles
                 if roles_by_label.label in c.treatment + c.control}
        assert len(parts) == 1, "a contrast never mixes half-libraries"
    drug = [c for c in plan.contrasts if c.kind == "drug_modifier"]
    for c in drug:
        assert all("Olaparib" in l for l in c.treatment) and all("DMSO" in l for l in c.control)
    dropout = [c for c in plan.contrasts if c.kind == "dropout"]
    for c in dropout:
        assert all("DMSO" in l for l in c.treatment) and all("input" in l for l in c.control)
    _assert_contrasts_validate(plan)
    _assert_labels_safe(plan)

    assert plan.modality == "knockout"
    assert plan.cell_line_rrid == "CVCL_0030"          # HeLa
    assert plan.compound_chembl == "CHEMBL521686"      # olaparib
    assert "geckov2" in (plan.library_hint or "")
    assert plan.supplementary_count_tables
    assert plan.taxid == 9606


def test_plan_round_trips_through_json():
    cand, runs, series = _gse145743()
    plan = dz.plan_study(cand, runs, series=series)
    again = StudyPlan.from_json(plan.to_json())
    assert again.roles[0].library_part == plan.roles[0].library_part
    assert [c.name for c in again.contrasts] == [c.name for c in plan.contrasts]


# ---------------------------------------------------------------------------
# Other recorded designs
# ---------------------------------------------------------------------------

def test_sort_screen_sorted_vs_unsorted_is_ready():
    plan = dz.plan_study(*_recorded("GSE242480")[:2], series=_recorded("GSE242480")[2])
    assert plan.status == "ready", plan.issues
    assert {c.kind for c in plan.contrasts} == {"sorting"}
    for c in plan.contrasts:
        assert all("Sorted" in l for l in c.treatment) and all("Unsorted" in l for l in c.control)
    _assert_contrasts_validate(plan)


def test_drug_screen_with_bracketed_submitter_ids_pairs_arms():
    cand, runs, series = _recorded("GSE130413")          # "DMSO day 14 [S2DMSOA9]"
    plan = dz.plan_study(cand, runs, series=series)
    assert plan.status == "ready", plan.issues
    assert {c.kind for c in plan.contrasts} == {"dropout", "drug_modifier"}
    assert plan.compound_chembl == "CHEMBL3137309"       # venetoclax


def test_two_cell_lines_are_never_ready_even_when_one_does_not_resolve():
    # iMAC (iPSC macrophages, not in Cellosaurus) + THP-1. Once shipped as ready
    # with THP-1's RRID on all six runs.
    plan = dz.plan_study(*_recorded("GSE216353")[:2], series=_recorded("GSE216353")[2])
    assert plan.status == "needs_review"
    assert plan.cell_line_rrid is None
    assert any("several cell lines" in i for i in plan.issues)


def test_arms_the_names_do_not_explain_block_readiness():
    plan = dz.plan_study(*_recorded("GSE139385")[:2], series=_recorded("GSE139385")[2])  # RTX-SEC, RTX-REC
    assert plan.status == "needs_review"
    unknown = [r for r in plan.roles if r.confidence < dz.READY_CONFIDENCE]
    assert {r.label for r in unknown} == {"RTX-SEC", "RTX-REC"}
    assert all(r.role == "exclude" and r.confidence == 0.0 for r in unknown)


def test_each_arm_is_compared_with_its_own_t0():
    # sgNeg and sgUHRF1 backgrounds each have their own T0; a context-free library
    # T0 exists too. Once shipped comparing both T1 arms against the library T0.
    plan = dz.plan_study(*_recorded("GSE233401")[:2], series=_recorded("GSE233401")[2])
    for c in plan.contrasts:
        bg = "sgNeg" if "sgNeg" in c.treatment[0] else "sgUHRF1"
        assert all(bg in l for l in c.control), (c.name, c.control)
        assert all("T0" in l for l in c.control) and all("T1" in l for l in c.treatment)


def test_high_low_outside_a_sorting_study_is_not_a_sort_bin():
    # GSE139313: "Low"/"High" are two NK-pressure screens, not FACS bins.
    plan = dz.plan_study(*_recorded("GSE139313")[:2], series=_recorded("GSE139313")[2])
    assert "sorting" not in {c.kind for c in plan.contrasts}
    for c in plan.contrasts:
        screen = "Low" if c.treatment[0].startswith("Low") else "High"
        assert all(l.startswith(screen) for l in c.treatment + c.control)
    assert plan.status == "needs_review"


# ---------------------------------------------------------------------------
# Hard stops
# ---------------------------------------------------------------------------

def _cand(**kw) -> StudyCandidate:
    return StudyCandidate(**({"accession": "PRJNA1", "source": "sra", "title": "CRISPR screen"} | kw))


def test_no_runs_is_unsupported():
    plan = dz.plan_study(_cand(), [], series={})
    assert plan.status == "unsupported"
    assert any("no raw reads" in i for i in plan.issues)


def test_single_cell_readout_is_unsupported():
    runs = [RunRecord(run="SRR1", sample_title="10x lane 1", fastq_urls=["https://x/SRR1_1.fastq.gz"],
                      fastq_md5=["a"], fastq_bytes=[1])]
    plan = dz.plan_study(_cand(title="Perturb-seq of K562"), runs, series={})
    assert plan.status == "unsupported"


def test_unsupported_organism_from_ena_is_unsupported_even_if_geo_said_synthetic_construct():
    runs = [RunRecord(run=f"SRR{i}", sample_title=t, fastq_urls=[f"https://x/SRR{i}.fastq.gz"],
                      fastq_md5=["a"], fastq_bytes=[1],
                      characteristics={"ena_tax_id": "4952", "ena_scientific_name": "Yarrowia lipolytica"})
            for i, t in enumerate(["plasmid", "day 0", "furfural day 7"])]
    plan = dz.plan_study(_cand(taxid=None), runs, series={})
    assert plan.status == "unsupported"
    assert any("unsupported organism" in i for i in plan.issues)


def test_duplicate_titles_get_unique_safe_labels():
    runs = [RunRecord(run=f"SRR{i}", sample_title="DMSO / day 14 (rep?)", fastq_urls=[f"https://x/{i}.fq.gz"],
                      fastq_md5=["a"], fastq_bytes=[1], geo_sample=f"GSM{i}") for i in range(3)]
    plan = dz.plan_study(_cand(), runs, series={})
    _assert_labels_safe(plan)


def test_single_end_run_with_several_files_blocks():
    runs = [RunRecord(run="SRR1", sample_title="plasmid", library_layout="SINGLE",
                      fastq_urls=["https://x/SRR1_1.fastq.gz", "https://x/SRR1_2.fastq.gz"],
                      fastq_md5=["a", "b"], fastq_bytes=[1, 1]),
            RunRecord(run="SRR2", sample_title="day 21", library_layout="SINGLE",
                      fastq_urls=["https://x/SRR2.fastq.gz"], fastq_md5=["c"], fastq_bytes=[1])]
    plan = dz.plan_study(_cand(), runs, series={})
    assert plan.status == "needs_review"
    assert any("single-end but has 2 FASTQ files" in i for i in plan.issues)


# ---------------------------------------------------------------------------
# Live
# ---------------------------------------------------------------------------

@pytest.mark.network
def test_fetch_runs_and_plan_gse145743_live():
    from splicr.ingest.__main__ import candidate_for

    cand = candidate_for("GSE145743")
    runs = md.fetch_runs(cand)
    assert len(runs) == 12 and all(r.geo_sample for r in runs)
    plan = dz.plan_study(cand, runs)
    assert plan.status == "ready", plan.issues
