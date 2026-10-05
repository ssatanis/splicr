"""Regression tests for confirmed post-screen ingestion and inference defects.

Fixtures are deliberately synthetic parser/contract checks, not biological
validation data or evidence of improved AssayBench performance.
"""
from __future__ import annotations

import json
import hashlib
from pathlib import Path

import pytest

from splicr import artifacts, hits, pipeline
from splicr.atlas import AtlasResult
from splicr.count import CountMatrix, SampleCounts, count_table_samples, read_count_table
from splicr.qc import sample_qc, screen_qc
from splicr.hits import GeneResult, HitTable, ToolError
from splicr.references import Guide, Library


@pytest.mark.parametrize("chance", [None, 0.1, 0.9])
def test_artifact_risk_is_not_confirmed_artifact(chance):
    from splicr.db import classify
    flags = [artifacts.Flag("copy_number_cluster", "critical", "Possible cutting toxicity")]
    assert classify("A", chance, None, flags) == "uncertain"


def test_portable_provenance_hashes_exact_code_and_analyzed_counts(tmp_path):
    source = tmp_path / "engine" / "splicr"
    source.mkdir(parents=True)
    for name in ("pipeline.py", "hits.py", "count.py", "qc.py", "artifacts.py", "atlas.py"):
        (source / name).write_text(f"# fixture source {name}\n")
    (source.parent / "requirements.txt").write_text("test-package==1.0\n")
    workdir = tmp_path / "run"
    (workdir / "hits").mkdir(parents=True)
    counts = workdir / "hits" / "counts.txt"
    counts.write_text("sgRNA\tGene\tT0\ng1\tA\t12\n")
    before = pipeline._report_provenance(workdir, source)
    assert before["python_version"]
    assert before["analyzed_counts"]["sha256"] == hashlib.sha256(counts.read_bytes()).hexdigest()
    assert before["analyzed_counts"]["available"] is True
    assert before["requirements_sha256"] == hashlib.sha256((source.parent / "requirements.txt").read_bytes()).hexdigest()
    assert all(len(value) == 64 for value in before["code_sha256"].values())
    (source / "hits.py").write_text("# changed algorithm\n")
    after = pipeline._report_provenance(workdir, source)
    assert before["code_sha256"]["hits.py"] != after["code_sha256"]["hits.py"]
    assert before["analyzed_counts"] == after["analyzed_counts"]


def test_count_only_mapping_is_unknown_not_perfect(matrix):
    qc = sample_qc(matrix, "T0")
    assert qc.mapping_rate is None
    assert qc.total_reads is None
    assert qc.mapped_reads == 600
    record = qc.as_dict()
    assert record["mapping_rate_available"] is False
    assert record["mapping_source"] == "count_table"
    assert record["count_sum"] == 600
    assert any("unmapped reads" in note for note in qc.notes)
    assert json.loads(json.dumps(record, allow_nan=False))["mapping_rate"] is None


def test_read_counting_mapping_keeps_observed_fraction(matrix):
    matrix.per_sample = [SampleCounts("T0", total_reads=1000, mapped_exact=550, mapped_mismatch=50)]
    qc = sample_qc(matrix, "T0")
    assert qc.mapping_rate == 0.6
    assert qc.total_reads == 1000
    assert qc.as_dict()["mapping_rate_available"] is True
    assert qc.as_dict()["mapping_source"] == "read_counting_summary"


def test_zero_reads_cannot_define_a_mapping_fraction(matrix):
    matrix.matrix = [[0, 0], [0, 0]]
    matrix.per_sample = [SampleCounts("T0", total_reads=0)]
    qc = sample_qc(matrix, "T0")
    assert qc.mapping_rate is None
    assert qc.total_reads == 0
    assert any("zero total reads" in note for note in qc.notes)


def test_qc_writer_preserves_unknown_mapping_without_database(matrix, library):
    from splicr.db import RunContext, write_qc
    class CaptureConnection:
        def __init__(self):
            self.calls = []
        def execute(self, statement, params):
            self.calls.append((statement, params))
    conn = CaptureConnection()
    qc = screen_qc(matrix, {"T0": "reference", "D21": "treatment"}, ["D21"], ["T0"], library,
                    assess_essentiality=False)
    write_qc(conn, RunContext("org", "screen", "run", "comparison"), qc, {"T0": "sample"})
    statement, values = conn.calls[0]
    assert values[2] is None  # total reads unknown
    assert values[4] is None  # mapping fraction unknown
    assert json.loads(values[-1])["mapping_rate_available"] is False
    assert "mapped_frac = excluded.mapped_frac" in statement


@pytest.fixture
def library():
    return Library("test", "Synthetic test library", [
        Guide("g1", "ACGT", "A", chrom="1", cut_pos=100),
        Guide("g2", "TGCA", "B", chrom="1", cut_pos=200),
    ])


@pytest.fixture
def matrix():
    return CountMatrix("test", ["g1", "g2"], ["A", "B"],
                       ["T0", "D21"], [[300, 150], [300, 450]])


@pytest.mark.parametrize("value", ["NA", "", "NaN", "inf", "-1", "2.9", "garbage"])
def test_invalid_counts_never_become_zero_or_truncated(tmp_path, value):
    path = tmp_path / "counts.tsv"
    path.write_text(f"sgRNA\tGene\tT0\tD21\ng1\tA\t100\t{value}\n")
    with pytest.raises(ValueError, match="nonnegative integer"):
        read_count_table(path)


@pytest.mark.parametrize("body", [
    "sgRNA\tGene\tT0\tD21\ng1\tA\t1\n",
    "sgRNA\tGene\tT0\tD21\ng1\tA\t1\t2\t3\n",
    "sgRNA\tGene\tT0\tT0\ng1\tA\t1\t2\n",
    "sgRNA\tGene\tT0\t\ng1\tA\t1\t2\n",
    "sgRNA\tGene\tT0\ng1\tA\t1\ng1\tB\t2\n",
    "sgRNA\tGene\tT0\n\tA\t1\n",
    "sgRNA\tGene\tT0\n",
    "",
])
def test_malformed_count_structure_rejected(tmp_path, body):
    path = tmp_path / "counts.tsv"
    path.write_text(body)
    with pytest.raises(ValueError):
        read_count_table(path)


def test_counts_accept_exact_integers_without_float_roundoff(tmp_path):
    path = tmp_path / "counts.csv"
    path.write_text('sgRNA,Gene,"T0",D21\ng1,"A,B",9007199254740993,2e2\n')
    parsed = read_count_table(path)
    assert parsed.genes == ["A,B"]
    assert parsed.matrix == [[9007199254740993, 200]]
    assert count_table_samples(path) == ["T0", "D21"]


def test_header_validation_does_not_silently_drop_blank_sample(tmp_path):
    path = tmp_path / "counts.tsv"
    path.write_text("sgRNA\tGene\tT0\t\n")
    with pytest.raises(ValueError):
        count_table_samples(path)


def test_drugz_fdr_matches_effect_sign_and_preserves_zero(monkeypatch, tmp_path):
    (tmp_path / "drugz.py").touch()
    (tmp_path / "drugz.txt").write_text(
        "GENE\tnormZ\tfdr_supp\tfdr_synth\n"
        "SYNTH\t-5\t1\t0\nSUPP\t5\t0\t1\n"
        "NULL\t0\t0.5\t0.5\nMISSING\tNA\t0.1\t0.2\n"
        "NO_TAIL\t-4\t0.9\tNA\n"
    )
    monkeypatch.setattr(hits, "DRUGZ_DIR", tmp_path)
    monkeypatch.setattr(hits, "_run", lambda *args: None)
    result = hits.run_drugz(tmp_path / "counts", ["T"], ["C"], tmp_path)
    assert result == {"SYNTH": (-5, 0), "SUPP": (5, 0), "NULL": (0, None),
                      "MISSING": (None, None), "NO_TAIL": (-4, None)}


def test_missing_drugz_is_reported(monkeypatch, tmp_path):
    monkeypatch.setattr(hits, "DRUGZ_DIR", tmp_path)
    with pytest.raises(ToolError, match="not found"):
        hits.run_drugz(tmp_path / "counts", ["T"], ["C"], tmp_path)


def test_drugz_pairing_requires_explicit_metadata(monkeypatch, tmp_path):
    (tmp_path / "drugz.py").touch()
    (tmp_path / "drugz.txt").write_text("GENE\tnormZ\tfdr_supp\tfdr_synth\nA\t-3\t1\t0.02\n")
    monkeypatch.setattr(hits, "DRUGZ_DIR", tmp_path)
    commands = []
    monkeypatch.setattr(hits, "_run", lambda cmd, *a: commands.append(cmd))
    hits.run_drugz(tmp_path / "counts", ["T1", "T2"], ["C1"], tmp_path)
    assert "-unpaired" in commands[-1]
    with pytest.raises(ToolError, match="matched control"):
        hits.run_drugz(tmp_path / "counts", ["T1", "T2"], ["C1"], tmp_path, paired=True)
    hits.run_drugz(tmp_path / "counts", ["T1"], ["C1"], tmp_path, paired=True)
    assert "-unpaired" not in commands[-1]


def test_offtarget_counts_use_the_screened_guides(monkeypatch, library):
    library.guides.append(Guide("unmeasured", "CCCC", "A", perfect_alignments=3))
    library.guides[0].perfect_alignments = 1
    monkeypatch.setattr(artifacts, "load_gene_offtarget", lambda *a: {})
    monkeypatch.setattr(artifacts, "annotate_offtarget", lambda *a: 0)
    monkeypatch.setattr(artifacts, "depmap_common_essentials", lambda: frozenset())
    table = HitTable({"A": GeneResult("A", lfc=-2)}, [], "test", ["T"], ["C"])
    assert artifacts.flag_artifacts(table, library, screened_guide_ids={"g1"}) == {}


def test_rra_two_direction_selection_has_gene_family_correction(monkeypatch, tmp_path):
    (tmp_path / "mageck.gene_summary.txt").write_text(
        "id\tnum\tneg|p-value\tpos|p-value\tneg|fdr\tpos|fdr\tneg|lfc\tpos|lfc\n"
        "A\t4\t0.01\t0.9\t0.02\t0.9\t-2\t2\n"
        "B\t4\t0.9\t0.03\t0.9\t0.04\t-1\t1\n"
        "C\t4\t0.2\t0.8\t0.4\t0.9\t-0.3\t0.3\n"
        "D\t4\tNA\t0.001\tNA\t0.004\t-3\t3\n"
    )
    monkeypatch.setattr(hits, "_run", lambda *args: None)
    result, warnings = hits.run_mageck_rra(tmp_path / "counts", ["T"], ["C"], tmp_path)
    assert result["A"].p_value == pytest.approx(0.02)
    assert result["A"].fdr == pytest.approx(0.04)
    assert result["B"].fdr == pytest.approx(0.08)
    assert result["C"].fdr == pytest.approx(0.8)
    assert result["D"].fdr is None
    assert result["A"].depleted_fdr == 0.02
    assert result["B"].direction == "enriched"
    assert warnings


def test_mle_requires_explicit_design_before_running(matrix, library, tmp_path):
    with pytest.raises(ValueError, match="explicit mle_design_matrix"):
        hits.call_hits(matrix, library, ["D21"], ["T0"], tmp_path, run_mle=True)


def test_empty_mageck_output_cannot_be_success(monkeypatch, tmp_path):
    (tmp_path / "mageck.gene_summary.txt").write_text("id\tnum\n")
    monkeypatch.setattr(hits, "_run", lambda *a: None)
    with pytest.raises(ToolError, match="no gene rows"):
        hits.run_mageck_rra(tmp_path / "counts", ["T"], ["C"], tmp_path)


def test_mle_matching_coefficient_not_first_fdr(monkeypatch, tmp_path):
    (tmp_path / "mageck_mle.gene_summary.txt").write_text(
        "Gene\tfirst|beta\tsecond|beta\tfirst|fdr\tsecond|fdr\nA\t1\t-2\t0.8\t0.01\n"
    )
    monkeypatch.setattr(hits, "_run", lambda *args: None)
    assert hits.run_mageck_mle(tmp_path / "counts", tmp_path / "design", tmp_path,
                              coefficient="second") == {"A": (-2, 0.01)}
    with pytest.raises(ToolError, match="select one explicitly"):
        hits.run_mageck_mle(tmp_path / "counts", tmp_path / "design", tmp_path)


def test_requested_mle_runs_and_merges(monkeypatch, matrix, library, tmp_path):
    monkeypatch.setattr(hits, "run_mageck_rra", lambda *a, **kw: ({"A": GeneResult("A")}, []))
    seen = []
    def mle(*args, **kwargs):
        seen.append(kwargs)
        return {"A": (-2, 0.01)}
    monkeypatch.setattr(hits, "run_mageck_mle", mle)
    result = hits.call_hits(matrix, library, ["D21"], ["T0"], tmp_path,
                            run_mle=True, run_bagel=False,
                            mle_design_matrix=tmp_path / "design", mle_coefficient="drug")
    assert seen == [{"coefficient": "drug", "permutation_round": 10, "norm_method": "median", "control_sgrna": None, "random_seed": 0}]
    assert result.genes["A"].mle_beta == -2
    assert "mageck_mle" in result.methods


@pytest.mark.parametrize("declared", [False, True])
def test_inversion_guard_requires_declared_fitness_contrast(monkeypatch, matrix, library, tmp_path, declared):
    genes = {f"E{i}": GeneResult(f"E{i}", fdr=0.001, direction="enriched") for i in range(100)}
    monkeypatch.setattr(hits, "run_mageck_rra", lambda *a, **kw: (genes, []))
    monkeypatch.setattr(hits, "essentials", lambda taxid: set(genes))
    if declared:
        with pytest.raises(hits.InvertedContrastError):
            hits.call_hits(matrix, library, ["D21"], ["T0"], tmp_path,
                            run_bagel=False, essentiality_contrast=True)
    else:
        result = hits.call_hits(matrix, library, ["D21"], ["T0"], tmp_path, run_bagel=False)
        assert result.direction is None


@pytest.mark.parametrize("modality,lfc,expected", [("knockout", -2, True),
    ("knockout", 2, False), ("activation", -2, False), ("inhibition", -2, False)])
def test_copy_number_cutting_flags_respect_modality_and_direction(monkeypatch, library, modality, lfc, expected):
    monkeypatch.setattr(artifacts, "load_gene_offtarget", lambda *a: {})
    monkeypatch.setattr(artifacts, "annotate_offtarget", lambda *a: 0)
    monkeypatch.setattr(artifacts, "depmap_common_essentials", lambda: frozenset())
    monkeypatch.setattr(artifacts, "copy_number_for_model", lambda *a: {"A": 10})
    table = HitTable({"A": GeneResult("A", lfc=lfc)}, [], "test", ["T"], ["C"])
    flags = artifacts.flag_artifacts(table, library, model_id="test", modality=modality)
    assert bool(flags) == expected
    if expected:
        assert "ratio" in flags["A"][0].message
        assert "copies" not in flags["A"][0].message


def test_nonfinite_copy_number_is_unknown():
    assert artifacts.check_copy_number("A", {"A": float("nan")}, []) is None


def test_pipeline_reports_actual_failed_stage(monkeypatch, tmp_path):
    path = tmp_path / "counts.tsv"
    path.write_text("sgRNA\tGene\tT0\tD21\ng1\tA\t300\t150\n")
    monkeypatch.setattr(pipeline, "load_library", lambda *a: (_ for _ in ()).throw(RuntimeError("library unavailable")))
    result = pipeline.run_pipeline(pipeline.ScreenInput("test", count_table=path, library_slug="test",
                                   treatment=["D21"], control=["T0"]),
                                   tmp_path / "out", verbose=False)
    assert result.failed_at == "detect"
    assert result.stages[-1].status == "failed"


def test_fastq_samples_detect_their_own_orientation(monkeypatch, tmp_path):
    from splicr.count import revcomp
    library = Library("mixed", "Mixed read directions", [Guide("g1", "ACGATCGTAGCTAGGTCATG", "A"), Guide("g2", "TGCAGATCCGTAGCATGACG", "A")])
    read = "TTGTGGAAAGGACGAAACACCG" + library.guides[0].sequence + "GTTTTAGAGCTAGAAATAGCAAG"
    files = {}
    for label, sequence in [("control", read), ("treated", revcomp(read))]:
        path = tmp_path / f"{label}.fastq"
        path.write_text("".join(f"@read{i}\n{sequence}\n+\n{'I' * len(sequence)}\n" for i in range(12)))
        files[label] = path
    monkeypatch.setattr(pipeline, "load_library", lambda *args: library)
    monkeypatch.setattr(pipeline, "call_hits", lambda *args, **kwargs: HitTable({"A": GeneResult("A", lfc=0, fdr=1)}, ["mageck_rra"], "test", ["treated"], ["control"]))
    monkeypatch.setattr(pipeline, "flag_artifacts", lambda *args, **kwargs: {})
    monkeypatch.setattr(pipeline, "atlas_context", lambda *args, **kwargs: AtlasResult(available=False, reason="test fixture"))
    result = pipeline.run_pipeline(pipeline.ScreenInput("mixed read directions", fastqs=files, library_slug="mixed", treatment=["treated"], control=["control"], hit_callers=["mageck_rra"]), tmp_path / "out", verbose=False)
    assert result.ok, result.error
    assert [sample.mapped for sample in result.matrix.per_sample] == [12, 12]
    assert [sample.location.reverse_complement for sample in result.matrix.per_sample] == [False, True]
    count = next(stage for stage in result.stages if stage.stage == "count")
    assert count.metrics["sample_locations"]["treated"]["reverse_complement"] is True


@pytest.mark.parametrize("modality,phenotype,expected", [
    ("knockout", "fitness", True), ("activation", "fitness", False),
    ("knockout", "reporter", False), ("knockout", None, False),
])
def test_pipeline_context_and_portable_evidence_report(monkeypatch, tmp_path, matrix, library, modality, phenotype, expected):
    path = matrix.to_mageck_tsv(tmp_path / "counts.tsv")
    monkeypatch.setattr(pipeline, "load_library", lambda *a: library)
    seen = {}
    def call(*args, **kwargs):
        seen.update(kwargs)
        return HitTable({"A": GeneResult("A", lfc=-2, fdr=0.04, depleted_fdr=0.02)},
                        ["mageck_rra"], "test", ["D21"], ["T0"])
    monkeypatch.setattr(pipeline, "call_hits", call)
    monkeypatch.setattr(pipeline, "flag_artifacts", lambda *a, **kw: {})
    def atlas(*args, **kwargs):
        assert kwargs["condition"] == "drug"
        assert kwargs["modality"] == modality
        return AtlasResult(available=False, reason="test fixture")
    monkeypatch.setattr(pipeline, "atlas_context", atlas)
    result = pipeline.run_pipeline(pipeline.ScreenInput("test", count_table=path, library_slug="test",
        treatment=["D21"], control=["T0"], phenotype=phenotype, modality=modality,
        condition="drug"), tmp_path / "out", verbose=False)
    assert result.ok, result.error
    assert seen["essentiality_contrast"] == expected
    assert seen["run_bagel"] == expected
    report = json.loads(result.report_path.read_text())
    assert report["task"] == "post_screen_analysis"
    assert report["provenance"]["analyzed_counts"]["sha256"] is None
    assert report["provenance"]["analyzed_counts"]["available"] is False
    assert report["provenance"]["requirements_sha256"]
    assert all(report["provenance"]["code_sha256"].values())
    assert report["statistics"]["validation_probability"] is None
    assert report["genes"][0]["depleted_fdr"] == 0.02
    if not expected:
        assert report["qc"]["nnmd"] is None
        assert "not applicable" in report["qc"]["nnmd_reason"]

def test_drugz_integer_cli_options_match_the_pinned_tool(monkeypatch,tmp_path):
    (tmp_path / 'drugz.py').touch()
    (tmp_path / 'drugz.txt').write_text('GENE\tnormZ\tfdr_supp\tfdr_synth\nA\t-3\t1\t0.02\n')
    monkeypatch.setattr(hits,'DRUGZ_DIR',tmp_path)
    commands=[]
    monkeypatch.setattr(hits,'_run',lambda command,*args:commands.append(command))
    hits.run_drugz(tmp_path/'counts',['T'],['C'],tmp_path,pseudocount=5.0,half_window_size=20)
    assert commands[0][commands[0].index('-p')+1]=='5'
    assert commands[0][commands[0].index('--half_window_size')+1]=='20'
    with pytest.raises(ToolError,match='Invalid DrugZ'):
        hits.run_drugz(tmp_path/'counts',['T'],['C'],tmp_path,pseudocount=5.5)

def test_explicitly_requested_method_failure_is_not_completed(monkeypatch,matrix,library,tmp_path):
    from splicr import pipeline
    path=matrix.to_mageck_tsv(tmp_path/'counts.tsv')
    monkeypatch.setattr(pipeline,'load_library',lambda _:library)
    monkeypatch.setattr(pipeline,'call_hits',lambda *args,**kwargs:HitTable({'A':GeneResult('A')},['mageck_rra'], 'test',['D21'],['T0'],warnings=['DrugZ did not run']))
    result=pipeline.run_pipeline(pipeline.ScreenInput('test',count_table=path,library_slug='test',treatment=['D21'],control=['T0'],hit_callers=['mageck_rra','drugz'],run_drugz=True),tmp_path/'out',verbose=False)
    assert not result.ok
    assert result.failed_at=='hits'
    assert 'Requested methods did not complete: drugz' in result.error
