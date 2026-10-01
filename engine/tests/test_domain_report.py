"""
The offline guide-disagreement report, and the annotation it stores.

`splicr.validate.domain_report` is the one place the calculation lives. It is
used by the offline worklist, by the pipeline (which stores what it produces),
and - through `splicr.api.disagreement` - by the service API. There used to be
three implementations with three different thresholds; these tests exist partly
to keep that from happening again.
"""

import pandas as pd
import pytest

from splicr.hits import GuideEffect
from splicr.validate.domain_report import (
    DEPLETION_LFC,
    FRAGILITY_THRESHOLD,
    REFERENCE_VERSIONS,
    annotate_guides,
    summarise,
    worklist,
)


# --------------------------------------------------------------------------
# The gene-level report
# --------------------------------------------------------------------------

def test_report_exposes_spread_fragility_and_per_guide_residuals():
    frame = pd.DataFrame([
        {"gene_symbol": "ERBB2", "guide_key": "g1", "sequence": "A" * 20, "lfc": -2.0},
        {"gene_symbol": "ERBB2", "guide_key": "g2", "sequence": "C" * 20, "lfc": 0.0},
        {"gene_symbol": "ERBB2", "guide_key": "g3", "sequence": "G" * 20, "lfc": 0.1},
        {"gene_symbol": "TP53", "guide_key": "t1", "sequence": "T" * 20, "lfc": -0.6},
        {"gene_symbol": "TP53", "guide_key": "t2", "sequence": "A" * 20, "lfc": -0.7},
        {"gene_symbol": "TP53", "guide_key": "t3", "sequence": "C" * 20, "lfc": -0.8},
    ])
    reports = {r.gene_symbol: r for r in worklist(frame)}
    erbb2 = reports["ERBB2"]
    assert erbb2.spread > reports["TP53"].spread
    assert sum(g.residual for g in erbb2.guides) == pytest.approx(0.0)
    assert erbb2.n_depleting == 1
    assert [g.guide_key for g in erbb2.guides] == ["g1", "g2", "g3"]


def test_report_requires_at_least_two_guides():
    frame = pd.DataFrame([
        {"gene_symbol": "ERBB2", "guide_key": "g1", "sequence": "A" * 20, "lfc": -2.0}
    ])
    assert worklist(frame) == []


def test_the_spread_baseline_is_per_guide_count_and_per_screen():
    """
    A two-guide gene's standard deviation is not comparable with a ten-guide
    gene's, so the baseline is keyed by guide count. Both genes below disagree by
    the same absolute amount; only the one that disagrees more than its own
    size class does is called out.
    """
    rows = []
    for i in range(30):                      # 3-guide genes, tight
        rows += [{"gene_symbol": f"T{i}", "guide_key": f"t{i}{j}", "lfc": v}
                 for j, v in enumerate((-0.1, 0.0, 0.1))]
    for i in range(30):                      # 2-guide genes, loose
        rows += [{"gene_symbol": f"L{i}", "guide_key": f"l{i}{j}", "lfc": v}
                 for j, v in enumerate((-1.5, 1.5))]
    rows += [{"gene_symbol": "WIDE3", "guide_key": f"w{j}", "lfc": v}
             for j, v in enumerate((-2.0, 0.0, 2.0))]
    rows += [{"gene_symbol": "WIDE2", "guide_key": f"x{j}", "lfc": v}
             for j, v in enumerate((-2.0, 2.0))]
    by_gene = {r.gene_symbol: r for r in worklist(pd.DataFrame(rows))}
    # Same absolute spread; judged against very different size classes.
    assert by_gene["WIDE3"].spread_vs_screen > 10
    assert by_gene["WIDE2"].spread_vs_screen == pytest.approx(4 / 3, abs=0.01)


def test_fragility_names_the_pivotal_guide_and_nothing_more():
    frame = pd.DataFrame([
        {"gene_symbol": "X", "guide_key": "strong", "lfc": -2.0},
        {"gene_symbol": "X", "guide_key": "flat1", "lfc": -0.05},
        {"gene_symbol": "X", "guide_key": "flat2", "lfc": -0.05},
    ])
    r = worklist(frame)[0]
    assert r.mean_log2_fold_change <= FRAGILITY_THRESHOLD
    assert r.fragile is True
    assert r.pivotal_guide == "strong"
    assert "fragile" in r.summary
    # The report states a sensitivity, not a winner.
    assert "correct" not in r.summary.lower()


def test_measured_efficacy_is_empty_when_nothing_measured_it():
    frame = pd.DataFrame([
        {"gene_symbol": "X", "guide_key": "a", "lfc": -2.0},
        {"gene_symbol": "X", "guide_key": "b", "lfc": 0.0},
    ])
    plain = worklist(frame)[0]
    assert all(g.measured_efficacy is None and g.efficacy_source is None
               for g in plain.guides)
    assert "efficacy not measured" in summarise([plain])

    withval = worklist(frame, efficacy={"a": 0.82}, efficacy_source="DepMap Chronos")[0]
    a = next(g for g in withval.guides if g.guide_key == "a")
    b = next(g for g in withval.guides if g.guide_key == "b")
    assert a.measured_efficacy == 0.82 and a.efficacy_source == "DepMap Chronos"
    # A guide with no measurement stays empty rather than inheriting a default.
    assert b.measured_efficacy is None


def test_the_summary_says_no_number_was_re_scored():
    frame = pd.DataFrame([
        {"gene_symbol": "X", "guide_key": "a", "lfc": -2.0},
        {"gene_symbol": "X", "guide_key": "b", "lfc": 0.0},
    ])
    text = summarise(worklist(frame))
    assert "Nothing below is re-scored" in text
    assert "made gene calls worse" in text


# --------------------------------------------------------------------------
# The annotation the pipeline stores
# --------------------------------------------------------------------------

class Guide:
    def __init__(self, guide_id, sequence, chrom=None, cut_pos=None, strand=None):
        self.guide_id, self.sequence = guide_id, sequence
        self.chrom, self.cut_pos, self.strand = chrom, cut_pos, strand


class Library:
    def __init__(self, guides):
        self.guides = guides


def _effects():
    return [
        GuideEffect("g_cut", "PARP1", lfc=-2.8, p_value=0.0002, fdr=0.001,
                    control_mean=800.0, treatment_mean=110.0),
        GuideEffect("g_nocoord", "PARP1", lfc=-0.1),
        GuideEffect("g_other", "TP53", lfc=-1.9),
        GuideEffect("g_unknown", "PARP1", lfc=0.2),
    ]


def _library():
    return Library([
        Guide("g_cut", "A" * 20, chrom="1", cut_pos=1000, strand="+"),
        Guide("g_nocoord", "C" * 20),
        Guide("g_other", "G" * 20, chrom="17", cut_pos=2000, strand="-"),
    ])


@pytest.fixture
def located(monkeypatch):
    from types import SimpleNamespace

    from splicr.validate import protein

    monkeypatch.setattr(protein, "locate", lambda gene, chrom, cut: SimpleNamespace(
        residue=988, n_residues=1014, transcript="ENST00000366794",
        fraction=988 / 1014, in_last_exon=False))
    monkeypatch.setattr(protein, "domains_at", lambda gene, residue: ("PARP catalytic domain",))
    monkeypatch.setattr(protein, "feature_records", lambda gene: ("P09874", ()))
    monkeypatch.setattr(protein, "flush_features", lambda: False)


def test_annotation_keeps_the_measurement_with_its_own_guide(located):
    rows = {r.guide_key: r for r in annotate_guides(_effects(), _library(), genes={"PARP1"})}
    assert set(rows) == {"g_cut", "g_nocoord", "g_other", "g_unknown"}
    # The fold change never moves to another guide.
    assert rows["g_cut"].log2_fold_change == -2.8
    assert rows["g_cut"].p_value == 0.0002
    assert rows["g_cut"].control_mean == 800.0
    assert rows["g_cut"].sequence == "A" * 20


def test_a_resolved_cut_carries_its_transcript_accession_and_features(located):
    row = next(r for r in annotate_guides(_effects(), _library(), genes={"PARP1"})
               if r.guide_key == "g_cut")
    assert row.protein_residue == 988
    assert row.mane_transcript == "ENST00000366794"
    assert row.uniprot_accession == "P09874"
    assert row.features_hit == ["PARP catalytic domain"]
    assert row.annotation_evidence == "curated"
    assert row.cds_fraction == pytest.approx(988 / 1014, abs=1e-6)
    assert row.note == ""


def test_every_missing_annotation_says_which_kind_of_missing_it_is(located):
    rows = {r.guide_key: r for r in annotate_guides(_effects(), _library(), genes={"PARP1"})}
    # No cut position in the library: nothing about the protein is claimed.
    assert rows["g_nocoord"].annotation_evidence == "none"
    assert rows["g_nocoord"].protein_residue is None
    assert "no verified cut position" in rows["g_nocoord"].note
    # Outside the shortlist: looked at, not looked up. Different from not found.
    assert rows["g_other"].annotation_evidence == "none"
    assert "not requested" in rows["g_other"].note
    # A guide MAGeCK scored that this library does not contain.
    assert "is not in the library" in rows["g_unknown"].note
    # And the measurement survives in every one of those cases.
    assert rows["g_other"].log2_fold_change == -1.9


def test_no_curated_feature_is_cds_only_and_never_curated(monkeypatch, located):
    from splicr.validate import protein
    monkeypatch.setattr(protein, "domains_at", lambda gene, residue: ())
    row = next(r for r in annotate_guides(_effects(), _library(), genes={"PARP1"})
               if r.guide_key == "g_cut")
    assert row.annotation_evidence == "cds_only"
    assert row.features_hit == []
    assert row.protein_residue == 988
    assert "no curated UniProt feature" in row.note


def test_annotation_failure_never_loses_the_measurement(monkeypatch, located):
    from splicr.validate import protein

    def boom(*args, **kwargs):
        raise RuntimeError("UniProt unreachable")

    monkeypatch.setattr(protein, "locate", boom)
    row = next(r for r in annotate_guides(_effects(), _library(), genes={"PARP1"})
               if r.guide_key == "g_cut")
    assert row.log2_fold_change == -2.8
    assert row.annotation_evidence == "none"
    assert "annotation unavailable: RuntimeError" in row.note


def test_reference_versions_name_the_releases_a_stored_row_was_resolved_against():
    assert REFERENCE_VERSIONS["assembly"] == "GRCh38"
    assert REFERENCE_VERSIONS["ensembl"] == "116"
    assert "MANE" in REFERENCE_VERSIONS["transcript_set"]


def test_the_depletion_cut_is_one_constant_shared_with_the_api():
    from splicr.api import disagreement

    assert disagreement.DEPLETION_LFC == DEPLETION_LFC
