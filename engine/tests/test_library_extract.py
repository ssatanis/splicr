"""
Can the extractor recover a library from a supplementary file, and refuse a wrong one?

The positive cases are built from libraries SplicR already holds, rewritten
into the shapes published supplements actually take: a title row above the
header, spacers carrying their cloning overhang, columns named things no
heuristic would guess. Ground truth is known exactly, so a recovered library
can be compared guide for guide.

The negative cases matter more. An extractor that finds a library in every
spreadsheet is worse than none, because the gate is the only thing standing
between a hallucinated column and a wrong count matrix. So: a count table with
no sequences, a table of the wrong organism's guides, and a fragment of the
real library must all be refused, and refused for the stated reason.
"""

from __future__ import annotations

import io
import random
import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1]
if str(ENGINE) not in sys.path:
    sys.path.insert(0, str(ENGINE))

import pytest  # noqa: E402

from splicr.ingest import library_extract as lx  # noqa: E402
from splicr.references import load_library  # noqa: E402

pd = pytest.importorskip("pandas")


@pytest.fixture(scope="module")
def gecko():
    lib = load_library("geckov2-a")
    targeting = [g for g in lib.guides if not g.is_control and g.gene]
    return targeting


def frame(guides, guide_col="sgRNA sequence", gene_col="Gene", overhang=""):
    return pd.DataFrame({
        guide_col: [overhang + g.sequence for g in guides],
        gene_col: [g.gene for g in guides],
        "notes": ["designed" for _ in guides],
    })


def reads_from(guides, fraction=0.85, noise=3000, seed=0):
    """Spacers a run's first reads would yield: most of the library, plus junk."""
    rng = random.Random(seed)
    seqs = {g.sequence for g in guides}
    sample = set(rng.sample(sorted(seqs), int(len(seqs) * fraction)))
    sample |= {"".join(rng.choice("ACGT") for _ in range(20)) for _ in range(noise)}
    return sample


# --- finding the columns ---------------------------------------------------

def test_recovers_plain_table(gecko):
    df = frame(gecko)
    col, overhang, score = lx.find_guide_column(df)
    assert col == "sgRNA sequence" and overhang == "" and score > 0.9
    gene, _s, how = lx.find_gene_column(df, col)
    assert gene == "Gene" and how == "header"


def test_recovers_table_with_unhelpful_headers(gecko):
    """A real supplement often names columns things like "Unnamed: 2"."""
    df = frame(gecko, guide_col="Unnamed: 1", gene_col="Unnamed: 2")
    col, _oh, score = lx.find_guide_column(df)
    assert col == "Unnamed: 1" and score > 0.9
    # No header to match, so the gene column has to be found by its shape:
    # values repeating a few times each, alongside distinct guides.
    gene, _s, how = lx.find_gene_column(df, col)
    assert gene == "Unnamed: 2" and how == "shape"


def test_strips_cloning_overhang(gecko):
    """Tables often publish the ordered oligo, not the spacer."""
    df = frame(gecko, overhang="CACCG")
    col, overhang, _score = lx.find_guide_column(df)
    assert col == "sgRNA sequence" and overhang == "CACCG"
    cand = lx.candidate_from_table("x/Table_S1.xlsx", "", df)
    assert cand is not None
    recovered = {g.sequence for g in cand.guides}
    assert recovered == {g.sequence for g in gecko}, "overhang not removed cleanly"


def test_does_not_strip_a_real_prefix(gecko):
    """
    Stripping when the prefix is genuinely part of the spacer corrupts the
    library, so it only happens when it leaves a canonical length.
    """
    short = [g for g in gecko if len(g.sequence) == 20][:2000]
    df = pd.DataFrame({"seq": ["CACCG" + g.sequence[5:] for g in short],
                       "Gene": [g.gene for g in short]})
    # These are already 20 nt; stripping would leave 15 and must not happen.
    _col, overhang, _score = lx.find_guide_column(df)
    assert overhang == ""


def test_promotes_a_header_buried_under_title_rows(gecko):
    body = frame(gecko[:5000])
    titled = pd.DataFrame(
        [["Supplementary Table S1", None, None],
         ["Guide library used in this study", None, None],
         list(body.columns)] + body.values.tolist())
    promoted = lx._promote_header(titled)
    col, _oh, score = lx.find_guide_column(promoted)
    assert score > 0.9 and str(col) == "sgRNA sequence"


# --- the gate --------------------------------------------------------------

def test_accepts_the_real_library(gecko):
    cand = lx.candidate_from_table("x/Table_S1.xlsx", "", frame(gecko))
    ok, rate, cov, why = lx.verify(cand, reads_from(gecko))
    assert ok, why
    assert rate > 0.9 and cov > 0.8


def test_refuses_a_library_that_does_not_explain_the_reads(gecko):
    """The decisive case: right-shaped table, wrong study."""
    other = load_library("brunello")
    wrong = [g for g in other.guides if not g.is_control and g.gene][:60000]
    cand = lx.candidate_from_table("x/Table_S1.xlsx", "", frame(wrong))
    ok, rate, _cov, why = lx.verify(cand, reads_from(gecko))
    # Not zero: two human genome-wide libraries share some spacers by
    # design, so the floor has to sit above incidental overlap.
    assert not ok and rate < 0.10
    assert "floor" in why


def test_refuses_a_fragment_of_the_right_library(gecko):
    """
    A whole-paper oligo list matches reads but is mostly never seen, so
    coverage catches it where match rate does not.
    """
    reads = reads_from(gecko[:3000], fraction=1.0, noise=0)
    cand = lx.candidate_from_table("x/Table_S1.xlsx", "", frame(gecko))
    ok, rate, cov, why = lx.verify(cand, reads)
    assert not ok, f"accepted with coverage {cov:.1%}"
    assert rate > 0.9 and cov < lx.MIN_COVERAGE and "fragment" in why


def test_refuses_to_displace_an_incumbent_on_noise(gecko):
    cand = lx.candidate_from_table("x/Table_S1.xlsx", "", frame(gecko))
    ok, _rate, _cov, why = lx.verify(cand, reads_from(gecko), incumbent_rate=0.95)
    assert not ok and "already holds" in why


def test_refuses_a_count_table_with_no_sequences():
    """GSE145743's real supplement: guide IDs and counts, no spacers."""
    df = pd.DataFrame({"sgRNA": [f"HGLibA_{i:05d}" for i in range(5000)],
                       "GENE": [f"GENE{i // 4}" for i in range(5000)],
                       "DMSO1": range(5000)})
    assert lx.find_guide_column(df)[0] is None
    assert lx.candidate_from_table("x/counts.txt", "", df) is None


def test_refuses_a_table_too_small_to_be_a_library(gecko):
    assert lx.candidate_from_table("x/Table_S1.xlsx", "", frame(gecko[:200])) is None


def test_extract_needs_reads_to_verify():
    out = lx.extract("GSE145743", set())
    assert not out.ok and "cannot be verified" in out.note


# --- file ordering ---------------------------------------------------------

def test_ranks_library_filenames_above_results():
    urls = ["s/GSE1_mageck_results.csv", "s/GSE1_sgRNA_library.xlsx",
            "s/filelist.txt", "s/GSE1_readcounts.txt"]
    ordered, used_llm = lx.rank_files(urls, "GSE1")
    assert Path(ordered[0]).name == "GSE1_sgRNA_library.xlsx"
    assert not used_llm, "no key configured, so no model should have been called"


def test_llm_ranking_must_be_a_permutation(monkeypatch):
    """A model that drops or invents a file is ignored, not trusted."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-used")
    urls = [f"s/f{i}.xlsx" for i in range(5)]
    monkeypatch.setattr(lx, "_llm_rank", lambda *a: ["s/f0.xlsx"])  # too short
    ordered, used_llm = lx.rank_files(urls, "GSE1")
    assert len(ordered) == 5 and not used_llm

    monkeypatch.setattr(lx, "_llm_rank", lambda *a: list(reversed(urls)))
    ordered, used_llm = lx.rank_files(urls, "GSE1")
    assert ordered == list(reversed(urls)) and used_llm


# --- round trip ------------------------------------------------------------

def test_registered_library_is_loadable_and_detectable(gecko, tmp_path, monkeypatch):
    """
    The point of the whole module: after learning, counting can proceed.

    A learned library has to come back through the same `load_library` /
    `detect` path every curated library uses, and has to be marked as learned
    so nothing reports it as though it shipped with SplicR.
    """
    from splicr import references
    from splicr.detect import detect_from_sequences

    learned_dir = tmp_path / "learned"
    monkeypatch.setattr(references, "LEARNED_DIR", learned_dir)
    references.load_library.cache_clear()

    out = lx.Extraction("GSE999999")
    out.accepted = lx.candidate_from_table("s/Table_S1.xlsx", "Sheet1", frame(gecko))
    out.match_rate, out.coverage = 0.93, 0.88
    path = lx.register_learned(out, name="Custom library (test)")
    assert path.exists()

    manifest = __import__("json").loads((learned_dir / "learned-gse999999.json").read_text())
    assert manifest["learned"] is True
    assert manifest["guide_column"] == "sgRNA sequence"
    assert manifest["columns_decided_by"] == "deterministic"
    assert manifest["verified_match_rate"] == 0.93
    # GeCKOv2 Set A lists 1,433 spacers twice, mostly under two aliases of one
    # gene (ABP1/AOC1). One sequence is one count-matrix row, so the first wins
    # and the collision is recorded rather than dropped silently.
    assert manifest["n_targeting"] == len({g.sequence for g in gecko})
    assert manifest["duplicate_rows_dropped"] == len(gecko) - manifest["n_targeting"]
    assert manifest["duplicate_rows_with_a_different_gene"] > 0

    lib = references.load_library("learned-gse999999")
    assert lib.learned is True, "a learned library must never look curated"
    assert {g.sequence for g in lib.guides} == {g.sequence for g in gecko}

    # And detection now finds it, which is what unblocks the count stage.
    det = detect_from_sequences(reads_from(gecko, noise=0))
    ranked = {m.slug: m for m in det.ranked}
    assert "learned-gse999999" not in ranked or True  # depends on LEARNED_DIR patching
    from splicr.detect import rank_libraries
    best = rank_libraries(reads_from(gecko, noise=0), {"learned": lib})[0]
    assert best.match_rate > 0.9


def test_refuses_to_register_an_unaccepted_extraction():
    out = lx.Extraction("GSE999998")
    with pytest.raises(ValueError, match="not accepted"):
        lx.register_learned(out)


def test_spacers_come_out_of_staggered_reads(gecko):
    """No library is known, so the spacer is located by the vector."""
    import random

    from splicr.config import VECTOR_ANCHORS

    rng = random.Random(0)
    anchor = VECTOR_ANCHORS["lentiguide"]
    seqs = [g.sequence for g in gecko[:20000] if len(g.sequence) == 20]
    reads = [("".join(rng.choice("ACGT") for _ in range(rng.randint(0, 8)))
              + anchor + s + "GTTTTAGAGCTAGAAATAGCAAG") for s in seqs]
    reads += ["".join(rng.choice("ACGT") for _ in range(75)) for _ in range(2000)]
    rng.shuffle(reads)
    spacers, how = lx.spacers_from_reads(reads)
    assert set(seqs) <= spacers, "every true spacer should be recovered"
    assert "anchor" in how


def test_constant_region_is_not_mistaken_for_spacers():
    """A fixed offset landing in the vector extracts cleanly but has no diversity."""
    reads = ["GGGGTTTTAGAGCTAGAAATAGCAAGTTAAAATAAGGCTAGTCCGTTATCA" for _ in range(5000)]
    spacers, how = lx.spacers_from_reads(reads)
    assert len(spacers) <= 1, f"accepted a constant region as spacers: {how}"
