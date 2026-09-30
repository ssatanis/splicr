"""Biophysical validation: guide placement, repair prediction, protein mapping, benchmark stats."""

from __future__ import annotations

import numpy as np
import pytest

from splicr.validate import benchmark, protein, repair
from splicr.validate.genome import CONTEXT_LEN, GUIDE_OFFSET, HG38, Genome, place_guide, revcomp

needs_genome = pytest.mark.skipif(
    not (HG38.exists() and HG38.with_suffix(".fa.fai").exists()),
    reason="hg38 not fetched (scripts/data/fetch-genome.sh)")
needs_lindel = pytest.mark.skipif(not repair.available(), reason="Lindel not vendored")
needs_cds = pytest.mark.skipif(not protein.CDS_CACHE.exists(), reason="MANE CDS cache not built")


@pytest.fixture(scope="module")
def genome():
    g = Genome()
    yield g
    g.close()


def test_revcomp_round_trips():
    assert revcomp("ACGTN") == "NACGT"
    assert revcomp(revcomp("ACGGTACCT")) == "ACGGTACCT"


# --- placement -----------------------------------------------------------------

@needs_genome
def test_fetch_matches_across_a_line_boundary(genome):
    # The FASTA wraps at 50 bases; a read that spans a wrap must drop the newline
    # rather than swallow a base, so a 120 bp span must come back 120 bp long.
    seq = genome.fetch("chr1", 1_000_000, 1_000_120)
    assert len(seq) == 120 and set(seq) <= set("ACGTN")
    assert genome.fetch("chr1", 1_000_000, 1_000_050) == seq[:50]


@needs_genome
def test_place_guide_reproduces_a_known_brunello_guide(genome):
    # Brunello's first A1BG guide, with its own published coordinate and context.
    cs = place_guide(genome, "chr19", 58351501, "CATCTTCTTTCACCTGAACG")
    assert cs.ok, cs.detail
    assert cs.context[GUIDE_OFFSET:GUIDE_OFFSET + 20] == "CATCTTCTTTCACCTGAACG"
    assert cs.pam.endswith("GG") and len(cs.context) == CONTEXT_LEN
    # Brunello publishes the surrounding 30 bp; it must appear in our window.
    assert "ATCGCATCTTCTTTCACCTGAACGCGGTGG" in cs.context


@needs_genome
def test_wrong_strand_hint_is_recovered_not_obeyed(genome):
    """A hint that finds nothing is a wrong hint; the guide is still placed."""
    right = place_guide(genome, "chr19", 58351501, "CATCTTCTTTCACCTGAACG", strand_hint="-")
    wrong = place_guide(genome, "chr19", 58351501, "CATCTTCTTTCACCTGAACG", strand_hint="+")
    assert right.ok and wrong.ok
    assert wrong.context == right.context


@needs_genome
def test_absent_guide_is_refused_not_guessed(genome):
    cs = place_guide(genome, "chr19", 58351501, "ACACACACACACACACACAC")
    assert not cs.ok and cs.status == "not_found"
    assert cs.context == ""


@needs_genome
@pytest.mark.parametrize("bad", ["CATCTTCTTTCACCTGAAC", "CATCTTCTTTCACCTGAACGX", ""])
def test_malformed_guides_are_refused(genome, bad):
    assert not place_guide(genome, "chr19", 58351501, bad).ok


# --- repair --------------------------------------------------------------------

@needs_lindel
def test_repair_probabilities_are_a_distribution():
    context = "A" * 13 + "CATCTTCTTTCACCTGAACG" + "CGG" + "T" * 24
    out = repair.predict(context)
    assert 0.0 <= out.frameshift <= 1.0
    assert out.in_frame == pytest.approx(1.0 - out.frameshift)
    assert out.in_frame_deletion_mass <= out.in_frame + 1e-9
    # Every reported in-frame deletion must actually be in frame.
    assert all(length % 3 == 0 for _s, length, _p in out.in_frame_deletions)
    assert out.model == "Lindel" and out.model_commit == repair.LINDEL_COMMIT


@needs_lindel
def test_repair_rejects_a_window_of_the_wrong_length():
    with pytest.raises(ValueError):
        repair.predict("ACGT" * 10)


@needs_lindel
def test_repair_rejects_a_window_without_a_pam():
    with pytest.raises(ValueError):
        repair.predict("A" * 13 + "CATCTTCTTTCACCTGAACG" + "CAT" + "T" * 24)


@needs_lindel
def test_predict_many_skips_only_the_bad_window():
    good = "A" * 13 + "CATCTTCTTTCACCTGAACG" + "CGG" + "T" * 24
    out = repair.predict_many({"good": good, "bad": "ACGT"})
    assert set(out) == {"good"}


# --- protein -------------------------------------------------------------------

@needs_cds
@pytest.mark.parametrize("gene,length", [("TP53", 393), ("PARP1", 1014), ("BRCA1", 1863), ("ERBB2", 1255)])
def test_mane_cds_reproduces_canonical_protein_length(gene, length):
    """Residue indices only line up with UniProt if the transcript choice is right."""
    exons = protein._cds_index()[gene]
    assert sum(e["end"] - e["start"] for e in exons) // 3 == length


@needs_cds
def test_locate_places_a_cut_inside_the_coding_sequence():
    exons = protein._cds_index()["TP53"]
    e = exons[len(exons) // 2]
    pos = protein.locate("TP53", "chr17", e["start"] + 1)
    assert pos is not None
    assert 1 <= pos.residue <= pos.n_residues == 393
    assert 0.0 < pos.fraction <= 1.0
    assert pos.strand == "-"


@needs_cds
def test_locate_returns_none_off_the_coding_sequence():
    assert protein.locate("TP53", "chr17", 1_000) is None
    assert protein.locate("NOT_A_GENE_XYZ", "chr17", 7_670_000) is None


@needs_cds
@pytest.mark.network
def test_uniprot_features_land_on_known_catalytic_residues():
    acc, feats = protein.features("PARP1")
    assert acc == "P09874"
    assert ("Active site", 988, 988) in feats          # catalytic glutamate E988


# --- benchmark -----------------------------------------------------------------

def test_knockout_probability_is_frameshift_raised_to_the_copy_number():
    fs = np.array([0.0, 0.5, 1.0])
    assert benchmark.knockout_probability(fs, ploidy=2.0) == pytest.approx([0.0, 0.25, 1.0])
    assert benchmark.knockout_probability(fs, ploidy=1.0) == pytest.approx(fs)


def test_auroc_is_one_when_essentials_are_fully_depleted():
    ess, non = np.array([-3.0, -2.5, -2.0]), np.array([0.1, 0.0, -0.1])
    assert benchmark._auroc(ess, non) == pytest.approx(1.0)
    assert benchmark._auroc(non, ess) == pytest.approx(0.0)
    assert benchmark._nnmd(ess, non) < 0


def test_benchmark_recovers_a_planted_effect_and_stays_flat_without_one():
    """A guide-level effect must show up in the mechanism test and not in the null."""
    import pandas as pd

    rng = np.random.default_rng(0)
    rows = []
    for g in range(60):
        gene = f"ESS{g}"
        for fs in rng.uniform(0.4, 0.95, 6):
            rows.append({"gene_symbol": gene, "frameshift": fs,
                         "lfc": -3.0 * fs + rng.normal(0, 0.15)})
    for g in range(60):
        gene = f"NON{g}"
        for fs in rng.uniform(0.4, 0.95, 6):
            rows.append({"gene_symbol": gene, "frameshift": fs, "lfc": rng.normal(0, 0.15)})
    df = pd.DataFrame(rows)
    ess = {f"ESS{g}" for g in range(60)}
    non = {f"NON{g}" for g in range(60)}
    out = benchmark.run(df, ess, non)
    assert out["tests"]["mechanism_essential"]["statistic"] < -0.5
    assert abs(out["tests"]["specificity_nonessential"]["statistic"]) < 0.15
    assert out["gene_level"]["plain"]["auroc"] > 0.9
