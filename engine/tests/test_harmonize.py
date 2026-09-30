"""Entity harmonization: one identifier per gene, cell line and compound."""

from __future__ import annotations

import re

import pytest

from splicr import harmonize

needs_hgnc = pytest.mark.skipif(
    not (harmonize.HGNC_PATH.exists() and harmonize.GTF_PATHS[9606].exists()),
    reason="HGNC set or Ensembl human GTF not downloaded")
needs_mouse = pytest.mark.skipif(
    not (harmonize.GENE_INFO_PATHS[10090].exists() and harmonize.GTF_PATHS[10090].exists()),
    reason="NCBI mouse gene_info or Ensembl mouse GTF not downloaded")
needs_cello = pytest.mark.skipif(not harmonize.CELLOSAURUS_PATH.exists(), reason="Cellosaurus not downloaded")
needs_chembl = pytest.mark.skipif(not harmonize.CHEMBL_PATH.exists(), reason="Open Targets molecules not downloaded")

ERBB2_HUMAN = "ENSG00000141736"
ERBB2_MOUSE = "ENSMUSG00000062312"   # Ensembl 116 GTF: gene_name "Erbb2", chr 11


@needs_hgnc
@pytest.mark.parametrize("query", ["ERBB2", "HER2", "CD340", "erbb2", "HGNC:3430", "ENSG00000141736",
                                   "ENSG00000141736.18", "2064", 2064, "ERBB2 (2064)"])
def test_erbb2_synonyms_collapse_to_one_ensembl_gene(query):
    r = harmonize.genes(9606).resolve(query)
    assert r.ok, r
    assert (r.id, r.label) == (ERBB2_HUMAN, "ERBB2")
    assert r.xrefs["hgnc_id"] == "HGNC:3430"          # kept for lake tables and atlas.gene_dependency.hgnc_id
    assert r.xrefs["entrez_id"] == "2064"
    assert r.xrefs["ensembl_version_source"] == "Ensembl 116 GTF"


@needs_hgnc
def test_default_taxid_is_human_and_cached():
    assert harmonize.genes() is harmonize.genes(9606)


@needs_hgnc
def test_gene_match_precedence_is_reported():
    g = harmonize.genes(9606)
    assert g.resolve("ERBB2").matched_by == "symbol"
    assert g.resolve("HER2").matched_by == "alias"
    assert g.resolve("HGNC:3430").matched_by == "hgnc_id"
    assert g.resolve("ERBB2 (2064)").matched_by == "entrez"          # DepMap label: Entrez decides
    assert g.resolve("ENSG00000141736.18").matched_by == "ensembl"   # version suffix ignored


@needs_hgnc
def test_approved_symbol_beats_someone_elses_alias():
    # "MARCH1" was renamed MARCHF1; it must not be read as whatever else lists it.
    r = harmonize.genes(9606).resolve("MARCHF1")
    assert r.ok and r.label == "MARCHF1" and r.matched_by == "symbol"


@needs_hgnc
def test_unknown_and_ambiguous_are_never_guessed():
    g = harmonize.genes(9606)
    r = g.resolve("NOT_A_GENE_XYZ")
    assert r.status == "unresolved" and r.reason == "no match"
    ambiguous = [a for a, hits in g.index.maps["alias"].items()
                 if len({g.records[h]["ensembl_gene_id"] for h in hits} - {None}) > 1
                 and a not in g.index.maps["symbol"] and a not in g.index.maps["prev_symbol"]]
    assert ambiguous, "HGNC always has some shared aliases"
    r = g.resolve(ambiguous[0])
    assert r.status == "ambiguous" and len(r.candidates) > 1 and r.id is None
    assert all(c.startswith("ENSG") for c in r.candidates)


@needs_hgnc
def test_retired_ensembl_id_is_unresolved_not_carried_over():
    # HGNC still lists ENSG00000148362 for PAXX (formerly C9orf142); Ensembl 116
    # retired it. The resolver must refuse rather than emit a dead id.
    g = harmonize.genes(9606)
    for q in ("C9orf142", "PAXX", "ENSG00000148362"):
        r = g.resolve(q)
        assert r.status == "unresolved" and r.id is None, r
        assert r.reason.startswith("no current Ensembl gene"), r.reason


@needs_hgnc
def test_every_resolved_human_id_is_current_and_well_formed():
    g = harmonize.genes(9606)
    ids = {r["ensembl_gene_id"] for r in g.records.values()} - {None}
    assert ids <= set(g.current)
    assert all(re.fullmatch(r"ENSG\d{11}", i) for i in ids)
    cov = g.coverage()
    assert cov["protein_coding"]["rate"] > 0.99, cov


@needs_mouse
@pytest.mark.parametrize("query", ["Erbb2", "erbb2", "MGI:95410", "13866", "ENSMUSG00000062312.8", "Erbb2 (13866)"])
def test_mouse_erbb2_resolves_to_its_ensembl_gene(query):
    r = harmonize.genes(10090).resolve(query)
    assert r.ok, r
    assert (r.id, r.label) == (ERBB2_MOUSE, "Erbb2")
    assert r.xrefs["mgi_id"] == "MGI:95410" and r.xrefs["entrez_id"] == "13866"


@needs_mouse
def test_mouse_neu_is_shared_by_two_genes_and_stays_ambiguous():
    # "Neu" is a synonym of both Erbb2 (the rat neu oncogene) and Neu1 (sialidase).
    r = harmonize.genes(10090).resolve("Neu")
    assert r.status == "ambiguous" and r.id is None
    assert ERBB2_MOUSE in r.candidates and len(r.candidates) == 2


@needs_mouse
def test_species_do_not_cross():
    assert harmonize.genes(10090).resolve(ERBB2_HUMAN).status == "unresolved"
    assert harmonize.genes(9606).resolve(ERBB2_MOUSE).status == "unresolved"


@needs_mouse
def test_mouse_ids_are_current_and_well_formed():
    g = harmonize.genes(10090)
    ids = {r["ensembl_gene_id"] for r in g.records.values()} - {None}
    assert ids <= set(g.current)
    assert all(re.fullmatch(r"ENSMUSG\d{11}", i) for i in ids)
    assert g.coverage()["ensembl_protein_coding"]["rate"] > 0.95


# --- the gate -----------------------------------------------------------------

@needs_hgnc
def test_enforce_adds_canonical_columns_and_quarantines_failures():
    import pandas as pd

    frame = pd.DataFrame({"gene": ["HER2", "ERBB2 (2064)", "NOT_A_GENE_XYZ", None, "C9orf142", "TP53"],
                          "lfc": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]})
    clean, quarantine = harmonize.enforce(frame, taxid=9606, gene_col="gene")
    assert len(clean) + len(quarantine) == len(frame)
    assert clean["ensembl_gene_id"].tolist() == [ERBB2_HUMAN, ERBB2_HUMAN, "ENSG00000141510"]
    assert clean["gene_symbol_approved"].tolist() == ["ERBB2", "ERBB2", "TP53"]
    assert clean["lfc"].tolist() == [1.0, 2.0, 6.0]                         # original columns kept
    reasons = dict(zip(quarantine["lfc"], quarantine["quarantine_reason"]))
    assert "unresolved (no match)" in reasons[3.0]
    assert "missing value" in reasons[4.0]
    assert "no current Ensembl gene" in reasons[5.0]
    assert quarantine["ensembl_gene_id"].isna().all()


@needs_hgnc
def test_enforce_min_rate_refuses_a_malformed_frame():
    import pandas as pd

    mouse_genes = pd.DataFrame({"gene": ["Gm12345xyz", "NOT_A_GENE", "ALSO_NOT", "TP53"]})
    with pytest.raises(harmonize.HarmonizationError, match="25.0%"):
        harmonize.enforce(mouse_genes, taxid=9606, gene_col="gene", min_rate=0.9)
    clean, _ = harmonize.enforce(mouse_genes, taxid=9606, gene_col="gene", min_rate=0.25)
    assert len(clean) == 1


@needs_mouse
def test_enforce_mouse_frame():
    import pandas as pd

    clean, quarantine = harmonize.enforce(pd.DataFrame({"gene": ["Erbb2", "Neu", "Trp53"]}),
                                          taxid=10090, gene_col="gene")
    assert clean["ensembl_gene_id"].tolist()[0] == ERBB2_MOUSE
    assert all(i.startswith("ENSMUSG") for i in clean["ensembl_gene_id"])
    assert quarantine["gene"].tolist() == ["Neu"] and "ambiguous" in quarantine["quarantine_reason"].iat[0]


@needs_hgnc
@needs_cello
def test_enforce_multiple_columns_reports_each_failure():
    import pandas as pd

    frame = pd.DataFrame({"gene": ["ERBB2", "NOT_A_GENE_XYZ"], "cell": ["NOT_A_LINE_XYZ", "MCF-7"]})
    clean, quarantine = harmonize.enforce(frame, taxid=9606, gene_col="gene", cell_col="cell")
    assert clean.empty and len(quarantine) == 2
    assert quarantine["cell_line_rrid"].tolist() == [None, "CVCL_0031"]
    assert quarantine["quarantine_reason"].str.contains("cell line 'NOT_A_LINE_XYZ'").iat[0]
    assert quarantine["quarantine_reason"].str.contains("gene 'NOT_A_GENE_XYZ'").iat[1]


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
