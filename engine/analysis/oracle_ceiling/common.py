"""Shared loading + fast AnDCG@100 transfer-matrix machinery. Label-free unless stated."""
import os, sys, pickle, numpy as np
sys.path.insert(0, "/Users/sahaj/Documents/Projects/SplicR/engine")
from splicr.assaybench_io import load_split
from splicr import benchmark as bm

SCRATCH = os.path.dirname(os.path.abspath(__file__))
K = 100


def cache(name, build):
    p = os.path.join(SCRATCH, name)
    if os.path.exists(p):
        with open(p, "rb") as fh:
            return pickle.load(fh)
    obj = build()
    with open(p, "wb") as fh:
        pickle.dump(obj, fh, protocol=4)
    return obj


def splits():
    return load_split("train"), load_split("validation")


def make_andcg():
    return bm.AnDCG(k=K)


def donor_topk(screens, andcg, k=K):
    """Each screen's own top-k genes by relevance, as NORMALISED deduped symbols."""
    out = []
    for s in screens:
        pairs = sorted(zip(s["relevance_genes"], s["relevance_scores"]),
                       key=lambda gs: gs[1], reverse=True)[:k]
        seen, norm = set(), []
        for g, _ in pairs:
            n = andcg.normalize(g)
            if n in seen:
                continue
            seen.add(n)
            norm.append(n)
        out.append(norm)
    return out


def transfer_matrix(query_screens, donor_norm_top, andcg, verbose=True):
    """T[i, j] = AnDCG@100 of donor j's own top-100 against query i's labels."""
    hgnc = andcg.hgnc_symbols
    pen = andcg.no_hgnc_penalty
    disc = 1.0 / np.log2(np.arange(2, K + 2))
    T = np.zeros((len(query_screens), len(donor_norm_top)), dtype=np.float32)
    for i, s in enumerate(query_screens):
        tgt = andcg.target(s)
        rel = tgt.relevance
        if tgt.idcg == 0:
            continue
        inv_idcg, rnd, den = 1.0 / tgt.idcg, tgt.rand_ndcg, tgt.denom
        for j, genes in enumerate(donor_norm_top):
            g = 0.0
            pos = 0
            for nm in genes:
                v = rel.get(nm)
                if v is None:
                    if nm in hgnc:
                        continue          # measured-elsewhere -> condensed away
                    if pen is None:
                        continue
                    v = pen
                g += v * disc[pos]
                pos += 1
            T[i, j] = max((g * inv_idcg - rnd) / den, 0.0)
        if verbose and (i + 1) % 25 == 0:
            print(f"  transfer row {i+1}/{len(query_screens)}", flush=True)
    return T
