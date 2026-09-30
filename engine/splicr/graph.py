"""
The relational layer: genes, pathways, drugs and cell lines as one typed graph.

Stored as two Parquet tables in the lake (kg_nodes, kg_edges) and queried with
DuckDB joins, which answers the multi-hop questions SplicR asks today at this
size (tens of thousands of nodes, a few million edges) in well under a second.
`export_neo4j` writes the same graph in neo4j-admin bulk-import format, so moving
to a graph database later is a load, not a rewrite.

Node ids are the harmonized identifiers, never free text:

    Gene      ENSGxxxxxxxxxxx      (harmonize.genes(9606): Ensembl 116, unversioned;
                                    name = HGNC symbol, xref = HGNC ID)
    CellLine  DepMap ModelID       (rrid property carries the Cellosaurus RRID)
    Drug      CHEMBLxxxx           (harmonize.compounds, salts collapsed to parent)
    Pathway   R-HSA-xxxx           (Reactome stable id)

Edge types and where each comes from:

    INTERACTS_WITH   Gene-Gene        STRING v12 combined_score >= 700 (preferred name -> Ensembl)
    IN_PATHWAY       Gene-Pathway     Reactome gene sets (symbol -> Ensembl)
    TARGETS          Drug-Gene        Open Targets mechanisms of action (Ensembl, checked against 116)
    DEPENDS_ON       CellLine-Gene    DepMap 26Q1 Chronos dependency probability >= 0.5 (Entrez -> Ensembl)
    AMPLIFIED        CellLine-Gene    DepMap 26Q1 WGS relative copy number >= 2.0 (linear)
    HAS_HOTSPOT      CellLine-Gene    DepMap 26Q1 hotspot mutation matrix > 0
    PROFILED_WITH    Drug-CellLine    Tahoe-100M drug x cell line samples
"""

from __future__ import annotations

import gzip
from pathlib import Path

from . import harmonize, lake
from .config import REFERENCE_DIR

STRING_MIN_SCORE = 700
DEPENDENCY_MIN = 0.5
AMPLIFIED_MIN_CN = 2.0
DEPMAP_RELEASE = "26Q1"

for _name, _desc in (("kg_nodes", "Knowledge graph nodes: Gene, CellLine, Drug, Pathway."),
                     ("kg_edges", "Knowledge graph edges with type, source and weight.")):
    lake.DATASETS.setdefault(_name, lake.Dataset(_name, (), (), _desc))


def _depmap(measure: str) -> str:
    return str(lake.LOCAL_LAKE / "depmap_matrix" / f"release={DEPMAP_RELEASE}" / f"measure={measure}" / "data_0.parquet")


def build() -> tuple[int, int]:
    """Build kg_nodes and kg_edges from local references. Returns (nodes, edges)."""
    import duckdb
    import pandas as pd

    g = harmonize.genes(9606)
    con = duckdb.connect()
    con.execute("set preserve_insertion_order = false")
    con.execute("set enable_progress_bar = false")

    # Gene nodes: every approved HGNC locus with a current (Ensembl 116) gene,
    # keyed by the Ensembl id. The few Ensembl genes that carry two HGNC records
    # keep the record whose symbol Ensembl itself uses.
    genes = pd.DataFrame([r for r in g.records.values() if r["ensembl_gene_id"]])
    genes["_primary"] = [g.current[e]["name"] == s for e, s in zip(genes["ensembl_gene_id"], genes["symbol"])]
    genes = genes.sort_values(["ensembl_gene_id", "_primary"], ascending=[True, False])
    sym2id = {r["symbol"]: r["ensembl_gene_id"] for r in g.records.values() if r["ensembl_gene_id"]}
    cache: dict = {}

    def to_ensembl(keys) -> list:
        """Symbols (or Ensembl ids) -> current Ensembl gene id; None when unresolved or ambiguous."""
        out = []
        for k in keys:
            e = sym2id.get(k)
            if e is None:
                if k not in cache:
                    r = g.resolve(k)
                    cache[k] = r.id if r.ok else None
                e = cache[k]
            out.append(e)
        return out

    edges: list[pd.DataFrame] = []

    # STRING: protein ids -> preferred names -> Ensembl gene.
    s = REFERENCE_DIR / "string"
    info = pd.read_csv(s / "9606.protein.info.v12.0.txt.gz", sep="\t", usecols=[0, 1])
    info.columns = ["protein", "name"]
    info["gene_id"] = to_ensembl(info["name"])
    con.register("string_info", info)
    string = con.execute(f"""
        select a.gene_id as src, b.gene_id as dst, 'INTERACTS_WITH' as type, 'STRING v12.0' as source,
               max(l.combined_score) / 1000.0 as weight
        from read_csv('{s / "9606.protein.links.v12.0.txt.gz"}', delim=' ', header=true) l
        join string_info a on a.protein = l.protein1
        join string_info b on b.protein = l.protein2
        where l.combined_score >= {STRING_MIN_SCORE} and a.gene_id is not null and b.gene_id is not null
          and a.gene_id < b.gene_id
        group by 1, 2
    """).df()
    edges.append(string)

    # Reactome gene sets.
    rows, pathways = [], []
    with open(REFERENCE_DIR / "reactome" / "ReactomePathways.gmt", encoding="utf-8") as fh:
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            name, pid, members = parts[0], parts[1], parts[2:]
            pathways.append((pid, name))
            for e in to_ensembl(members):
                if e:
                    rows.append((e, pid))
    edges.append(pd.DataFrame(rows, columns=["src", "dst"]).drop_duplicates()
                 .assign(type="IN_PATHWAY", source="Reactome", weight=1.0))

    # Open Targets mechanisms: drug -> Ensembl target, kept only if current in Ensembl 116.
    ot = REFERENCE_DIR / "opentargets"
    moa = con.execute(f"""
        select unnest(chemblIds) as drug, unnest(targets) as ensg, actionType as action
        from (select chemblIds, targets, actionType
              from read_parquet('{ot}/drug_mechanism_of_action/**/*.parquet'))
    """).df()
    moa["dst"] = to_ensembl(moa["ensg"])
    moa = moa.dropna(subset=["dst"])
    edges.append(pd.DataFrame({"src": moa["drug"], "dst": moa["dst"], "type": "TARGETS",
                               "source": "Open Targets 26.09 (" + moa["action"].fillna("") + ")",
                               "weight": 1.0}).drop_duplicates(["src", "dst"]))
    drugs = con.execute(
        f"select id, name, drugType, maximumClinicalStage from read_parquet('{ot}/drug_molecule/**/*.parquet')"
    ).df()

    # DepMap: cell line -> gene, harmonized by Entrez id -> Ensembl.
    ent2id = {r["entrez_id"]: r["ensembl_gene_id"] for r in g.records.values()
              if r["entrez_id"] and r["ensembl_gene_id"]}
    con.register("ent", pd.DataFrame({"entrez_id": [int(k) for k in ent2id], "gene_id": list(ent2id.values())}))
    for etype, measure, cond, src in (
        ("DEPENDS_ON", "gene_dependency", f"value >= {DEPENDENCY_MIN}", "DepMap 26Q1 Chronos dependency"),
        ("AMPLIFIED", "copy_number_wgs", f"value >= {AMPLIFIED_MIN_CN}", "DepMap 26Q1 WGS relative CN"),
        ("HAS_HOTSPOT", "mutation_hotspot", "value > 0", "DepMap 26Q1 hotspot mutations"),
    ):
        path = _depmap(measure)
        if not Path(path).exists():
            continue
        edges.append(con.execute(f"""
            select m.model_id as src, e.gene_id as dst, '{etype}' as type, '{src}' as source,
                   m.value::double as weight
            from read_parquet('{path}') m join ent e using (entrez_id)
            where {cond} and m.model_id is not null
        """).df())

    models_path = lake.LOCAL_LAKE / "depmap_models" / f"release={DEPMAP_RELEASE}" / "data_0.parquet"
    models = con.execute(f"select * from read_parquet('{models_path}')").df() if models_path.exists() else pd.DataFrame()

    # Tahoe: which drugs were profiled on which lines.
    tahoe = lake.LOCAL_LAKE / "tahoe_samples" / "data_0.parquet"
    tdrugs = lake.LOCAL_LAKE / "tahoe_drugs" / "data_0.parquet"
    tcells = lake.LOCAL_LAKE / "tahoe_cell_lines" / "data_0.parquet"
    if tahoe.exists() and tdrugs.exists() and tcells.exists():
        cols = [r[0] for r in con.execute(f"describe select * from read_parquet('{tdrugs}')").fetchall()]
        name_col = "drug" if "drug" in cols else cols[0]
        edges.append(con.execute(f"""
            select distinct d.chembl_id as src, c.Cell_ID_DepMap as dst, 'PROFILED_WITH' as type,
                   'Tahoe-100M' as source, 1.0 as weight
            from read_parquet('{tdrugs}') d
            cross join (select distinct Cell_ID_DepMap from read_parquet('{tcells}')
                        where Cell_ID_DepMap is not null) c
            where d.chembl_id is not null
        """).df())

    all_edges = pd.concat(edges, ignore_index=True)
    all_edges["weight"] = all_edges["weight"].astype("float32")

    nodes = [
        pd.DataFrame({"id": genes["ensembl_gene_id"], "label": "Gene", "name": genes["symbol"],
                      "xref": genes["hgnc_id"], "group": genes["locus_group"]}),
        pd.DataFrame(pathways, columns=["id", "name"]).drop_duplicates("id").assign(label="Pathway", xref=None, group=None),
        pd.DataFrame({"id": drugs["id"], "label": "Drug", "name": drugs["name"],
                      "xref": drugs["drugType"], "group": drugs["maximumClinicalStage"]}),
    ]
    if not models.empty:
        nodes.append(pd.DataFrame({"id": models["model_id"], "label": "CellLine", "name": models["cell_line_name"],
                                   "xref": models["rrid"], "group": models["lineage"],
                                   }))
    all_nodes = pd.concat(nodes, ignore_index=True)[["id", "label", "name", "xref", "group"]]
    all_nodes = all_nodes.dropna(subset=["id"]).drop_duplicates("id")

    known = set(all_nodes["id"])
    before = len(all_edges)
    all_edges = all_edges[all_edges["src"].isin(known) & all_edges["dst"].isin(known)]
    dangling = before - len(all_edges)

    lake.write_dataset("kg_nodes", all_nodes)
    lake.write_dataset("kg_edges", all_edges.sort_values(["type", "src", "dst"]))
    print(f"  kg: {len(all_nodes):,} nodes, {len(all_edges):,} edges ({dangling:,} dropped: endpoint not a node)")
    print("  by type:", all_edges["type"].value_counts().to_dict())
    return len(all_nodes), len(all_edges)


def connect():
    import duckdb
    con = duckdb.connect()
    con.execute(f"create view nodes as select * from read_parquet('{lake.LOCAL_LAKE}/kg_nodes/**/*.parquet')")
    con.execute(f"create view edges as select * from read_parquet('{lake.LOCAL_LAKE}/kg_edges/**/*.parquet')")
    effect = _depmap("gene_effect")
    if Path(effect).exists():
        con.execute(f"create view gene_effect as select * from read_parquet('{effect}')")
    return con


def selective_dependencies(con, *, amplified_gene: str, lineage: str | None = None,
                           min_lines: int = 3, limit: int = 25):
    """
    Genes that lines carrying `amplified_gene` amplification depend on, and lines
    without it (same lineage when given) do not. The worked example of a question
    that needs four hops: CellLine -AMPLIFIED-> Gene, CellLine -DEPENDS_ON-> Gene,
    and the complement set.

    Returns rows of (gene, dependent fraction in amplified lines, in others,
    difference, line counts, Fisher p, BH q), ranked by q. The dependency call
    is DepMap's probability >= 0.5 and "amplified" is relative CN >= 2.0; both
    are thresholds, and the q-values are only as good as them.
    """
    lineage_filter = "and n.\"group\" = ?" if lineage else ""
    params = [amplified_gene] + ([lineage] if lineage else [])
    df = con.execute(f"""
        with target as (select id from nodes where label = 'Gene' and name = ?),
        lines as (select id, "group" from nodes n where label = 'CellLine' {lineage_filter}),
        screened as (select distinct e.src as line from edges e join lines l on l.id = e.src
                     where e.type = 'DEPENDS_ON'),
        amp as (select distinct e.src as line from edges e join target t on t.id = e.dst
                where e.type = 'AMPLIFIED' and e.src in (select line from screened)),
        other as (select line from screened where line not in (select line from amp)),
        dep as (select e.src as line, e.dst as gene from edges e where e.type = 'DEPENDS_ON'
                and e.src in (select line from screened)),
        stats as (
            select d.gene,
                   count(*) filter (where d.line in (select line from amp))::double
                       / greatest((select count(*) from amp), 1) as frac_amp,
                   count(*) filter (where d.line in (select line from other))::double
                       / greatest((select count(*) from other), 1) as frac_other,
                   count(*) filter (where d.line in (select line from amp)) as n_amp_dep
            from dep d group by d.gene)
        select g.name as gene, round(frac_amp, 3) as frac_dependent_amplified,
               round(frac_other, 3) as frac_dependent_other,
               round(frac_amp - frac_other, 3) as difference,
               n_amp_dep,
               (select count(*) from amp) as n_amplified_lines,
               (select count(*) from other) as n_other_lines
        from stats s join nodes g on g.id = s.gene
        where n_amp_dep >= {int(min_lines)} and frac_amp > frac_other
    """, params).df()
    return _with_fisher(df).head(int(limit))


def _with_fisher(df):
    """
    One-sided Fisher exact test per gene (dependent more often in amplified
    lines) and Benjamini-Hochberg q over every gene tested, so a ranking built
    on 14 lines against 39 says how much of it could be chance.
    """
    import numpy as np
    from scipy.stats import false_discovery_control, fisher_exact

    if df.empty:
        return df.assign(p_value=[], q_value=[])
    p = []
    for r in df.itertuples():
        n_oth_dep = round(r.frac_dependent_other * r.n_other_lines)
        table = [[r.n_amp_dep, r.n_amplified_lines - r.n_amp_dep],
                 [n_oth_dep, r.n_other_lines - n_oth_dep]]
        p.append(fisher_exact(table, alternative="greater").pvalue)
    df = df.assign(p_value=np.array(p))
    df["q_value"] = false_discovery_control(df["p_value"].to_numpy(), method="bh")
    return df.sort_values(["q_value", "difference"], ascending=[True, False]).drop(columns="n_amp_dep")


def export_neo4j(out_dir: Path) -> list[Path]:
    """neo4j-admin database import full --nodes=... --relationships=... input files."""
    con = connect()
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for label in [r[0] for r in con.execute("select distinct label from nodes").fetchall()]:
        path = out_dir / f"nodes_{label}.csv.gz"
        df = con.execute("select id as \"id:ID\", name, xref, \"group\", label as \":LABEL\" from nodes where label = ?",
                         [label]).df()
        with gzip.open(path, "wt") as fh:
            df.to_csv(fh, index=False)
        written.append(path)
    for etype in [r[0] for r in con.execute("select distinct type from edges").fetchall()]:
        path = out_dir / f"rels_{etype}.csv.gz"
        df = con.execute("select src as \":START_ID\", dst as \":END_ID\", source, weight as \"weight:float\", "
                         "type as \":TYPE\" from edges where type = ?", [etype]).df()
        with gzip.open(path, "wt") as fh:
            df.to_csv(fh, index=False)
        written.append(path)
    return written
