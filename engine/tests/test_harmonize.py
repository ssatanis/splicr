"""Entity harmonization: one identifier per gene, cell line and compound."""

from __future__ import annotations

import pytest

from splicr import harmonize

needs_hgnc = pytest.mark.skipif(not harmonize.HGNC_PATH.exists(), reason="HGNC set not downloaded")
needs_cello = pytest.mark.skipif(not harmonize.CELLOSAURUS_PATH.exists(), reason="Cellosaurus not downloaded")
needs_chembl = pytest.mark.skipif(not harmonize.CHEMBL_PATH.exists(), reason="Open Targets molecules not downloaded")


@needs_hgnc
@pytest.mark.parametrize("query", ["ERBB2", "HER2", "CD340", "erbb2", "HGNC:3430", "ENSG00000141736", "2064", "ERBB2 (2064)"])
def test_erbb2_synonyms_collapse_to_one_gene(query):
    r = harmonize.genes().resolve(query)
    assert r.ok, r
    assert (r.id, r.label) == ("HGNC:3430", "ERBB2")
    assert r.xrefs["ensembl_gene_id"] == "ENSG00000141736"
    assert r.xrefs["entrez_id"] == "2064"


@needs_hgnc
def test_gene_match_precedence_is_reported():
    g = harmonize.genes()
    assert g.resolve("ERBB2").matched_by == "symbol"
    assert g.resolve("HER2").matched_by == "alias"
    assert g.resolve("ENSG00000141736.18").matched_by == "ensembl"   # version suffix ignored


@needs_hgnc
def test_approved_symbol_beats_someone_elses_alias():
    # "MARCH1" was renamed MARCHF1; it must not be read as whatever else lists it.
    r = harmonize.genes().resolve("MARCHF1")
    assert r.ok and r.label == "MARCHF1" and r.matched_by == "symbol"


@needs_hgnc
def test_unknown_and_ambiguous_are_never_guessed():
    g = harmonize.genes()
    assert g.resolve("NOT_A_GENE_XYZ").status == "unresolved"
    ambiguous = [a for a, hits in g.index.maps["alias"].items() if len(hits) > 1
                 and a not in g.index.maps["symbol"] and a not in g.index.maps["prev_symbol"]]
    assert ambiguous, "HGNC always has some shared aliases"
    r = g.resolve(ambiguous[0])
    assert r.status == "ambiguous" and len(r.candidates) > 1 and r.id is None


@needs_cello
@pytest.mark.parametrize("query", ["MCF7", "MCF-7", "mcf 7", "CVCL_0031", "RRID:CVCL_0031", "ACH-000019"])
def test_mcf7_spellings_collapse_to_one_rrid(query):
    r = harmonize.cell_lines().resolve(query)
    assert r.ok, r
    assert r.id == "CVCL_0031"
    assert "ACH-000019" in r.xrefs["depmap_ids"]


@needs_cello
def test_hela_and_depmap_id_agree():
    c = harmonize.cell_lines()
    assert c.resolve("HeLa").id == c.resolve("ACH-001086").id == "CVCL_0030"


@needs_chembl
@pytest.mark.parametrize("query", ["imatinib", "Gleevec", "CHEMBL941", "KTUFNOKKBVMGRW-UHFFFAOYSA-N"])
def test_imatinib_names_collapse_to_one_chembl_id(query):
    r = harmonize.compounds().resolve(query)
    assert r.ok, r
    assert r.id == "CHEMBL941"
