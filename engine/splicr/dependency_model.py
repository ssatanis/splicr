"""
Predict a cell line's gene dependencies (DepMap Chronos effect) from its baseline
state: expression, copy number and hotspot mutations. The first, CPU-trainable
stage of the perturbation model; see research/17_DEPENDENCY_MODEL.md.

The question it answers is the one a new cell line poses: "which genes will this
line depend on, before anyone screens it?". So evaluation holds out whole cell
lines, and a second split holds out whole lineages, which is harder and closer
to a genuinely new cell type.

Everything fitted (feature scaling, PCA, the regression) is fitted on training
lines only, inside each fold. The target gene set used for scoring ("selective"
genes) is chosen by variance of the target over all lines; that choice uses no
features and no held-out prediction, so it cannot leak signal into the model.

Models compared, all on the same folds:

    mean       per-gene mean effect over training lines (common essentiality only)
    knn        mean of the 10 training lines nearest in expression PCA space
    ridge      multi-output ridge from [expression PCs, CN PCs, hotspot calls]
    ridge_full linear kernel ridge on every standardized feature (5k expression,
               5k CN, hotspot calls), solved in the dual; the default model.
               alpha_full = 30,000 was chosen on the random split only
               (research/artifacts/dependency_model/alpha_sweep_random_split.json);
               the lineage split was not used to choose anything.

Metric: for each selective gene, Pearson r between predicted and observed effect
across held-out lines. `mean` predicts a constant per gene, so its r is 0 by
construction; it is still reported with global r and MAE, where it is strong.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass

import numpy as np

from . import lake

RELEASE = "26Q1"


def _matrix(measure: str):
    import duckdb
    import pandas as pd

    path = lake.LOCAL_LAKE / "depmap_matrix" / f"release={RELEASE}" / f"measure={measure}" / "data_0.parquet"
    con = duckdb.connect()
    con.execute("set enable_progress_bar = false")
    df = con.execute(f"select model_id, gene_symbol || ' (' || coalesce(entrez_id::varchar, '') || ')' as g, "
                     f"value from read_parquet('{path}') where model_id is not null").df()
    return df.pivot_table(index="model_id", columns="g", values="value", aggfunc="mean").astype(np.float32) \
        if len(df) else pd.DataFrame()


@dataclass
class Data:
    lines: np.ndarray
    lineage: np.ndarray
    genes: np.ndarray
    y: np.ndarray            # lines x genes effect (NaN where unmeasured)
    expr: np.ndarray
    cn: np.ndarray
    mut: np.ndarray


def load() -> Data:
    import duckdb

    y = _matrix("gene_effect")
    expr = _matrix("expression_tpm_log1p")
    cn = _matrix("copy_number_wgs")
    mut = _matrix("mutation_hotspot")
    lines = sorted(set(y.index) & set(expr.index))
    models = duckdb.sql(
        f"select model_id, lineage from read_parquet('{lake.LOCAL_LAKE}/depmap_models/release={RELEASE}/data_0.parquet')"
    ).df().set_index("model_id")["lineage"]

    def align(m, fill):
        if m.empty:
            return np.zeros((len(lines), 0), np.float32)
        return m.reindex(lines).fillna(fill).to_numpy(np.float32)

    # Features that vary: top 5,000 expression genes; CN in log2 so a deletion
    # and an amplification are symmetric; hotspot calls present in >= 5 lines.
    e = expr.reindex(lines)
    e = e[e.var().sort_values(ascending=False).index[:5000]]
    c = np.log2(cn.reindex(lines).clip(lower=0.05)) if not cn.empty else cn
    c = c[c.var().sort_values(ascending=False).index[:5000]] if not cn.empty else c
    m = (mut.reindex(lines).fillna(0) > 0).astype(np.float32)
    m = m.loc[:, m.sum() >= 5]
    return Data(np.array(lines), models.reindex(lines).fillna("Unknown").to_numpy(), y.columns.to_numpy(),
                y.reindex(lines).to_numpy(np.float32), align(e, 0.0), align(c, 0.0), m.to_numpy(np.float32))


def _features(d: Data, tr, te, n_expr=150, n_cn=50, full: bool = False):
    """PCs of expression and CN plus hotspot calls; `full` uses the standardized blocks themselves."""
    if full:
        from sklearn.preprocessing import StandardScaler
        tr_b, te_b = [], []
        for x in (d.expr, d.cn):
            if x.shape[1]:
                s = StandardScaler().fit(x[tr])
                tr_b.append(s.transform(x[tr]))
                te_b.append(s.transform(x[te]))
        if d.mut.shape[1]:
            tr_b.append(d.mut[tr])
            te_b.append(d.mut[te])
        pca_tr, pca_te = _features(d, tr, te, n_expr, n_cn)[2:]
        return np.hstack(tr_b), np.hstack(te_b), pca_tr, pca_te
    return _features_pca(d, tr, te, n_expr, n_cn)


def _features_pca(d: Data, tr, te, n_expr=150, n_cn=50):
    from sklearn.decomposition import PCA
    from sklearn.preprocessing import StandardScaler

    blocks_tr, blocks_te = [], []
    for x, k in ((d.expr, n_expr), (d.cn, n_cn)):
        if x.shape[1] == 0:
            continue
        s = StandardScaler().fit(x[tr])
        p = PCA(n_components=min(k, len(tr) - 1), random_state=0).fit(s.transform(x[tr]))
        blocks_tr.append(p.transform(s.transform(x[tr])))
        blocks_te.append(p.transform(s.transform(x[te])))
    if d.mut.shape[1]:
        blocks_tr.append(d.mut[tr])
        blocks_te.append(d.mut[te])
    return np.hstack(blocks_tr), np.hstack(blocks_te), blocks_tr[0], blocks_te[0]


def _predict(d: Data, tr, te, alpha: float, full: bool = False, alpha_full: float = 30000.0):
    from sklearn.linear_model import Ridge
    from sklearn.preprocessing import StandardScaler

    ytr = d.y[tr]
    with np.errstate(all="ignore"):
        mu = np.nan_to_num(np.nanmean(ytr, axis=0))   # a gene unmeasured in every training line -> 0
    ytr = np.where(np.isnan(ytr), mu, ytr)
    xtr, xte, etr, ete = _features(d, tr, te)

    preds = {"mean": np.tile(mu, (len(te), 1))}

    # kNN in expression PCA space.
    dist = ((ete[:, None, :] - etr[None, :, :]) ** 2).sum(-1)
    nn = np.argsort(dist, axis=1)[:, :10]
    preds["knn"] = ytr[nn].mean(axis=1)

    s = StandardScaler().fit(xtr)
    model = Ridge(alpha=alpha).fit(s.transform(xtr), ytr - mu)
    preds["ridge"] = model.predict(s.transform(xte)).astype(np.float32) + mu

    if full:
        # Linear kernel ridge on every standardized feature (10k+): solved in the
        # n_train x n_train dual, so the width costs nothing extra.
        ftr, fte, _, _ = _features(d, tr, te, full=True)
        k_tr = ftr @ ftr.T
        k_te = fte @ ftr.T
        coef = np.linalg.solve(k_tr + alpha_full * np.eye(len(tr), dtype=k_tr.dtype), (ytr - mu))
        preds["ridge_full"] = (k_te @ coef).astype(np.float32) + mu
    return preds


def _score(y_true, y_pred, selective):
    ok = ~np.isnan(y_true)
    glob_r = float(np.corrcoef(y_true[ok], y_pred[ok])[0, 1])
    mae = float(np.abs(y_true[ok] - y_pred[ok]).mean())
    rs = []
    for j in selective:
        m = ok[:, j]
        a, b = y_true[m, j], y_pred[m, j]
        rs.append(0.0 if b.std() < 1e-9 or a.std() < 1e-9 else float(np.corrcoef(a, b)[0, 1]))
    rs = np.array(rs)
    return {"global_r": round(glob_r, 4), "mae": round(mae, 4),
            "selective_median_r": round(float(np.median(rs)), 4),
            "selective_frac_r_gt_0.3": round(float((rs > 0.3).mean()), 4),
            "selective_frac_r_gt_0.5": round(float((rs > 0.5).mean()), 4)}, rs


def evaluate(n_selective: int = 2000, alpha: float = 3000.0, seed: int = 0,
             full: bool = True, alpha_full: float = 30000.0, splits: tuple = ("random_5fold_by_line", "lineage_heldout_5fold"),
             data: "Data | None" = None) -> dict:
    from sklearn.model_selection import GroupKFold, KFold

    t0 = time.time()
    d = data or load()
    var = np.nanvar(d.y, axis=0)
    selective = np.argsort(-np.nan_to_num(var))[:n_selective]
    out = {"release": RELEASE, "n_lines": int(len(d.lines)), "n_genes": int(len(d.genes)),
           "n_selective_genes_scored": n_selective, "features": {
               "expression_pcs_from_top_var_genes": 150, "cn_pcs": 50, "hotspot_mutations": int(d.mut.shape[1])},
           "ridge_alpha": alpha, "splits": {}}
    folds = {
        "random_5fold_by_line": list(KFold(5, shuffle=True, random_state=seed).split(d.lines)),
        "lineage_heldout_5fold": list(GroupKFold(5).split(d.lines, groups=d.lineage)),
    }
    per_gene = {}
    kinds = ("mean", "knn", "ridge") + (("ridge_full",) if full else ())
    out["ridge_full_alpha"] = alpha_full if full else None
    for split, idx in folds.items():
        if split not in splits:
            continue
        pred = {k: np.full_like(d.y, np.nan) for k in kinds}
        for tr, te in idx:
            p = _predict(d, tr, te, alpha, full, alpha_full)
            for k in pred:
                pred[k][te] = p[k]
        out["splits"][split] = {}
        for k in pred:
            summary, rs = _score(d.y, pred[k], selective)
            out["splits"][split][k] = summary
            if split == "random_5fold_by_line" and k == ("ridge_full" if full else "ridge"):
                per_gene = dict(zip(d.genes[selective], rs))
    top = sorted(per_gene.items(), key=lambda kv: -kv[1])[:25]
    out["best_predicted_selective_genes_random_split"] = [(g, round(r, 3)) for g, r in top]
    out["runtime_s"] = round(time.time() - t0, 1)
    return out


if __name__ == "__main__":
    print(json.dumps(evaluate(), indent=2))
