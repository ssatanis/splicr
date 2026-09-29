#!/usr/bin/env python
"""
Build the DepMap part of the reference lake from one release's CSV downloads.

    engine/.tools/env/bin/python scripts/data/build-depmap-lake.py --release 26Q1
    engine/.tools/env/bin/python scripts/data/build-depmap-lake.py --release 26Q1 --only matrix
    engine/.tools/env/bin/python scripts/data/build-depmap-lake.py --release 26Q1 --upload

Reads data/references/depmap/<release>/ and writes Parquet under data/lake/:

    depmap_matrix/release=26Q1/measure=<m>/   long form, sorted gene then model
    depmap_models/release=26Q1/                ModelID -> Cellosaurus RRID
    depmap_raw_readcounts/release=26Q1/        Avana raw counts, wide
    depmap_<table>/release=26Q1/                sequence, screen and guide maps

DepMap files come from the portal's download page, which sits behind a browser
verification step. They are fetched by hand, placed in the release directory and
checksummed there (MD5SUMS.txt); nothing here downloads them.

DepMap Public data are CC BY 4.0, so, unlike Project Score, these files may be
redistributed on R2 with attribution. See SOURCES.txt in the release directory.

Every matrix keeps DepMap's values untransformed. In particular OmicsCNGeneWGS is
linear relative copy number and expression is log2(TPM + 1); readers must not
assume otherwise.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "engine"))

from splicr import lake  # noqa: E402
from splicr.config import DEPMAP_DIR  # noqa: E402

# measure name -> (file, id column kind). "model" rows are ACH- ids, "screen"
# rows are SC- ids (joined to a model through CRISPRScreenMap), "omics" files
# carry their own SequencingID/ModelID columns and one row per profile.
MATRICES: dict[str, tuple[str, str]] = {
    "gene_effect": ("CRISPRGeneEffect.csv", "model"),
    "gene_dependency": ("CRISPRGeneDependency.csv", "model"),
    "screen_gene_effect": ("ScreenGeneEffect.csv", "screen"),
    "screen_gene_effect_uncorrected": ("ScreenGeneEffectUncorrected.csv", "screen"),
    "screen_gene_dependency": ("ScreenGeneDependency.csv", "screen"),
    "expression_tpm_log1p": ("OmicsExpressionTPMLogp1HumanProteinCodingGenes.csv", "omics"),
    "copy_number_wgs": ("OmicsCNGeneWGS.csv", "omics"),
    "mutation_damaging": ("OmicsSomaticMutationsMatrixDamaging.csv", "omics"),
    "mutation_hotspot": ("OmicsSomaticMutationsMatrixHotspot.csv", "omics"),
}

OMICS_META = (
    "SequencingID", "ModelID", "ModelConditionID",
    "IsDefaultEntryForModel", "IsDefaultEntryForMC",
)


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"


def snake(name: str) -> str:
    out = []
    for i, ch in enumerate(name):
        if ch.isupper() and i and (not name[i - 1].isupper() or (i + 1 < len(name) and name[i + 1].islower())):
            out.append("_")
        out.append(ch.lower())
    return "".join(out).replace(" ", "_")


def read_matrix(path: Path, kind: str, release: str):
    """
    Returns (row ids, per-row screen ids, per-row sequencing ids, gene labels,
    float32 values [rows x genes]).

    Dense in memory on purpose: the largest matrix here, expression, is 1,775 x
    19,220 float32, about 136 MB. The earlier DuckDB UNPIVOT of the same CSV,
    followed by a sort to gene-major order, ran out of memory at a 5 GB limit.
    """
    import numpy as np
    import pandas as pd

    df = pd.read_csv(path, engine="pyarrow")
    first = df.columns[0]
    screen_ids = seq_ids = None
    if kind == "omics":
        df = df[df["IsDefaultEntryForModel"] == "Yes"]
        ids = df["ModelID"].astype(str).to_numpy()
        seq_ids = df["SequencingID"].astype(str).to_numpy()
        genes = [c for c in df.columns if c != first and c not in OMICS_META]
    else:
        ids = df[first].astype(str).to_numpy()
        genes = [c for c in df.columns if c != first]
        if kind == "screen":
            smap = pd.read_csv(DEPMAP_DIR / release / "CRISPRScreenMap.csv")
            to_model = dict(zip(smap["ScreenID"], smap["ModelID"]))
            screen_ids = ids
            ids = np.array([to_model.get(s, "") for s in screen_ids], dtype=object)
    values = df[genes].to_numpy(dtype=np.float32)
    return ids, screen_ids, seq_ids, genes, values


def matrix_table(ids, screen_ids, seq_ids, genes, values):
    """Long form, gene-major, as an Arrow table with dictionary-encoded ids."""
    import numpy as np
    import pyarrow as pa

    symbols = np.array([g.split(" (")[0] for g in genes], dtype=object)
    entrez = np.array(
        [int(g.rsplit("(", 1)[1].rstrip(")")) if "(" in g and g.rsplit("(", 1)[1].rstrip(")").isdigit() else -1
         for g in genes], dtype=np.int32)
    row_key = screen_ids if screen_ids is not None else ids
    g_order = np.lexsort((entrez, symbols))
    r_order = np.lexsort((row_key, ids))
    v = values[r_order][:, g_order].T  # genes x rows, gene-major
    n_rows = len(r_order)
    gene_idx = np.repeat(np.arange(len(g_order), dtype=np.int32), n_rows)
    row_idx = np.tile(np.arange(n_rows, dtype=np.int32), len(g_order))
    flat = v.ravel()
    keep = ~np.isnan(flat)
    gene_idx, row_idx, flat = gene_idx[keep], row_idx[keep], flat[keep]

    def dict_col(index, dictionary):
        # Nulls go in the indices, never the dictionary: Parquet cannot write a
        # dictionary that encodes null. An empty id (a screen CRISPRScreenMap
        # does not list) becomes a null row.
        dictionary = ["" if d is None else str(d) for d in dictionary]
        empty = np.array([d == "" for d in dictionary], dtype=bool)
        return pa.DictionaryArray.from_arrays(
            pa.array(index, pa.int32(), mask=empty[index]), pa.array(dictionary, pa.string()))

    ent = entrez[g_order][gene_idx]
    cols = {
        "gene_symbol": dict_col(gene_idx, list(symbols[g_order])),
        "entrez_id": pa.array(ent, pa.int32(), mask=ent < 0),
        "model_id": dict_col(row_idx, list(ids[r_order])),
        "screen_id": (dict_col(row_idx, list(screen_ids[r_order])) if screen_ids is not None
                      else pa.nulls(len(flat), pa.string())),
        "sequencing_id": (dict_col(row_idx, list(seq_ids[r_order])) if seq_ids is not None
                          else pa.nulls(len(flat), pa.string())),
        "value": pa.array(flat, pa.float32()),
    }
    return pa.table(cols)


def build_matrices(release: str, only: set[str] | None, upload: bool) -> None:
    import pyarrow.parquet as pq

    for measure, (fname, kind) in MATRICES.items():
        if only and measure not in only:
            continue
        path = DEPMAP_DIR / release / fname
        if not path.exists():
            print(f"  skip {measure}: {path.name} not present")
            continue
        started = time.time()
        table = matrix_table(*read_matrix(path, kind, release))
        out = lake.LOCAL_LAKE / "depmap_matrix" / f"release={release}" / f"measure={measure}"
        out.mkdir(parents=True, exist_ok=True)
        target = out / "data_0.parquet"
        # One file per partition so a measure can be rebuilt on its own. The
        # partition keys live in the path, as hive partitioning expects.
        pq.write_table(table, target, compression="zstd", row_group_size=122_880)
        print(f"  {measure:32s} {table.num_rows:>12,} rows  {human(target.stat().st_size):>9s}  "
              f"{time.time() - started:6.1f}s")
        del table
    if upload:
        print(f"  uploaded {lake.upload_dataset('depmap_matrix')} file(s)")


def build_models(release: str, upload: bool) -> None:
    """
    Cell model harmonization: DepMap ModelID is kept as the primary key and
    joined to its Cellosaurus RRID, which is how SplicR names a cell line
    everywhere else. Screen and omics coverage are counted so the app can tell
    "this line was screened" from "this line only has expression".
    """
    conn = lake.connect()
    d = DEPMAP_DIR / release
    started = time.time()
    sql = f"""
      with m as (select * from read_csv('{d / "Model.csv"}', header=true, all_varchar=true)),
      screens as (
        select ModelID, count(*) as n_screens, string_agg(distinct Library, ',') as libraries
        from read_csv('{d / "AchillesScreenQCReport.csv"}', header=true, all_varchar=true)
        where PassesQC = 'True' group by ModelID),
      chronos as (
        select distinct #1 as ModelID from read_csv('{d / "CRISPRGeneEffect.csv"}', header=true)),
      omics as (
        select ModelID, string_agg(distinct DataType, ',' order by DataType) as omics
        from read_csv('{d / "OmicsProfiles.csv"}', header=true, all_varchar=true) group by ModelID)
      select '{release}' as release,
             m.ModelID as model_id,
             m.CellLineName as cell_line_name,
             m.StrippedCellLineName as stripped_name,
             nullif(m.RRID, '') as rrid,
             m.OncotreeLineage as lineage,
             m.OncotreePrimaryDisease as primary_disease,
             m.OncotreeSubtype as subtype,
             m.OncotreeCode as oncotree_code,
             m.Sex as sex,
             try_cast(m.Age as float) as age,
             m.PrimaryOrMetastasis as primary_or_metastasis,
             m.SangerModelID as sanger_model_id,
             m.CCLEName as ccle_name,
             m.ModelType as model_type,
             m.GrowthPattern as growth_pattern,
             coalesce(s.n_screens, 0)::int as n_passing_screens,
             s.libraries as screen_libraries,
             (c.ModelID is not null) as in_chronos,
             o.omics as omics_types
      from m
      left join screens s on s.ModelID = m.ModelID
      left join chronos c on c.ModelID = m.ModelID
      left join omics o on o.ModelID = m.ModelID
      order by model_id
    """
    out = lake.LOCAL_LAKE / "depmap_models" / f"release={release}"
    out.mkdir(parents=True, exist_ok=True)
    target = out / "data_0.parquet"
    df = conn.execute(sql).df()

    # Cellosaurus is the authority for RRIDs. Where Model.csv has none, take the
    # Cellosaurus entry that cross-references this ModelID, then one whose name
    # matches exactly and uniquely. Where both have one and they disagree, keep
    # DepMap's and record the conflict rather than silently picking.
    from splicr import harmonize

    cells = harmonize.cell_lines()
    sources, conflicts = [], []
    for i, row in df.iterrows():
        by_id = cells.resolve(row.model_id)
        if row.rrid:
            sources.append("depmap_model_csv")
            conflicts.append(by_id.id if by_id.ok and by_id.id != row.rrid else None)
            continue
        conflicts.append(None)
        if by_id.ok:
            df.at[i, "rrid"] = by_id.id
            sources.append("cellosaurus_depmap_xref")
            continue
        by_name = cells.resolve(row.cell_line_name or "")
        if by_name.ok and by_name.matched_by == "name":
            df.at[i, "rrid"] = by_name.id
            sources.append("cellosaurus_name")
        else:
            sources.append(None)
    df["rrid_source"] = sources
    df["rrid_conflict_cellosaurus"] = conflicts
    conn.register("_models", df)
    conn.execute(f"copy (select * from _models order by model_id) to '{target}' (format parquet, compression zstd)")
    conn.unregister("_models")
    n_conf = sum(c is not None for c in conflicts)
    print(f"  RRID sources: {df.rrid_source.value_counts(dropna=False).to_dict()}; "
          f"{n_conf} Model.csv/Cellosaurus disagreements recorded")
    stats = conn.execute(
        f"select count(*), count(rrid), count(*) filter (where in_chronos), "
        f"count(*) filter (where in_chronos and rrid is null) from read_parquet('{target}')"
    ).fetchone()
    print(f"  depmap_models: {stats[0]:,} models, {stats[1]:,} with RRID, "
          f"{stats[2]:,} in Chronos ({stats[3]} of those lack an RRID)  "
          f"{time.time() - started:.1f}s")
    if upload:
        print(f"  uploaded {lake.upload_dataset('depmap_models')} file(s)")


def build_raw_readcounts(release: str, upload: bool) -> None:
    conn = lake.connect()
    path = DEPMAP_DIR / release / "AvanaRawReadcounts.csv"
    if not path.exists():
        print("  skip raw readcounts: not present")
        return
    started = time.time()
    conn.execute(
        f"create or replace view _raw as select * from read_csv('{path}', header=true, "
        "sample_size=2000)"
    )
    first = conn.execute("select column_name from (describe _raw) limit 1").fetchone()[0]
    out = lake.LOCAL_LAKE / "depmap_raw_readcounts" / f"release={release}"
    out.mkdir(parents=True, exist_ok=True)
    target = out / "data_0.parquet"
    conn.execute(
        f'copy (select "{first}" as sgrna, * exclude ("{first}") from _raw order by sgrna) '
        f"to '{target}' (format parquet, compression zstd, row_group_size 16384)"
    )
    cols = len(conn.execute(f"describe select * from read_parquet('{target}')").fetchall()) - 1
    print(f"  depmap_raw_readcounts: {cols:,} sequencing runs, {human(target.stat().st_size)} "
          f"{time.time() - started:.1f}s")
    if upload:
        print(f"  uploaded {lake.upload_dataset('depmap_raw_readcounts')} file(s)")


def build_tables(release: str, upload: bool) -> None:
    conn = lake.connect()
    for name, (fname, _desc) in lake.DEPMAP_TABLES.items():
        path = DEPMAP_DIR / release / fname
        if not path.exists():
            print(f"  skip {name}: {fname} not present")
            continue
        cols = [r[0] for r in conn.execute(
            f"describe select * from read_csv('{path}', header=true, sample_size=-1)").fetchall()]
        select = ", ".join(
            f'"{c}" as {snake(c) if c.strip() else "row_index"}' for c in cols
        )
        out = lake.LOCAL_LAKE / name / f"release={release}"
        out.mkdir(parents=True, exist_ok=True)
        target = out / "data_0.parquet"
        conn.execute(
            f"copy (select {select} from read_csv('{path}', header=true, sample_size=-1)) "
            f"to '{target}' (format parquet, compression zstd)"
        )
        n = conn.execute(f"select count(*) from read_parquet('{target}')").fetchone()[0]
        print(f"  {name:28s} {n:>8,} rows  {human(target.stat().st_size)}")
        if upload:
            lake.upload_dataset(name)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", required=True, help="e.g. 26Q1; a directory under data/references/depmap")
    ap.add_argument("--only", nargs="*", choices=["matrix", "models", "raw", "tables", *MATRICES],
                    help="build a subset; matrix names select single measures")
    ap.add_argument("--upload", action="store_true", help="push to R2 after writing")
    args = ap.parse_args()

    if not (DEPMAP_DIR / args.release).is_dir():
        print(f"no such release directory: {DEPMAP_DIR / args.release}", file=sys.stderr)
        return 1

    only = set(args.only or [])
    measures = only & set(MATRICES)
    want = lambda part: not only or part in only  # noqa: E731

    print(f"DepMap {args.release} -> {lake.LOCAL_LAKE}")
    if want("tables"):
        build_tables(args.release, args.upload)
    if want("models"):
        build_models(args.release, args.upload)
    if want("matrix") or measures:
        build_matrices(args.release, measures or None, args.upload)
    if want("raw"):
        build_raw_readcounts(args.release, args.upload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
