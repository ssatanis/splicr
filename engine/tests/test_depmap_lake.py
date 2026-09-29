"""
The DepMap lake must be the release's CSVs, reshaped and nothing else.

Checks, per built measure: the non-null cell count equals the CSV's, a random
sample of cells round-trips exactly (to float32), and files are gene-sorted so
DuckDB can prune row groups on a gene lookup.
"""

from __future__ import annotations

import random
from pathlib import Path

import numpy as np
import pytest

from splicr import lake
from splicr.config import DEPMAP_DIR

RELEASE = "26Q1"
ROOT = lake.LOCAL_LAKE / "depmap_matrix" / f"release={RELEASE}"

MODEL_LEVEL = {
    "gene_effect": "CRISPRGeneEffect.csv",
    "gene_dependency": "CRISPRGeneDependency.csv",
}


def _built(measure: str) -> Path:
    path = ROOT / f"measure={measure}" / "data_0.parquet"
    if not path.exists() or not (DEPMAP_DIR / RELEASE / MODEL_LEVEL[measure]).exists():
        pytest.skip(f"{measure} not built for {RELEASE}")
    return path


@pytest.fixture(scope="module")
def duck():
    import duckdb
    return duckdb.connect()


@pytest.mark.parametrize("measure", sorted(MODEL_LEVEL))
def test_counts_and_values_round_trip(measure, duck):
    import pandas as pd

    path = _built(measure)
    src = pd.read_csv(DEPMAP_DIR / RELEASE / MODEL_LEVEL[measure], index_col=0, engine="pyarrow")
    assert duck.execute(f"select count(*) from read_parquet('{path}')").fetchone()[0] == int(src.notna().sum().sum())

    rng = random.Random(7)
    cells = []
    while len(cells) < 300:
        model, label = rng.choice(src.index), rng.choice(src.columns)
        if not np.isnan(src.at[model, label]):
            cells.append((model, label.split(" (")[0], int(label.rsplit("(", 1)[1][:-1]), src.at[model, label]))
    duck.execute("create or replace temp table probe (model_id varchar, gene_symbol varchar, entrez_id int, expected double)")
    duck.executemany("insert into probe values (?, ?, ?, ?)", cells)
    got = duck.execute(
        f"select p.expected, t.value from probe p join read_parquet('{path}') t "
        "using (model_id, gene_symbol, entrez_id)"
    ).fetchall()
    assert len(got) == len(cells)
    for expected, value in got:
        assert value == pytest.approx(np.float32(expected), rel=1e-6, abs=1e-7)


def test_files_are_gene_sorted(duck):
    path = _built("gene_effect")
    unsorted = duck.execute(
        f"select count(*) from (select gene_symbol, lag(gene_symbol) over () as prev "
        f"from read_parquet('{path}')) where prev > gene_symbol"
    ).fetchone()[0]
    assert unsorted == 0


def test_models_are_harmonized_to_cellosaurus(duck):
    path = lake.LOCAL_LAKE / "depmap_models" / f"release={RELEASE}" / "data_0.parquet"
    if not path.exists():
        pytest.skip("depmap_models not built")
    n, with_rrid, chronos, chronos_rrid = duck.execute(
        f"select count(*), count(rrid), count(*) filter (where in_chronos), "
        f"count(rrid) filter (where in_chronos) from read_parquet('{path}')"
    ).fetchone()
    assert chronos == 1208
    # 26Q1: 1,187 of 1,208. The rest (new NRH-* patient-derived lines, engineered
    # derivatives such as A549_CRAF_KD) have no Cellosaurus entry yet. Every
    # model that does have one must carry it.
    assert chronos_rrid / chronos >= 0.98
    assert with_rrid / n > 0.9
    from splicr import harmonize
    missing = duck.execute(
        f"select model_id from read_parquet('{path}') where in_chronos and rrid is null").fetchall()
    cells = harmonize.cell_lines()
    assert not [m for (m,) in missing if cells.resolve(m).ok]
