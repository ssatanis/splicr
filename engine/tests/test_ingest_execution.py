"""Execution stages of the ingest: fetch selection, FastQC reading, cross-check, count subsetting."""

from __future__ import annotations

import hashlib

import numpy as np
import pytest

from splicr.ingest import analyze, crosscheck, fetch
from splicr.ingest.models import (Contrast, FastqcReport, RunRecord, SampleRole, StudyCandidate,
                                  StudyPlan)


def test_models_round_trip_through_json():
    plan = StudyPlan(
        accession="GSE1", taxid=9606,
        runs=[RunRecord(run="SRR1", fastq_urls=["https://x/SRR1.fastq.gz"], fastq_md5=["a"], fastq_bytes=[1])],
        roles=[SampleRole(run="SRR1", label="t0", role="reference", confidence=0.9)],
        contrasts=[Contrast("dropout", treatment=["d21"], control=["t0"])], status="ready")
    back = StudyPlan.from_json(plan.to_json())
    assert back == plan
    assert isinstance(back.runs[0], RunRecord) and isinstance(back.contrasts[0], Contrast)
    c = StudyCandidate(accession="GSE1", source="geo", title="t", score=0.7, verdict="screen")
    assert StudyCandidate.from_json(c.to_json()) == c


def test_paired_run_counts_read_one_only(tmp_path, monkeypatch):
    got = []
    monkeypatch.setattr(fetch, "download", lambda url, dest, md5=None, size=None: got.append(url) or dest)
    run = RunRecord(run="SRR9", fastq_urls=["https://h/SRR9_2.fastq.gz", "https://h/SRR9_1.fastq.gz"],
                    fastq_md5=["b", "a"], fastq_bytes=[2, 1])
    fetch.fetch_run(run, tmp_path)
    assert got == ["https://h/SRR9_1.fastq.gz"]
    got.clear()
    fetch.fetch_run(run, tmp_path, with_mates=True)
    assert got == ["https://h/SRR9_1.fastq.gz", "https://h/SRR9_2.fastq.gz"]


def test_run_without_fastq_is_not_yet_available(tmp_path):
    with pytest.raises(fetch.NotYetAvailable):
        fetch.fetch_run(RunRecord(run="SRR1"), tmp_path)


def test_md5_mismatch_is_refused(tmp_path, monkeypatch):
    class Resp:
        status_code = 200
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def raise_for_status(self): pass
        def iter_content(self, n): yield b"ACGT\n"

    import requests
    monkeypatch.setattr(requests, "get", lambda *a, **k: Resp())
    with pytest.raises(fetch.ChecksumMismatch):
        fetch.download("https://h/x.fastq.gz", tmp_path / "x.fastq.gz", md5="0" * 32)
    good = hashlib.md5(b"ACGT\n").hexdigest()
    assert fetch.download("https://h/x.fastq.gz", tmp_path / "x.fastq.gz", md5=good).read_bytes() == b"ACGT\n"


def test_amplicon_fastqc_fails_that_are_expected_are_not_concerns():
    rep = FastqcReport(run="SRR1", file="f", modules={
        "Per base sequence quality": "PASS", "Per base sequence content": "FAIL",
        "Sequence Duplication Levels": "FAIL", "Overrepresented sequences": "FAIL", "Per base N content": "FAIL"})
    assert fetch.interpret(rep) == ["FastQC Per base N content: FAIL"]


def test_parse_fastqc(tmp_path):
    (tmp_path / "summary.txt").write_text("PASS\tBasic Statistics\tx.fq\nFAIL\tPer base sequence content\tx.fq\n")
    (tmp_path / "fastqc_data.txt").write_text(
        "##FastQC\t0.12.1\n>>Basic Statistics\tpass\nTotal Sequences\t12345\nSequence length\t50\n%GC\t48\n>>END_MODULE\n")
    rep = fetch.parse_fastqc(tmp_path, run="SRR1", file="x.fq")
    assert (rep.total_sequences, rep.sequence_length, rep.percent_gc) == (12345, "50", 48.0)
    assert rep.modules == {"Basic Statistics": "PASS", "Per base sequence content": "FAIL"}


def _deposited(rng, n=2000):
    ids = np.array([f"g{i}" for i in range(n)])
    base = rng.gamma(2.0, 200.0, size=(n, 3))
    return ids, ["plasmid", "DMSO1", "drug1"], base


def test_crosscheck_matches_samples_by_data_and_agrees():
    rng = np.random.default_rng(0)
    ids, names, mat = _deposited(rng)
    # Our recount of "DMSO1": same guides, Poisson noise, different depth, different name.
    ours = {"libA_vehicle_rep1": {g: int(v) for g, v in zip(ids, rng.poisson(mat[:, 1] * 1.7))},
            "libA_T0": {g: int(v) for g, v in zip(ids, rng.poisson(mat[:, 0] * 0.6))}}
    res = crosscheck.crosscheck(ours, (ids, names, mat))
    assert res["verdict"] == "agrees"
    assert res["samples"]["libA_vehicle_rep1"]["matched_column"] == "DMSO1"
    assert res["samples"]["libA_T0"]["matched_column"] == "plasmid"
    assert res["samples"]["libA_vehicle_rep1"]["spearman"] > 0.95


def test_crosscheck_reports_disagreement():
    rng = np.random.default_rng(1)
    ids, names, mat = _deposited(rng)
    unrelated = rng.gamma(2.0, 200.0, size=len(ids))
    res = crosscheck.crosscheck({"x": {g: int(v) for g, v in zip(ids, unrelated)}}, (ids, names, mat))
    assert res["verdict"] == "disagrees"


def test_crosscheck_without_shared_ids_is_not_comparable():
    rng = np.random.default_rng(2)
    ids, names, mat = _deposited(rng)
    res = crosscheck.crosscheck({"x": {"other": 1}}, (ids, names, mat))
    assert res["verdict"] == "not_comparable"


def test_subset_counts_keeps_guide_and_gene_columns(tmp_path):
    src = tmp_path / "c.txt"
    src.write_text("sgRNA\tGene\ta\tb\tc\ng1\tX\t1\t2\t3\ng2\tY\t4\t5\t6\n")
    out = analyze._subset_counts(src, tmp_path / "s" / "c.txt", ["c", "a"])
    assert out.read_text() == "sgRNA\tGene\tc\ta\ng1\tX\t3\t1\ng2\tY\t6\t4\n"


def test_publish_value_coercion_for_postgres():
    from splicr.ingest.publish import _int, _num
    assert _int(1.0) == 1 and _int(float("nan")) is None and _int(None) is None
    assert _num(float("nan")) is None and _num("x") is None and _num(0.25) == 0.25


def test_runs_of_one_sample_are_summed_not_replicated():
    from splicr.count import SampleCounts
    a = SampleCounts(label="d21_rep1", counts={"g1": 10, "g2": 5}, total_reads=20, mapped_exact=15, unmapped=5)
    b = SampleCounts(label="d21_rep1", counts={"g1": 3, "g3": 7}, total_reads=12, mapped_exact=10, unmapped=2)
    m = analyze.merge_runs([a, b])
    assert m.label == "d21_rep1"
    assert m.counts == {"g1": 13, "g2": 5, "g3": 7}
    assert (m.total_reads, m.mapped) == (32, 25)
    assert analyze.merge_runs([a]) is a


def test_ena_error_body_is_retried_not_parsed_as_a_run(monkeypatch):
    from splicr.ingest import metadata

    class R:
        def __init__(self, text): self.text = text
    bodies = iter(["ERROR occurred. Not all results may have been written. Query: {...}\n",
                   "run_accession\tfastq_ftp\nSRR1\tftp.sra.ebi.ac.uk/x/SRR1.fastq.gz\n"])
    monkeypatch.setattr(metadata, "http_get", lambda *a, **k: R(next(bodies)))
    monkeypatch.setattr(metadata.time, "sleep", lambda s: None)
    rows = metadata.filereport("PRJNA1")
    assert [r["run_accession"] for r in rows] == ["SRR1"]
