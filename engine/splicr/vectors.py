"""
Similarity search over perturbation embeddings: "which knockouts look like this one".

Three gene-level modalities, each a vector per harmonized gene:

    perturbseq_k562   Replogle 2022 pseudobulk expression signature (8,248 readout genes)
    jump_crispr       JUMP Cell Painting consensus morphology, CRISPR knockout
    jump_orf          JUMP Cell Painting consensus morphology, ORF overexpression
    depmap_effect     DepMap 26Q1 Chronos effect across 1,208 lines (co-essentiality)

Exact cosine search in DuckDB. At tens of thousands of vectors a brute-force
scan is a few milliseconds and has no recall loss, so an approximate index
(Milvus, pgvector HNSW) buys nothing yet; `export_vectors` writes the same
vectors for loading into one when the corpus outgrows a scan.

`evaluate_modalities` is the check that a modality carries biology rather than
noise: for each, how well does cosine similarity separate STRING
high-confidence pairs from random gene pairs (AUROC)?
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from . import lake

DEPMAP_RELEASE = "26Q1"


def _path(name: str) -> str:
    return str(lake.LOCAL_LAKE / name / "data_0.parquet")


def load(modality: str) -> tuple[list[str], np.ndarray]:
    """(gene symbols, L2-normalized float32 matrix), one row per gene."""
    import duckdb

    con = duckdb.connect()
    con.execute("set enable_progress_bar = false")
    if modality == "perturbseq_k562":
        # Several guides/transcripts can target one gene: average their signatures.
        rows = con.execute(f"""
            select gene_symbol, signature from read_parquet('{_path("perturbseq_k562_signatures")}')
            where gene_symbol is not null""").fetchall()
    elif modality in ("jump_crispr", "jump_orf"):
        sub = modality.split("_")[1]
        rows = con.execute(f"""
            select gene_symbol, embedding from read_parquet('{_path(f"jump_{sub}_gene_morphology")}')
            where gene_symbol is not null""").fetchall()
    elif modality == "depmap_effect":
        import pandas as pd
        eff = lake.LOCAL_LAKE / "depmap_matrix" / f"release={DEPMAP_RELEASE}" / "measure=gene_effect" / "data_0.parquet"
        df = con.execute(f"select gene_symbol, model_id, value from read_parquet('{eff}')").df()
        wide = df.pivot_table(index="gene_symbol", columns="model_id", values="value")
        wide = wide.loc[wide.notna().mean(axis=1) > 0.9]
        wide = wide.sub(wide.mean(axis=1), axis=0).fillna(0.0)   # co-essentiality, not overall essentiality
        m = wide.to_numpy(np.float32)
        return list(wide.index), m / np.maximum(np.linalg.norm(m, axis=1, keepdims=True), 1e-9)
    else:
        raise KeyError(modality)

    by_gene: dict[str, list] = {}
    for sym, vec in rows:
        by_gene.setdefault(sym, []).append(np.asarray(vec, dtype=np.float32))
    genes = sorted(by_gene)
    m = np.stack([np.mean(by_gene[g], axis=0) for g in genes])
    # A readout gene with zero variance in control cells z-scores to +/-inf in
    # the authors' normalization (~0.006% of cells). It carries no information.
    m[~np.isfinite(m)] = 0.0
    m = m - m.mean(axis=0)
    return genes, m / np.maximum(np.linalg.norm(m, axis=1, keepdims=True), 1e-9)


_cache: dict[str, tuple[list[str], np.ndarray]] = {}


def similar(gene: str, modality: str, k: int = 10) -> list[tuple[str, float]]:
    if modality not in _cache:
        _cache[modality] = load(modality)
    genes, m = _cache[modality]
    try:
        i = genes.index(gene)
    except ValueError:
        return []
    sims = m @ m[i]
    order = np.argsort(-sims)
    return [(genes[j], float(sims[j])) for j in order[: k + 1] if j != i][:k]


def evaluate_modalities(modalities=("perturbseq_k562", "jump_crispr", "jump_orf", "depmap_effect"),
                        n_random: int = 200_000, seed: int = 0) -> dict[str, dict]:
    """AUROC of cosine similarity for STRING >= 0.7 gene pairs vs random pairs."""
    import duckdb
    from sklearn.metrics import roc_auc_score

    con = duckdb.connect()
    con.execute("set enable_progress_bar = false")
    pos = con.execute(f"""
        select a.name, b.name from read_parquet('{_path("kg_edges")}') e
        join read_parquet('{_path("kg_nodes")}') a on a.id = e.src
        join read_parquet('{_path("kg_nodes")}') b on b.id = e.dst
        where e.type = 'INTERACTS_WITH'""").fetchall()
    rng = np.random.default_rng(seed)
    out = {}
    for mod in modalities:
        genes, m = load(mod)
        idx = {g: i for i, g in enumerate(genes)}
        p = [(idx[a], idx[b]) for a, b in pos if a in idx and b in idx]
        if len(p) < 100:
            continue
        p = np.array(p)
        r = rng.integers(0, len(genes), size=(n_random, 2))
        r = r[r[:, 0] != r[:, 1]]
        s_pos = np.einsum("ij,ij->i", m[p[:, 0]], m[p[:, 1]])
        s_neg = np.einsum("ij,ij->i", m[r[:, 0]], m[r[:, 1]])
        y = np.r_[np.ones(len(s_pos)), np.zeros(len(s_neg))]
        out[mod] = {"genes": len(genes), "dims": int(m.shape[1]), "string_pairs": int(len(p)),
                    "auroc": round(float(roc_auc_score(y, np.r_[s_pos, s_neg])), 4)}
    return out


def export_vectors(out_dir: Path) -> list[Path]:
    """Parquet (gene, vector) per modality, for loading into a vector database."""
    import pyarrow as pa
    import pyarrow.parquet as pq

    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for mod in ("perturbseq_k562", "jump_crispr", "jump_orf", "depmap_effect"):
        genes, m = load(mod)
        path = out_dir / f"{mod}.parquet"
        pq.write_table(pa.table({"gene_symbol": genes, "vector": pa.FixedSizeListArray.from_arrays(
            pa.array(m.ravel()), m.shape[1])}), path, compression="zstd")
        written.append(path)
    return written
