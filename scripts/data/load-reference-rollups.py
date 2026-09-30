#!/usr/bin/env python
"""
Load the small reference rollups into Postgres from the lake.

    engine/.tools/env/bin/python scripts/data/load-reference-rollups.py            # dry run: counts only
    engine/.tools/env/bin/python scripts/data/load-reference-rollups.py --go

Writes, each in one transaction, replacing the release's rows:

    atlas.gene_dependency   DepMap 26Q1 per-gene Chronos summary (~18.5k rows), keyed by
                            Ensembl gene id through harmonize.enforce; unmappable genes
                            are quarantined to data/work/quarantine/, not written
    atlas.cell_models       DepMap models with Cellosaurus RRIDs (~2.2k rows)
    atlas.gene_stats        BioGRID ORCS per-gene hit frequency (~87k rows) and
                            is_common_essential from the DepMap summary
    atlas.data_sources      engine/splicr/sources.py

These are the tables `atlas_corpus_state()` and the Hit Report join against.
Guide-level and matrix data stay in the lake; see engine/splicr/lake.py for why.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "engine"))

from splicr import lake, sources  # noqa: E402
from splicr.config import REFERENCE_DIR  # noqa: E402

RELEASE = "26Q1"


def gene_dependency_rows(con):
    dep = lake.LOCAL_LAKE / "depmap_matrix" / f"release={RELEASE}"
    models = lake.LOCAL_LAKE / "depmap_models" / f"release={RELEASE}" / "data_0.parquet"
    return con.execute(f"""
        with e as (select gene_symbol, entrez_id, model_id, value
                   from read_parquet('{dep}/measure=gene_effect/data_0.parquet')),
        p as (select gene_symbol, entrez_id, model_id, value
              from read_parquet('{dep}/measure=gene_dependency/data_0.parquet')),
        m as (select model_id, lineage from read_parquet('{models}')),
        eff as (select gene_symbol, entrez_id, count(*) n, avg(value) mean, median(value) med, min(value) mn
                from e group by 1, 2),
        dep as (select gene_symbol, entrez_id, count(*) filter (where value >= 0.5) n_dep, count(*) n_p
                from p group by 1, 2),
        lin as (select p.gene_symbol, p.entrez_id, m.lineage,
                       count(*) filter (where p.value >= 0.5)::double / count(*) as frac, count(*) as n
                from p join m using (model_id) where m.lineage is not null group by 1, 2, 3 having count(*) >= 10),
        toplin as (select gene_symbol, entrez_id,
                          to_json(list({{'lineage': lineage, 'frac_dependent': round(frac, 3), 'n_lines': n}}
                                       order by frac desc)[1:3]) as top
                   from lin where frac > 0 group by 1, 2)
        select eff.gene_symbol, '{RELEASE}', eff.entrez_id, eff.n::int, eff.mean::real, eff.med::real, eff.mn::real,
               coalesce(dep.n_dep, 0)::int, (coalesce(dep.n_dep, 0)::double / greatest(dep.n_p, 1))::real as frac,
               coalesce(t.top, '[]')::varchar
        from eff left join dep using (gene_symbol, entrez_id) left join toplin t using (gene_symbol, entrez_id)
    """).fetchall()


def _f(v):
    return None if v is None or v != v else float(v)


def main() -> int:
    import duckdb

    ap = argparse.ArgumentParser()
    ap.add_argument("--go", action="store_true", help="write to the database")
    args = ap.parse_args()

    con = duckdb.connect()
    con.execute("set enable_progress_bar = false")

    # The harmonization gate: every DepMap gene is keyed by its Ensembl 116 id
    # (via "SYMBOL (entrez)", the Entrez id deciding) before it reaches Postgres.
    # Genes that cannot be mapped are quarantined to the work dir, not written.
    import pandas as pd

    from splicr import harmonize
    from splicr.config import WORK_DIR

    cols = ["gene_symbol", "release", "entrez_id", "n_lines", "mean_effect", "median_effect", "min_effect",
            "n_dependent", "frac_dependent", "top_lineages"]
    dep = pd.DataFrame(gene_dependency_rows(con), columns=cols)
    dep["gene_key"] = [f"{s} ({e})" if e is not None and e == e else s
                       for s, e in zip(dep["gene_symbol"], dep["entrez_id"])]
    clean, quarantine = harmonize.enforce(dep, taxid=9606, gene_col="gene_key", min_rate=0.95)
    g = harmonize.genes(9606)
    clean["hgnc_id"] = [g.resolve(k).xrefs.get("hgnc_id") for k in clean["gene_key"]]
    if len(quarantine):
        qdir = WORK_DIR / "quarantine"
        qdir.mkdir(parents=True, exist_ok=True)
        qpath = qdir / f"gene_dependency_{RELEASE}.csv"
        quarantine.drop(columns=["top_lineages"]).to_csv(qpath, index=False)
    dep_rows = [
        (r.gene_symbol, r.release, r.hgnc_id, r.ensembl_gene_id,
         None if r.entrez_id is None or r.entrez_id != r.entrez_id else int(r.entrez_id),
         int(r.n_lines), _f(r.mean_effect), _f(r.median_effect), _f(r.min_effect), int(r.n_dependent),
         float(r.frac_dependent), bool(r.frac_dependent >= 0.9), bool(0.01 <= r.frac_dependent <= 0.5),
         r.top_lineages)
        for r in clean.itertuples()]
    common = {r[0] for r in dep_rows if r[11]}

    models = con.execute(f"""
        select cell_line_name, rrid, model_id, sanger_model_id, lineage, primary_disease, subtype,
               in_chronos, rrid_source
        from read_parquet('{lake.LOCAL_LAKE}/depmap_models/release={RELEASE}/data_0.parquet')""").fetchall()

    orcs = con.execute(f"""
        select symbol, n_screens_tested, n_hits, hit_rate
        from read_parquet('{REFERENCE_DIR}/orcs/atlas/gene_stats.parquet')
        where symbol is not null and n_screens_tested > 0""").fetchall()

    src_rows = [(s.id, s.name, s.layer, s.modality, s.scale, s.access, s.url, s.licence, s.status,
                 s.holdings, list(s.lake_datasets), list(s.harmonized_to), s.notes or None)
                for s in sources.SOURCES]

    print(f"gene_dependency {len(dep_rows):,} rows ({len(common):,} common essential, "
          f"{sum(r[12] for r in dep_rows):,} selective); {len(quarantine):,} quarantined "
          f"(no current Ensembl gene or ambiguous){f', see {qpath}' if len(quarantine) else ''}")
    print(f"cell_models     {len(models):,} rows ({sum(1 for m in models if m[1]):,} with RRID)")
    print(f"gene_stats      {len(orcs):,} rows from BioGRID ORCS")
    print(f"data_sources    {len(src_rows)} rows")
    if not args.go:
        print("dry run; pass --go to write")
        return 0

    from splicr import db
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("delete from atlas.gene_dependency where release = %s", (RELEASE,))
        with cur.copy("copy atlas.gene_dependency (gene_symbol, release, hgnc_id, ensembl_gene_id, entrez_id, n_lines, "
                      "mean_effect, median_effect, min_effect, n_dependent, frac_dependent, "
                      "is_common_essential, is_selective, top_lineages) from stdin") as cp:
            for row in dep_rows:
                cp.write_row(row)

        # Cell models: keyed by DepMap id; the RRID unique index means two DepMap
        # models that share a Cellosaurus parent keep the first and drop the RRID
        # on the rest rather than failing the load.
        cur.execute("delete from atlas.cell_models where depmap_id is not null")
        seen_rrid = set()
        for name, rrid, mid, sidm, lineage, disease, subtype, chronos, rsrc in models:
            if rrid in seen_rrid:
                rrid, rsrc = None, "duplicate RRID across DepMap models"
            seen_rrid.add(rrid)
            cur.execute(
                "insert into atlas.cell_models (name, cellosaurus_id, depmap_id, sanger_id, lineage, tissue, "
                "disease, in_chronos, rrid_source, metadata) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (name or mid, rrid, mid, sidm, lineage, lineage, disease, bool(chronos), rsrc,
                 json.dumps({"subtype": subtype, "source": f"DepMap {RELEASE}"})))

        cur.execute("truncate atlas.gene_stats")
        with cur.copy("copy atlas.gene_stats (gene_symbol, n_screens, n_hits, hit_rate, is_common_essential, "
                      "is_frequent_hitter) from stdin") as cp:
            for sym, n, hits, rate in orcs:
                cp.write_row((sym, n, hits, rate, sym in common, (rate or 0) > 0.25))
        cur.execute("""update atlas.gene_stats s set gene_id = g.id
                       from atlas.genes g where g.taxid = 9606 and g.symbol = s.gene_symbol""")

        cur.execute("delete from atlas.data_sources")
        cur.executemany(
            "insert into atlas.data_sources (id, name, layer, modality, scale, access, url, licence, status, "
            "holdings, lake_datasets, harmonized_to, notes) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            src_rows)
        conn.commit()
    print("written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
