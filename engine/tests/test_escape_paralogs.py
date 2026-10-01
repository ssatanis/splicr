"""
SplicR Escape: the paralog layer, the evidence model and the trigger.

What these tests are really guarding is the set of claims the package is allowed to
make. Three of them matter more than the arithmetic:

  - "not covered by the build" must never render as "no paralog". A gene nobody
    looked up and a gene with no duplicate are different facts.
  - expression must never, on its own, raise a hypothesis. A paralog being abundant
    is the single most common substitute for evidence in this area.
  - a gene sitting at zero in a screen that could not measure depletion must not be
    flagged as escaping anything.
"""

import random

import pytest

from splicr.escape import evidence as ev
from splicr.escape import paralogs as pl
from splicr.escape import trigger as tg


# ---------------------------------------------------------------------------
# The paralog store
# ---------------------------------------------------------------------------

def _build(tmp_path, rows, name="ensembl_compara_human.parquet"):
    import pandas as pd

    columns = ["gene", "paralog", "relation", "taxonomy_level",
               "sequence_identity", "group_size", "source", "release"]
    path = tmp_path / name
    pd.DataFrame(rows, columns=columns).to_parquet(path, index=False)
    return path


def _row(gene, paralog, relation="within_species_paralog", **extra):
    return {"gene": gene, "paralog": paralog, "relation": relation,
            "taxonomy_level": extra.get("taxonomy_level", "Homo sapiens"),
            "sequence_identity": extra.get("sequence_identity"),
            "group_size": extra.get("group_size"),
            "source": extra.get("source", "test"),
            "release": extra.get("release", "test-1")}


def test_a_gene_not_in_the_build_is_uncovered_and_not_paralog_free(tmp_path):
    store = pl.Store(ensembl=_build(tmp_path, [_row("A", "B")]),
                     hgnc=tmp_path / "absent.parquet")
    missing = store.lookup("Z")
    assert missing.covered is False
    assert missing.paralogs == ()
    assert "nothing was looked up" in missing.note

    # Covered and empty is a different answer, and says so.
    store = pl.Store(ensembl=_build(tmp_path, [_row("A", "")], "e2.parquet"),
                     hgnc=tmp_path / "absent.parquet")
    empty = store.lookup("A")
    assert empty.covered is True
    assert empty.paralogs == ()
    assert "no paralog was recorded" in empty.note


def test_no_build_at_all_is_uncovered_and_names_the_builder(tmp_path):
    store = pl.Store(ensembl=tmp_path / "none.parquet", hgnc=tmp_path / "none2.parquet")
    assert store.available is False
    lookup = store.lookup("A")
    assert lookup.covered is False
    assert "build-paralogs.py" in lookup.note


def test_the_two_channels_stay_separate_and_agreement_is_its_own_fact(tmp_path):
    ensembl = _build(tmp_path, [_row("A", "B"), _row("A", "C")])
    hgnc = _build(tmp_path, [
        {**_row("A", "B", relation="Family X", group_size=4), "taxonomy_level": ""},
        {**_row("A", "D", relation="Family X", group_size=4), "taxonomy_level": ""},
    ], "h.parquet")
    lookup = pl.Store(ensembl=ensembl, hgnc=hgnc).lookup("A")
    assert lookup.partners == ("B", "C", "D")
    assert {p.paralog for p in lookup.by_channel("ensembl_compara")} == {"B", "C"}
    assert {p.paralog for p in lookup.by_channel("hgnc_gene_group")} == {"B", "D"}
    # Only B is named by both, so only B has two independent sources behind it.
    assert lookup.agreeing() == ("B",)
    assert len(lookup.releases) == 2


def test_relationship_strength_is_words_and_distinguishes_the_channels(tmp_path):
    rows = [_row("A", "B", relation="within_species_paralog"),
            _row("A", "C", relation="other_paralog", taxonomy_level="Bilateria"),
            _row("A", "D", relation="gene_split")]
    lookup = pl.Store(ensembl=_build(tmp_path, rows),
                      hgnc=tmp_path / "none.parquet").lookup("A")
    strengths = {p.paralog: p.strength for p in lookup.paralogs}
    assert strengths["B"] == "duplication within the human lineage"
    assert "Bilateria" in strengths["C"]
    assert "not necessarily a functional duplicate" in strengths["D"]


def test_sequence_identity_stays_empty_when_the_build_recorded_none(tmp_path):
    lookup = pl.Store(ensembl=_build(tmp_path, [_row("A", "B")]),
                      hgnc=tmp_path / "none.parquet").lookup("A")
    # The condensed Compara response carries no percent identity, and it is not
    # estimated from anything else.
    assert lookup.paralogs[0].sequence_identity is None


def test_hgnc_groups_drop_the_motif_families_that_are_not_candidates():
    # A real build over the shipped HGNC file: the cut must actually bite, or
    # "Zinc fingers" would put hundreds of unrelated genes in front of a reader.
    rows = pl.hgnc_group_rows(max_group=8)
    pairs = [row for row in rows if row["paralog"]]
    assert pairs, "the HGNC channel produced no pairs"
    assert all(row["group_size"] <= 8 for row in pairs)
    # Every gene with an Ensembl id is recorded, so coverage is knowable.
    assert len({row["gene"] for row in rows}) > len({row["gene"] for row in pairs})
    assert all(row["source"].startswith("HGNC") for row in rows)
    assert all(row["taxonomy_level"] == "" for row in rows), (
        "HGNC makes no taxonomic claim and must not appear to")


# ---------------------------------------------------------------------------
# The evidence channels
# ---------------------------------------------------------------------------

def _paralogy(tmp_path, candidate="B"):
    lookup = pl.Store(ensembl=_build(tmp_path, [_row("A", "B")]),
                      hgnc=tmp_path / "none.parquet").lookup("A")
    return ev.paralogy_channel(lookup, candidate)


def _conditional(lost=20, intact=20, lost_effect=-1.2, intact_effect=-0.1, noise=0.05):
    random.seed(7)
    effects = {}
    lost_models, intact_models = set(), set()
    for i in range(lost):
        effects[f"L{i}"] = lost_effect + random.gauss(0, noise)
        lost_models.add(f"L{i}")
    for i in range(intact):
        effects[f"I{i}"] = intact_effect + random.gauss(0, noise)
        intact_models.add(f"I{i}")
    return ev.conditional_dependency_channel(effects, lost_models, intact_models, "test")


def test_expression_alone_never_raises_a_hypothesis(tmp_path):
    channels = [
        _paralogy(tmp_path),
        ev.expression_channel({"B": 9.0}, "B", "ACH-1", "test"),
    ]
    hypothesis = ev.build_hypothesis(target="A", candidate="B", channels=channels)
    assert hypothesis.channel("expression").supports is True
    # Paralogy plus a very abundant paralog, and still nothing to act on: no
    # informative channel was evaluated.
    assert hypothesis.strength == "insufficient"
    assert "not enough evidence" in hypothesis.statement()

    # And with the informative channel present but not supporting, it stays weak.
    channels.append(_conditional(lost_effect=-0.1, intact_effect=-0.1))
    weak = ev.build_hypothesis(target="A", candidate="B", channels=channels)
    assert weak.channel("conditional_dependency").availability == "available"
    assert weak.channel("conditional_dependency").supports is False
    assert weak.strength == "weak"


def test_the_conditional_channel_needs_enough_models_on_both_sides():
    thin = _conditional(lost=4, intact=40)
    assert thin.availability == "insufficient_data"
    assert "4 models with the target lost" in thin.statement
    assert thin.supports is False
    assert thin.value is None


def test_the_conditional_channel_supports_only_when_the_interval_excludes_zero():
    strong = _conditional(lost_effect=-1.2, intact_effect=-0.1, noise=0.05)
    assert strong.availability == "available"
    assert strong.supports is True
    assert strong.value < 0
    assert strong.interval[1] < 0

    # Same point estimate direction, far more scatter: the interval crosses zero.
    noisy = _conditional(lost_effect=-0.35, intact_effect=-0.25, noise=1.2)
    assert noisy.availability == "available"
    assert noisy.interval[0] < 0 < noisy.interval[1]
    assert noisy.supports is False
    assert "includes zero" in noisy.statement


def test_the_conditional_channel_resamples_cell_lines_and_says_so():
    channel = _conditional()
    assert channel.unit == "cell line models"
    assert channel.n_units == 40
    assert "cell-line bootstrap" in channel.statement
    assert "association across cell lines" in channel.limitation


def test_a_missing_channel_is_unavailable_and_never_counted_against(tmp_path):
    channels = [
        _paralogy(tmp_path),
        ev.expression_channel(None, "B", "ACH-1", "test"),
        _conditional(),
        ev.pathway_channel(None, "test"),
        ev.complex_channel(None, None, "test"),
        ev.validation_channel(None, "test"),
    ]
    hypothesis = ev.build_hypothesis(target="A", candidate="B", channels=channels)
    assert set(hypothesis.missing) == {
        "expression", "pathway_overlap", "complex_membership", "paired_validation"}
    # Paralogy and the conditional channel both support it; the rest are absent
    # rather than negative, so it is moderate and not strong.
    assert hypothesis.strength == "moderate"
    assert hypothesis.channel("paired_validation").availability == "not_evaluated"


def test_strong_needs_paralogy_the_conditional_channel_overlap_and_expression(tmp_path):
    base = [_paralogy(tmp_path), _conditional(),
            ev.expression_channel({"B": 5.0}, "B", "ACH-1", "test")]
    assert ev.build_hypothesis(target="A", candidate="B", channels=base).strength == "moderate"
    with_pathway = base + [ev.pathway_channel(("R-HSA-1",), "Reactome")]
    assert ev.build_hypothesis(target="A", candidate="B",
                               channels=with_pathway).strength == "strong"
    # Take the expression away and it drops back: strong requires all three.
    without = [c for c in with_pathway if c.name != "expression"]
    without.append(ev.expression_channel({"B": 0.1}, "B", "ACH-1", "test"))
    assert ev.build_hypothesis(target="A", candidate="B",
                               channels=without).strength == "moderate"


def test_a_pair_the_build_does_not_call_paralogs_has_no_hypothesis(tmp_path):
    channels = [_paralogy(tmp_path, candidate="ZZZ"), _conditional(),
                ev.pathway_channel(("R-HSA-1",), "Reactome")]
    hypothesis = ev.build_hypothesis(target="A", candidate="ZZZ", channels=channels)
    assert hypothesis.channel("paralogy").supports is False
    assert hypothesis.strength == "insufficient"


def test_no_statement_claims_the_paralog_buffered_anything(tmp_path):
    channels = [_paralogy(tmp_path), _conditional(),
                ev.expression_channel({"B": 5.0}, "B", "ACH-1", "test"),
                ev.pathway_channel(("R-HSA-1",), "Reactome"),
                ev.complex_channel(True, 950.0, "STRING"),
                ev.validation_channel([], "workspace")]
    hypothesis = ev.build_hypothesis(
        target="A", candidate="B", target_symbol="ARID1A", candidate_symbol="ARID1B",
        model="ACH-1", channels=channels)
    text = hypothesis.statement() + ev.summarise([hypothesis])
    assert hypothesis.strength == "strong"
    assert "hypothesis" in hypothesis.statement()
    for banned in ("buffered", "rescued", "compensated for", "is compensating",
                   "proves", "confirms", "established that"):
        assert banned not in text, banned
    assert "No paired perturbation" in hypothesis.statement()
    assert hypothesis.direct_causal_evidence is False


def test_a_recorded_paired_perturbation_is_the_only_direct_evidence(tmp_path):
    undecided = ev.validation_channel([{"result": "pending"}], "workspace")
    assert undecided.availability == "insufficient_data"
    assert undecided.supports is False

    decided = ev.validation_channel(
        [{"result": "validated"}, {"result": "did_not_validate"}], "workspace")
    assert decided.availability == "available"
    assert decided.supports is True
    assert "1 of 2 decided" in decided.statement
    hypothesis = ev.build_hypothesis(
        target="A", candidate="B", channels=[_paralogy(tmp_path), _conditional(), decided])
    assert hypothesis.direct_causal_evidence is True
    assert "no longer only a hypothesis" in hypothesis.statement()


def test_ranking_is_deterministic_and_strongest_first(tmp_path):
    def make(candidate, conditional):
        channels = [_paralogy(tmp_path), conditional]
        return ev.build_hypothesis(target="A", candidate=candidate, channels=channels)

    weak = make("B", _conditional(lost_effect=-0.1, intact_effect=-0.1))
    moderate = make("B", _conditional())
    order = [h.candidate for h in ev.rank([weak, moderate])]
    assert [h.strength for h in ev.rank([weak, moderate])] == ["moderate", "weak"]
    assert ev.rank([weak, moderate]) == ev.rank([moderate, weak]), "order must be stable"
    assert order == ["B", "B"]


def test_every_channel_states_what_it_cannot_establish(tmp_path):
    channels = [_paralogy(tmp_path), _conditional(),
                ev.expression_channel({"B": 5.0}, "B", "ACH-1", "test"),
                ev.pathway_channel(("R-HSA-1",), "Reactome"),
                ev.complex_channel(True, 900.0, "STRING"),
                ev.validation_channel([], "workspace")]
    for channel in channels:
        assert channel.limitation, f"{channel.name} states no limitation"
        assert channel.source, f"{channel.name} names no source"


# ---------------------------------------------------------------------------
# The trigger
# ---------------------------------------------------------------------------

def _context(**overrides):
    random.seed(3)
    defaults = dict(
        qc_verdict="pass", fitness_contrast=True, nnmd=-2.1,
        reference_essential_effects=tuple(random.gauss(-1.5, 0.45) for _ in range(400)),
        essential_set="CEGv2 core essentials", screen_label="TEST",
    )
    return tg.ScreenContext(**{**defaults, **overrides})


def _gene(**overrides):
    defaults = dict(gene="G", symbol="TARGET", lfc=-0.05, n_guides=4,
                    expected_to_deplete=True, expectation_source="CEGv2",
                    expression_log1p_tpm=5.0)
    return tg.GeneObservation(**{**defaults, **overrides})


@pytest.mark.parametrize("overrides,fragment", [
    ({"fitness_contrast": False}, "not a declared loss-of-function"),
    ({"qc_verdict": "fail"}, "QC failed"),
    ({"nnmd": None}, "recorded no essential/non-essential separation"),
    ({"nnmd": -0.4}, "could not reliably measure depletion"),
    ({"reference_essential_effects": (-1.0, -1.2)}, "fewer than the 50 needed"),
])
def test_a_screen_that_cannot_support_the_question_is_refused_with_its_reason(overrides, fragment):
    assessment = tg.assess(_gene(), _context(**overrides))
    assert assessment.verdict == "not_eligible"
    assert fragment in assessment.reason
    assert assessment.observed_lfc is None, "no comparison is reported for an ineligible screen"


@pytest.mark.parametrize("overrides,fragment", [
    ({"expected_to_deplete": False}, "no independent source says"),
    ({"lfc": None}, "recorded no gene-level effect"),
    ({"n_guides": 2}, "fewer than the 3 needed"),
    ({"expression_log1p_tpm": 0.1}, "does not express it"),
    ({"fragile": True}, "does not survive dropping one guide"),
    ({"spread_vs_screen": 3.4}, "disagree 3.4 times as much"),
])
def test_a_gene_whose_own_evidence_explains_it_is_not_flagged(overrides, fragment):
    assessment = tg.assess(_gene(**overrides), _context())
    assert assessment.verdict == "not_eligible"
    assert fragment in assessment.reason


def test_the_flag_is_relative_to_this_screens_own_depletion_and_says_so():
    assessment = tg.assess(_gene(lfc=-0.05), _context())
    assert assessment.verdict == "unexpectedly_weak"
    assert assessment.percentile_among_essentials == 1.0
    assert assessment.n_reference_essentials == 400
    assert assessment.weak_threshold_lfc is not None
    assert "reference essentials this screen measured" in assessment.reason
    # The flag is a question, never an answer.
    assert "a gap worth explaining, not an explanation" in assessment.reason
    for banned in ("escape", "buffered", "paralog", "compensat"):
        assert banned not in assessment.reason.lower(), banned


def test_a_gene_inside_the_screens_own_range_is_not_unexpected():
    assessment = tg.assess(_gene(lfc=-1.9), _context())
    assert assessment.verdict == "as_expected"
    assert "within the range this screen produced" in assessment.reason


def test_the_same_gene_is_judged_differently_by_two_different_screens():
    """
    The point of a screen-relative cut: the same fold change is unremarkable in a
    screen with a small dynamic range and unexpected in one with a large one.
    """
    random.seed(11)
    shallow = _context(reference_essential_effects=tuple(
        random.gauss(-0.4, 0.15) for _ in range(400)))
    deep = _context(reference_essential_effects=tuple(
        random.gauss(-2.5, 0.4) for _ in range(400)))
    observation = _gene(lfc=-0.6)
    assert tg.assess(observation, shallow).verdict == "as_expected"
    assert tg.assess(observation, deep).verdict == "unexpectedly_weak"


def test_the_worklist_keeps_the_ineligible_genes_and_counts_the_reasons():
    assessments = tg.assess_all([
        _gene(gene="a", symbol="WEAK", lfc=-0.05),
        _gene(gene="b", symbol="FINE", lfc=-1.9),
        _gene(gene="c", symbol="FRAGILE", fragile=True),
        _gene(gene="d", symbol="SILENT", expression_log1p_tpm=0.0),
    ], _context())
    assert [a.symbol for a in assessments][0] == "WEAK"
    assert len(assessments) == 4, "ineligible genes are reported, not dropped"
    text = tg.summarise(assessments)
    assert "1 weaker than expected, 1 as expected, 2 not eligible" in text
    assert "Why genes were not eligible:" in text
    # The summary refuses to name a cause.
    assert "Nothing in this" in text and "names a cause" in text


def test_every_assessment_carries_the_references_it_used():
    assessment = tg.assess(_gene(), _context())
    assert assessment.provenance["essential_set"] == "CEGv2 core essentials"
    assert assessment.provenance["expectation_source"] == "CEGv2"
    assert assessment.provenance["nnmd"] == "-2.100"
    assert assessment.provenance["quantile"] == "0.90"


# ---------------------------------------------------------------------------
# Against the reference lake: does the conditional channel recover a relationship
# that is independently established, and stay quiet on one that is not?
# ---------------------------------------------------------------------------

def _lake_available() -> bool:
    from splicr.escape import context as cx

    cx.reset_cache()
    found = cx.sources()
    return bool(found.gene_effect and found.expression and found.mutation
                and found.copy_number and found.graph)


needs_lake = pytest.mark.skipif(
    not _lake_available(),
    reason="needs the local reference lake (scripts/data/build-depmap-lake.py, graph.build)")


@needs_lake
def test_the_conditional_channel_recovers_arid1a_arid1b_from_depmap():
    """
    The promotion criterion for this channel, on data it did not choose.

    ARID1B's dependence on ARID1A loss is one of the best-established paralog
    relationships in cancer genetics and was reported from screens independent of
    anything here. If the channel cannot see it in DepMap, the channel does not
    work; if it sees it everywhere, it is not measuring anything.

    The numbers are asserted loosely, as directions and bounds rather than exact
    values, because the assertion is about the finding and not about a DepMap
    release's third decimal place.
    """
    from splicr.escape import context as cx

    state = cx.target_state("ARID1A")
    assert state.available
    # Enough models on both sides for the channel to be evaluable at all.
    assert len(state.lost) >= 50, len(state.lost)
    assert len(state.intact) >= 200, len(state.intact)

    channel = ev.conditional_dependency_channel(
        cx.gene_effect_by_model("ARID1B"), set(state.lost), set(state.intact),
        cx.REFERENCE_NOTE)
    assert channel.availability == "available"
    assert channel.supports is True, channel.statement
    # More essential where ARID1A is broken, and the cell-line bootstrap excludes zero.
    assert channel.value < -0.05, channel.statement
    assert channel.interval is not None and channel.interval[1] < 0, channel.statement
    assert channel.n_units >= 250


@needs_lake
def test_a_pan_essential_with_no_relationship_does_not_support_the_hypothesis():
    """
    The specificity half of the criterion.

    ACTB is essential in nearly every model and has nothing to do with ARID1A. A
    channel that flagged it would be detecting "is essential", not "becomes
    conditionally essential", and would support a compensation hypothesis for any
    pan-essential gene in the genome.
    """
    from splicr.escape import context as cx

    state = cx.target_state("ARID1A")
    channel = ev.conditional_dependency_channel(
        cx.gene_effect_by_model("ACTB"), set(state.lost), set(state.intact), "test")
    assert channel.availability == "available"
    assert channel.supports is False, channel.statement
    # It is strongly essential in both arms, which is exactly the confusion the
    # difference-of-medians design is there to avoid.
    assert "includes zero or points the other way" in channel.statement


@needs_lake
def test_a_model_not_profiled_on_every_channel_is_in_neither_arm():
    from splicr.escape import context as cx

    state = cx.target_state("ARID1A")
    # The three arms partition nothing: lost and intact are disjoint, and the
    # unprofiled models are counted rather than defaulted into "intact".
    assert not (state.lost & state.intact)
    assert state.unknown > 0
    assert "in neither arm" in state.note


@needs_lake
def test_pathway_and_interaction_channels_read_the_knowledge_graph():
    from splicr.escape import context as cx

    arid1a, arid1b = "ENSG00000117713", "ENSG00000049618"
    shared = cx.shared_pathways(arid1a, arid1b)
    assert shared is not None and len(shared) > 0
    assert all(pathway.startswith("R-HSA-") for pathway in shared)

    interacts = cx.interaction(arid1a, arid1b)
    assert interacts is not None
    found, score = interacts
    assert found is True
    assert score is not None and 700 <= score <= 1000

    # A pair with no recorded interaction answers False, not None: the graph was
    # read and had nothing, which is different from the graph being absent.
    absent = cx.interaction(arid1a, "ENSG00000000003")
    assert absent is not None and absent[0] is False


@needs_lake
def test_an_absent_lake_makes_every_channel_unavailable_rather_than_empty(monkeypatch, tmp_path):
    from splicr.escape import context as cx

    monkeypatch.setattr(cx.lake, "LOCAL_LAKE", tmp_path)
    cx.reset_cache()
    try:
        assert cx.sources().available is False
        assert cx.target_state("ARID1A").available is False
        assert cx.gene_effect_by_model("ARID1B") is None
        assert cx.shared_pathways("A", "B") is None
        assert cx.interaction("A", "B") is None
        assert cx.expression_in_model(["A"], "ACH-1") is None
    finally:
        cx.reset_cache()


# ---------------------------------------------------------------------------
# The two key spaces, and the analysis that has to bridge them
# ---------------------------------------------------------------------------

@needs_lake
def test_a_canonical_ensembl_id_reaches_the_depmap_matrices():
    """
    The bug this pins.

    The paralog build and the knowledge graph are keyed by Ensembl gene id, which
    the harmonization gate guarantees. The DepMap matrices are keyed by HGNC symbol
    and Entrez id. Handing an Ensembl id to a DepMap query matches no rows, and the
    channels then reported themselves *unavailable* - which a reader would read as
    "DepMap has nothing on this gene" when it really meant "we asked with the wrong
    key". Every DepMap accessor now translates first.
    """
    from splicr.escape import context as cx

    assert cx.depmap_keys("ENSG00000117713") == ("ARID1A", "8289")
    # A caller that already holds a symbol is unchanged.
    assert cx.depmap_keys("ARID1A") == ("ARID1A",)
    # An unresolvable value is passed through rather than dropped.
    assert cx.depmap_keys("ENSG99999999999") == ("ENSG99999999999",)
    assert cx.depmap_keys("") == ()

    by_ensembl = cx.gene_effect_by_model("ENSG00000049618")
    by_symbol = cx.gene_effect_by_model("ARID1B")
    assert by_ensembl and by_symbol
    assert by_ensembl == by_symbol, "the two key spaces must reach the same rows"

    state = cx.target_state("ENSG00000117713")
    assert state.available and len(state.lost) > 50

    # Expression comes back under the caller's own identifier, not DepMap's.
    expression = cx.expression_in_model(["ENSG00000049618"], next(iter(state.intact)))
    assert expression is not None
    assert set(expression) <= {"ENSG00000049618"}


@needs_lake
def test_the_analysis_ranks_arid1b_first_and_still_calls_it_a_hypothesis():
    """
    The whole path, on real reference data, for a relationship established
    elsewhere: a screen that could measure depletion, a gene that should have
    depleted and did not, and the candidate the evidence actually points to.
    """
    import random

    from splicr import harmonize
    from splicr.escape import analysis as an

    random.seed(5)
    context = _context(reference_essential_effects=tuple(
        random.gauss(-1.5, 0.45) for _ in range(400)))
    genes = harmonize.genes(9606)
    arid1a = genes.resolve("ARID1A")
    assert arid1a.ok

    observation = tg.GeneObservation(
        arid1a.id, "ARID1A", lfc=-0.04, n_guides=4, expected_to_deplete=True,
        expectation_source="DepMap common essential", expression_log1p_tpm=5.4)
    symbols = {p: (genes.resolve(p).label or p)
               for p in pl.paralogs_of(arid1a.id).partners}
    result = an.analyse([observation], context, model_id="ACH-000001", symbol_of=symbols)

    assert result.eligible is True
    assert result.flagged == 1
    assert len(result.targets) == 1
    leading = result.targets[0].leading
    assert leading is not None
    assert leading.candidate_symbol == "ARID1B"
    assert leading.strength == "strong"
    # Five channels available, all supporting; the sixth is the one that matters.
    assert len(leading.available) == 5
    assert "paired_validation" in leading.missing
    assert leading.direct_causal_evidence is False

    text = result.summary()
    assert "is a strong hypothesis" in text
    assert "No paired perturbation" in text
    # Every candidate was evaluated; the report is what was shortened.
    assert "evaluated and are not shown here" in text
    assert "not evaluated at all" not in text
    for banned in ("buffered", "rescued", "proves", "confirms"):
        assert banned not in text, banned


@needs_lake
def test_an_ineligible_screen_produces_no_hypotheses_at_all():
    from splicr.escape import analysis as an

    result = an.analyse(
        [_gene(expected_to_deplete=True)],
        _context(qc_verdict="fail"), model_id="ACH-000001")
    assert result.eligible is False
    assert result.targets == ()
    assert result.assessments == ()
    assert "QC failed" in result.reason
    assert "cannot support an escape analysis" in result.summary()
    # And it still names its references, so a reader knows what was not consulted.
    assert result.provenance["references"]


@needs_lake
def test_a_flagged_gene_with_no_paralog_says_so_rather_than_nothing(monkeypatch):
    from splicr.escape import analysis as an

    monkeypatch.setattr(an.pl, "paralogs_of", lambda gene: pl.Lookup(
        gene, True, (), ("test",), "covered by the build, and no paralog was recorded"))
    result = an.analyse([_gene(lfc=-0.03)], _context(), model_id="ACH-000001")
    assert result.flagged == 1
    target = result.targets[0]
    assert target.hypotheses == ()
    assert "not a candidate explanation" in target.note
    assert "not a candidate explanation" in target.statement()


@needs_lake
def test_a_recorded_paired_perturbation_changes_the_statement():
    from splicr import harmonize
    from splicr.escape import analysis as an

    genes = harmonize.genes(9606)
    arid1a, arid1b = genes.resolve("ARID1A").id, genes.resolve("ARID1B").id
    observation = tg.GeneObservation(
        arid1a, "ARID1A", lfc=-0.04, n_guides=4, expected_to_deplete=True,
        expectation_source="DepMap common essential", expression_log1p_tpm=5.4)
    result = an.analyse(
        [observation], _context(), model_id="ACH-000001",
        validations={(arid1a, arid1b): [{"result": "validated"}]})
    leading = result.targets[0].leading
    assert leading is not None and leading.candidate == arid1b
    assert leading.direct_causal_evidence is True
    assert "no longer only a hypothesis" in leading.statement()


@needs_lake
def test_the_best_candidate_is_not_dropped_by_an_arbitrary_pre_evaluation_sort():
    """
    The regression this pins.

    Candidates used to be capped before being evaluated, ordered by the strength of
    the paralogy claim. With only the HGNC channel built, every candidate of a gene
    has the same claim, so the order fell through to a sort on Ensembl id - and a
    cap of six evaluated JARID2, ARID4A and KDM5D for ARID1A while never looking at
    ARID1B, the one relationship anybody would check for. Every candidate is now
    evaluated and the report is what gets shortened.
    """
    from splicr import harmonize
    from splicr.escape import analysis as an

    genes = harmonize.genes(9606)
    arid1a = genes.resolve("ARID1A").id
    symbols = {p: (genes.resolve(p).label or p) for p in pl.paralogs_of(arid1a).partners}
    found, unreached, note = an.hypotheses_for(
        arid1a, model_id="ACH-000001", symbol="ARID1A", symbol_of=symbols)
    assert note == ""
    assert unreached == 0, "ARID1A's family is inside the evaluation ceiling"
    # More candidates evaluated than any report would show.
    assert len(found) > an.MAX_CANDIDATES
    assert found[0].candidate_symbol == "ARID1B", [h.candidate_symbol for h in found[:4]]

    # And a report capped at two still leads with it, and says what it left out.
    result = an.analyse(
        [tg.GeneObservation(arid1a, "ARID1A", lfc=-0.04, n_guides=4,
                            expected_to_deplete=True, expectation_source="DepMap",
                            expression_log1p_tpm=5.4)],
        _context(), model_id="ACH-000001", symbol_of=symbols, max_candidates=2)
    target = result.targets[0]
    assert [h.candidate_symbol for h in target.hypotheses] == ["ARID1B", "ARID2"]
    assert target.candidates_not_shown == len(found) - 2
    assert target.candidates_not_evaluated == 0
    assert "evaluated and are not shown" in target.statement()


@needs_lake
def test_the_evaluation_ceiling_is_reported_when_it_bites():
    from splicr import harmonize
    from splicr.escape import analysis as an

    arid1a = harmonize.genes(9606).resolve("ARID1A").id
    found, unreached, _ = an.hypotheses_for(arid1a, model_id="ACH-000001", ceiling=3)
    assert len(found) == 3
    assert unreached > 0, "a ceiling below the family size must be reported"
