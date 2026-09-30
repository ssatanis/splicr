"""The knowledge graph answers a known multi-hop question with known biology."""

from __future__ import annotations

import pytest

from splicr import graph, lake

pytestmark = pytest.mark.skipif(
    not (lake.LOCAL_LAKE / "kg_edges" / "data_0.parquet").exists(), reason="knowledge graph not built")


@pytest.fixture(scope="module")
def con():
    c = graph.connect()
    c.execute("set enable_progress_bar = false")
    return c


def test_nodes_use_harmonized_ids(con):
    bad = con.execute("""
        select label, count(*) from nodes
        where (label = 'Gene' and not regexp_full_match(id, 'ENSG[0-9]{11}'))
           or (label = 'Drug' and id not like 'CHEMBL%')
           or (label = 'CellLine' and id not like 'ACH-%') or (label = 'Pathway' and id not like 'R-HSA-%')
        group by 1""").fetchall()
    assert bad == []


def test_gene_nodes_carry_hgnc_and_symbol(con):
    row = con.execute("select id, xref from nodes where label = 'Gene' and name = 'ERBB2'").fetchall()
    assert row == [("ENSG00000141736", "HGNC:3430")]


def test_every_edge_endpoint_is_a_node(con):
    assert con.execute("""select count(*) from edges e
        where not exists (select 1 from nodes n where n.id = e.src)
           or not exists (select 1 from nodes n where n.id = e.dst)""").fetchone()[0] == 0


def test_erbb2_amplified_breast_lines_depend_on_the_her2_axis(con):
    df = graph.selective_dependencies(con, amplified_gene="ERBB2", lineage="Breast", limit=50)
    significant = set(df.loc[df.q_value < 0.05, "gene"])
    # HER2-amplified lines depend on HER2 itself, its dimer partner and PI3K.
    assert {"ERBB2", "ERBB3", "PIK3CA"} <= significant


def test_underpowered_question_reports_no_significant_genes(con):
    # 17 MYC-amplified vs 36 other breast lines: nothing survives FDR, and the
    # function must say so through q rather than a confident ranking.
    df = graph.selective_dependencies(con, amplified_gene="MYC", lineage="Breast", limit=50)
    assert (df.q_value >= 0.05).all()
