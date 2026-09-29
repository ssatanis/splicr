"""
The reference lake: bulk Atlas data as Parquet on R2, queried with DuckDB.

WHY THIS EXISTS

The Atlas reference tables do not belong in Postgres. Measured on the real data:
794,206 guide rows cost about 129 MB of heap and another 167 MB in the five
indexes that table carries, and atlas.genes adds 78 MB. Together with screen
results that came to roughly 440 MB against the 500 MB a Supabase free project
gets, and a bulk COPY on top of that, generating WAL and dead tuples, took the
database down: it began refusing connections with "the database system is not
accepting connections / Hot standby mode is disabled".

None of that data needed to be there. It is immutable published reference data,
identical for every tenant, never written by the application, and read in bulk
rather than by primary key. Postgres is paying index and WAL costs for something
that is really a column store. R2 gives 10 GB and free egress, DuckDB reads
Parquet over HTTP with range requests, and the engine already talks to both.

WHAT STAYS IN POSTGRES

Everything tenant-scoped and mutable, which is what Row Level Security is for:
organizations, members, screens, runs, comparisons, hits, flags, QC, validation
outcomes, API keys. Plus atlas.gene_stats, the small nightly rollup the web app
joins against, and atlas.genes, which is small enough and is needed for symbol
lookup in the command palette.

WHAT MOVES HERE

atlas.guides, atlas.copy_number, atlas.screen_hits and atlas.screens: the bulk,
immutable, cross-tenant reference tables.

PUSHDOWN IS THE POINT

DuckDB reads Parquet footers first and skips row groups whose statistics cannot
match the predicate, so a filtered query over a remote file transfers a few
hundred KB rather than the whole thing. That only works if the files are written
sorted on the column you filter by, which is why `write_dataset` sorts and why
the partition key is chosen per table rather than globally.
"""

from __future__ import annotations

import functools
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from .config import REFERENCE_DIR

LAKE_PREFIX = "lake"
LOCAL_LAKE = REFERENCE_DIR.parent / "lake"


@dataclass(frozen=True)
class Dataset:
    """One logical table in the lake."""

    name: str
    partition_by: tuple[str, ...]
    sort_by: tuple[str, ...]
    description: str

    @property
    def key(self) -> str:
        return f"{LAKE_PREFIX}/{self.name}"


# Sorted on whatever the engine actually filters by, so DuckDB can skip row
# groups instead of reading the file.
DATASETS: dict[str, Dataset] = {
    "guides": Dataset(
        "guides", ("library_slug",), ("library_slug", "gene_symbol", "guide_key"),
        "Every pooled library's guides, with coordinates and measured off-target counts.",
    ),
    "copy_number": Dataset(
        # Not partitioned: one directory per cell line would be 1,929 of them,
        # each a few hundred KB, and the per-file overhead over HTTP would cost
        # more than the pruning saves. Sorted on model_id instead, so row-group
        # statistics prune just as well from a handful of larger files.
        # No sort either. UNPIVOT emits one output row per input cell in input
        # order, so the result is already model-major, which is the only order
        # that matters for pushdown. Asking DuckDB to sort it anyway forces all
        # 74 million rows to be materialised at once and it runs out of memory.
        "copy_number", (), (),
        "DepMap relative copy number per gene per cell line. Linear ratio, not log2.",
    ),
    "screen_hits": Dataset(
        "screen_hits", ("source",), ("source", "screen_id", "gene_symbol"),
        "Per-gene hit calls from public screens, one row per screen and gene.",
    ),
    "screens": Dataset(
        "screens", (), ("source", "screen_id"),
        "Public screen metadata: cell line, phenotype, library, author, year.",
    ),
    # DepMap gene-level matrices, one partition per release and measure. Sorted
    # on gene then model, because the question the app asks is "this hit gene,
    # across every cell line", which then touches one row group per file.
    "depmap_matrix": Dataset(
        "depmap_matrix", ("release", "measure"), ("gene_symbol", "model_id"),
        "DepMap gene x model matrices in long form: Chronos effect, dependency "
        "probability, expression, WGS copy number and mutation calls.",
    ),
    # Harmonized cell models: DepMap ModelID joined to its Cellosaurus RRID.
    "depmap_models": Dataset(
        "depmap_models", ("release",), ("model_id",),
        "DepMap models with Cellosaurus RRID, lineage, disease and screen coverage.",
    ),
    # Raw Avana guide read counts, kept wide (guide rows x sequence columns) so a
    # reanalysis selects the handful of sequencing runs in one screen by column
    # projection instead of scanning 170 million long-form rows.
    "depmap_raw_readcounts": Dataset(
        "depmap_raw_readcounts", ("release",), ("sgrna",),
        "Raw Avana sgRNA read counts, one column per sequencing run.",
    ),
}

# The small DepMap tables that let the raw counts be reprocessed and every row be
# traced to a sequencing run. Each keeps its source columns, snake_cased, so one
# dataset per file rather than a union with a lowest-common-denominator schema.
DEPMAP_TABLES: dict[str, tuple[str, str]] = {
    "depmap_sequence_map": ("ScreenSequenceMap.csv", "Sequencing run -> screen, pDNA batch, library, QC pass."),
    "depmap_screen_map": ("CRISPRScreenMap.csv", "Screen -> model, library and whether Chronos used it."),
    "depmap_guide_map": ("AvanaGuideMap.csv", "Avana sgRNA -> genome alignment, gene and drop reason."),
    "depmap_screen_qc": ("AchillesScreenQCReport.csv", "Per-screen QC: NNMD, ROC-AUC, replicate agreement."),
    "depmap_sequence_qc": ("AchillesSequenceQCReport.csv", "Per-sequencing-run QC metrics."),
    "depmap_model_conditions": ("ModelCondition.csv", "Culture condition per model: media, format, drug."),
    "depmap_omics_profiles": ("OmicsProfiles.csv", "Omics profile -> model, data type, platform, date."),
}
for _name, (_file, _desc) in DEPMAP_TABLES.items():
    DATASETS[_name] = Dataset(_name, ("release",), (), _desc)


# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------

@functools.lru_cache(maxsize=1)
def connect(read_only_remote: bool = True):
    """
    A DuckDB connection configured to read the lake.

    R2 speaks the S3 API, so the httpfs extension works unchanged once the
    endpoint is pointed at the account's R2 host. `url_style = 'path'` matters:
    R2 does not serve virtual-host style buckets, and the default would resolve
    to a hostname that does not exist.
    """
    import duckdb

    conn = duckdb.connect(":memory:")
    conn.execute("install httpfs; load httpfs;")
    # Streaming settings for the wide reference matrices. Insertion order costs
    # memory proportional to the whole result when a COPY is fed by a 74 million
    # row UNPIVOT, and nothing downstream depends on it.
    conn.execute("set preserve_insertion_order = false")
    conn.execute(f"set memory_limit = '{os.environ.get('SPLICR_DUCKDB_MEMORY', '6GB')}'")
    conn.execute("set temp_directory = '/tmp/splicr-duckdb'")

    account = os.environ.get("R2_ACCOUNT_ID", "")
    key_id = os.environ.get("R2_ACCESS_KEY_ID", "")
    secret = os.environ.get("R2_SECRET_ACCESS_KEY", "")
    if account and key_id and secret:
        conn.execute(
            """
            create or replace secret r2 (
                type s3,
                key_id ?,
                secret ?,
                endpoint ?,
                url_style 'path',
                use_ssl true,
                region 'auto'
            )
            """,
            [key_id, secret, f"{account}.r2.cloudflarestorage.com"],
        )
    return conn


def source(name: str, prefer_local: bool | None = None) -> str:
    """
    The path DuckDB should read a dataset from.

    Local files win when they are present, because a run on a laptop that has
    already downloaded the lake should not pay for a network round trip per
    query. Set SPLICR_LAKE_REMOTE=1 to force the remote copy, which is what the
    freshness check does.
    """
    if name not in DATASETS:
        raise KeyError(f"unknown dataset {name!r}; have {sorted(DATASETS)}")

    if prefer_local is None:
        prefer_local = os.environ.get("SPLICR_LAKE_REMOTE") != "1"

    local = LOCAL_LAKE / name
    if prefer_local and local.exists() and any(local.rglob("*.parquet")):
        return f"{local}/**/*.parquet"

    bucket = os.environ.get("R2_BUCKET", "splicr")
    return f"s3://{bucket}/{LAKE_PREFIX}/{name}/**/*.parquet"


def query(sql: str, params: Iterable[Any] | None = None):
    """Run a query against the lake. `{guides}` and friends expand to sources."""
    expanded = sql.format(**{name: f"read_parquet('{source(name)}')" for name in DATASETS})
    conn = connect()
    return conn.execute(expanded, list(params or []))


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------

def write_dataset(name: str, rows: Any, *, local_only: bool = True) -> Path:
    """
    Write a dataset to the local lake as partitioned, sorted Parquet.

    `rows` is anything DuckDB can read: an Arrow table, a pandas frame, or a
    SQL string selecting from something already registered.

    ZSTD rather than the snappy default: these are cold reference files read
    over the network, so the extra compression is repaid on every read, and
    DuckDB decompresses it about as fast either way.
    """
    dataset = DATASETS[name]
    out = LOCAL_LAKE / name
    out.parent.mkdir(parents=True, exist_ok=True)

    conn = connect()
    conn.register("_incoming", rows) if not isinstance(rows, str) else None
    relation = rows if isinstance(rows, str) else "select * from _incoming"

    order = ", ".join(dataset.sort_by) if dataset.sort_by else None
    select = f"{relation}" + (f" order by {order}" if order else "")

    partition = (
        f", partition_by ({', '.join(dataset.partition_by)}), overwrite_or_ignore true"
        if dataset.partition_by
        else ""
    )
    conn.execute(
        f"copy ({select}) to '{out}' "
        f"(format parquet, compression zstd, row_group_size 100000{partition})"
    )
    if not isinstance(rows, str):
        conn.unregister("_incoming")
    return out


def upload_dataset(name: str) -> int:
    """Push a locally written dataset to R2. Returns the number of files sent."""
    from .r2 import R2Config, client, upload

    dataset = DATASETS[name]
    local = LOCAL_LAKE / name
    files = sorted(local.rglob("*.parquet"))
    if not files:
        raise FileNotFoundError(f"nothing written at {local}; run write_dataset first")

    cfg = R2Config.from_env()
    s3 = client(cfg)
    sent = 0
    for path in files:
        key = f"{dataset.key}/{path.relative_to(local).as_posix()}"
        did, _ = upload(s3, cfg.bucket, path, key, "application/vnd.apache.parquet")
        sent += 1 if did else 0
    return sent


def describe() -> list[dict]:
    """What is in the lake, locally and remotely. Used by `splicr doctor`."""
    out = []
    for name, dataset in DATASETS.items():
        local = LOCAL_LAKE / name
        files = sorted(local.rglob("*.parquet")) if local.exists() else []
        out.append({
            "dataset": name,
            "description": dataset.description,
            "local_files": len(files),
            "local_bytes": sum(f.stat().st_size for f in files),
            "partition_by": list(dataset.partition_by),
        })
    return out
