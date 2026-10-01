"""
The dual-knockout design proposal, and the four things it refuses to do.

These tests are mostly about refusals, because the failure modes here put a wrong
sequence in front of a laboratory:

  - no Cas9 activity model is ever applied to a Cas12a spacer
  - no crRNA scaffold is invented; without one, a layout is emitted and a construct
    is not
  - no design happens without an explicitly named nuclease
  - a design is never described as evidence for the hypothesis that prompted it
"""

import re

import pytest

from splicr import multiplex as mx


# ---------------------------------------------------------------------------
# The registry
# ---------------------------------------------------------------------------

def test_the_registry_states_that_no_activity_model_is_installed():
    assert set(mx.NUCLEASES) == {"AsCas12a", "LbCas12a"}
    for spec in mx.NUCLEASES.values():
        assert spec.family == "Cas12a"
        assert spec.pam == "TTTV" and spec.pam_side == "5'"
        # The point of the field: no model, so no prediction, and no borrowing one
        # from a nuclease with a different PAM and a different cut geometry.
        assert spec.activity_model == ""
        assert spec.can_predict_activity is False
        assert "no on-target activity model" in spec.notes.lower() or \
               "no on-target activity model" in spec.notes
        # And no scaffold is shipped for it.
        assert spec.direct_repeat == ""


def test_an_unregistered_nuclease_is_refused_and_says_why():
    with pytest.raises(ValueError) as error:
        mx.design_pair("A", "B", nuclease="enAsCas12a")
    message = str(error.value)
    assert "not in the nuclease registry" in message
    assert "AsCas12a" in message
    # The refusal names the reason engineered variants are absent rather than
    # quietly treating them as wild type.
    assert "published PAM definition" in message


def test_the_nuclease_is_required_with_no_default():
    with pytest.raises(TypeError):
        mx.design_pair("A", "B")          # type: ignore[call-arg]


# ---------------------------------------------------------------------------
# PAM matching and composition
# ---------------------------------------------------------------------------

def test_the_pam_pattern_is_the_iupac_string_and_nothing_looser():
    pattern = mx.pam_pattern("TTTV")
    for good in ("TTTA", "TTTC", "TTTG"):
        assert pattern.fullmatch(good), good
    for bad in ("TTTT", "TTAA", "ATTT", "TTT"):
        assert not pattern.fullmatch(bad), bad
    assert mx.pam_pattern("N").fullmatch("A")


def test_composition_warnings_name_each_problem_they_found():
    assert mx._composition_warnings("ACGT" * 5 + "GCA") == []
    assert any("GC" in w for w in mx._composition_warnings("GC" * 12))
    assert any("run of more than" in w for w in mx._composition_warnings("A" * 6 + "CGTACGTACGTACGTAC"))
    poly = mx._composition_warnings("ACGTTTTACGACGTACGTACGTA")
    assert any("terminates a pol III transcript" in w for w in poly)


# ---------------------------------------------------------------------------
# Selection, with a stub genome so the test needs no 3 GB FASTA
# ---------------------------------------------------------------------------

def _spacer(sequence, start, gene="A", perfect=1, near=0, warnings=(), fraction=0.2):
    return mx.Spacer(gene=gene, sequence=sequence, chrom="1", start=start, strand="+",
                     pam="TTTA", gc=0.5, perfect_matches=perfect,
                     one_mismatch_matches=near, warnings=tuple(warnings),
                     cds_fraction=fraction)


def test_selection_prefers_unique_spacers_over_everything_else():
    picked = mx._select([
        _spacer("A" * 23, 1000, perfect=4),        # not unique
        _spacer("C" * 23, 2000, perfect=1),        # unique
        _spacer("G" * 23, 3000, perfect=None),     # specificity unknown
    ], 2, 23)
    assert [s.sequence[0] for s in picked] == ["C", "G"], \
        "unique first, then unknown, and a multi-mapping spacer last"


def test_selection_keeps_two_spacers_apart_on_the_gene():
    picked = mx._select([
        _spacer("C" * 23, 1000),
        _spacer("G" * 23, 1050),      # 50 bp away: too close to add
        _spacer("T" * 23, 4000),
    ], 2, 23)
    assert [s.start for s in picked] == [1000, 4000]


def test_selection_prefers_the_five_prime_end_of_the_coding_sequence():
    picked = mx._select([
        _spacer("C" * 23, 9000, fraction=0.9),
        _spacer("G" * 23, 1000, fraction=0.1),
    ], 1, 23)
    # A frameshift nearer the 5' end removes more protein.
    assert picked[0].cds_fraction == 0.1


def test_a_spacer_with_a_composition_warning_loses_to_one_without():
    picked = mx._select([
        _spacer("C" * 23, 1000, warnings=("GC 100% is outside 25%-75%",)),
        _spacer("ACGTACGTACGTACGTACGTACG", 5000),
    ], 1, 23)
    assert picked[0].warnings == ()


def test_specific_is_measured_and_unknown_is_not_unique():
    assert _spacer("C" * 23, 1, perfect=1).specific is True
    assert _spacer("C" * 23, 1, perfect=3).specific is False
    # Unknown is not unique. A design whose specificity was never measured must
    # not report itself as specific.
    assert _spacer("C" * 23, 1, perfect=None).specific is False


# ---------------------------------------------------------------------------
# The construct, and what is emitted without a scaffold
# ---------------------------------------------------------------------------

def _design(spacers, repeat="", warnings=()):
    return mx.ArrayDesign(
        nuclease="AsCas12a", genes=("A", "B"), spacers=tuple(spacers),
        layout=tuple(x for s in spacers
                     for x in ("crRNA direct repeat", f"spacer {s.gene} {s.sequence}")),
        construct=("".join(repeat + s.sequence for s in spacers) if repeat else ""),
        direct_repeat=repeat, warnings=tuple(warnings),
        rationale="Paralog compensation by B is a strong hypothesis for A.")


def test_without_a_scaffold_the_layout_is_emitted_and_no_construct_is():
    design = _design([_spacer("C" * 23, 1, "A"), _spacer("G" * 23, 5000, "B")])
    assert design.construct == ""
    assert design.layout[0] == "crRNA direct repeat"
    assert "spacer A" in design.layout[1]
    statement = design.statement()
    assert "supply your vector's crRNA direct repeat" in statement
    # The scaffold is the caller's, because it depends on the ortholog and the
    # vector and a recalled sequence is not something to put in front of a bench.
    assert "TAATTTCTACT" not in statement


def test_with_a_scaffold_the_construct_is_the_repeat_before_every_spacer():
    repeat = "TAATTTCTACTCTTGTAGAT"
    design = _design([_spacer("C" * 23, 1, "A"), _spacer("G" * 23, 5000, "B")], repeat)
    assert design.construct == repeat + "C" * 23 + repeat + "G" * 23
    assert design.construct.count(repeat) == 2
    assert re.fullmatch(r"[ACGT]+", design.construct)
    assert "The construct is written out below" in design.statement()


def test_a_design_never_describes_itself_as_evidence():
    design = _design([_spacer("C" * 23, 1, "A"), _spacer("G" * 23, 5000, "B")])
    statement = design.statement()
    assert "proposed experiment for an untested hypothesis" in statement
    assert "not evidence that the hypothesis is true" in statement
    for banned in ("confirms", "proves", "validated", "demonstrates", "shows that"):
        assert banned not in statement.lower(), banned


def test_completeness_requires_two_measured_unique_spacers_for_each_gene():
    two_each = _design([_spacer("C" * 23, 1, "A"), _spacer("A" * 23, 5000, "A"),
                        _spacer("G" * 23, 1, "B"), _spacer("T" * 23, 5000, "B")])
    assert two_each.complete is True

    one_gene = _design([_spacer("C" * 23, 1, "A"), _spacer("A" * 23, 5000, "A")])
    assert one_gene.complete is False

    unmeasured = _design([_spacer("C" * 23, 1, "A", perfect=None),
                          _spacer("A" * 23, 5000, "A"),
                          _spacer("G" * 23, 1, "B"), _spacer("T" * 23, 5000, "B")])
    assert unmeasured.complete is False, "unmeasured specificity is not completeness"
    assert "This design is incomplete" in unmeasured.statement()


def test_a_missing_genome_produces_a_named_refusal_and_no_spacers(tmp_path):
    design = mx.design_pair("ARID1A", "ARID1B", nuclease="AsCas12a",
                            genome_path=tmp_path / "absent.fa")
    assert design.spacers == ()
    assert design.complete is False
    assert any("no design was produced" in w for w in design.warnings)
    # And it still says what it was for.
    assert design.nuclease == "AsCas12a"


def test_an_ambiguous_scaffold_is_refused_rather_than_written(tmp_path):
    design = mx.design_pair("ARID1A", "ARID1B", nuclease="AsCas12a",
                            direct_repeat="TAATTTNNACT", genome_path=tmp_path / "absent.fa")
    # The genome is absent here, so this only checks that a non-ACGT repeat is
    # never spliced into a construct.
    assert design.construct == ""


# ---------------------------------------------------------------------------
# Against the real genome, when it is present
# ---------------------------------------------------------------------------

def _genome_available() -> bool:
    from splicr.validate import genome

    return genome.HG38.exists() and genome.HG38.with_suffix(".fa.fai").exists()


needs_genome = pytest.mark.skipif(
    not _genome_available(),
    reason="needs data/references/genome/hg38.fa and its .fai (scripts/data/fetch-genome.sh)")


@needs_genome
def test_spacers_are_found_inside_the_mane_coding_sequence_only():
    from splicr.validate import genome, protein

    spec = mx.NUCLEASES["AsCas12a"]
    found, problems = mx.candidate_spacers("ARID1A", spec, genome.Genome(), max_candidates=40)
    assert problems == []
    assert found, "no PAM-adjacent spacer was found in a 6.8 kb coding sequence"
    intervals = protein.cds_intervals("ARID1A")
    for spacer in found:
        assert len(spacer.sequence) == spec.spacer_length
        assert mx.pam_pattern(spec.pam).fullmatch(spacer.pam)
        assert set(spacer.sequence) <= set("ACGT")
        assert any(start <= spacer.start < end for _, start, end, _ in intervals), \
            "a spacer outside the CDS is not a knockout"


@needs_genome
def test_the_whole_proposal_for_a_real_pair_is_specific_and_unpredicted():
    design = mx.design_pair(
        "ARID1A", "ARID1B", nuclease="AsCas12a",
        rationale="Paralog compensation by ARID1B is a strong hypothesis for ARID1A.")
    assert design.nuclease == "AsCas12a"
    assert design.complete, design.warnings
    assert len(design.spacers) == 2 * mx.SPACERS_PER_GENE
    for spacer in design.spacers:
        # Measured uniqueness, and no predicted activity anywhere.
        assert spacer.perfect_matches == 1
        assert spacer.predicted_activity is None
        assert spacer.activity_model == ""
        assert spacer.protein_residue is not None
    assert any("no on-target activity model" in w for w in design.warnings)
    assert any("Cas9 model was deliberately not substituted" in w for w in design.warnings)
    # Provenance a reader can check the design against.
    assert design.provenance["activity_model"] == "none installed"
    assert "MANE Select" in design.provenance["transcript_set"]
    assert "bowtie" in design.provenance["specificity"]
    assert design.provenance["array_orientation"].startswith("5' to 3'")
