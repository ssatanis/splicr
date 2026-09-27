"""Knowledge channels: pharmacology, pathway neighbourhoods, named reporters.

All three are *dated* sources in the sense that matters here.  Which protein a
small molecule binds, which proteins sit in a complex and which genes belong to
a Reactome pathway are facts established when the molecule or the complex was
characterised -- they are not derived from the screens being predicted.  The
channels that *are* derived from screen data (the conditional counters) live in
``channels.py`` and are restricted to pre-2022 donors there.
"""
import os, re, sys, json, functools
import numpy as np
from scipy import sparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import uni, condition_text, entity_keys
import pharm

REF = "/Users/sahaj/Documents/Projects/SplicR/data/references"


@functools.lru_cache(maxsize=1)
def string_net(kind="phys", min_score=400):
    idx = json.load(open(os.path.join(REF, "derived", f"string_{kind}_index.json")))
    z = np.load(os.path.join(REF, "derived", f"string_{kind}.npz"))
    A = sparse.csr_matrix((z["data"], z["indices"], z["indptr"]), shape=tuple(z["shape"]))
    A.data = np.where(A.data >= min_score, A.data, 0).astype(np.float32)
    A.eliminate_zeros()
    syms = idx["symbols"] if isinstance(idx, dict) and "symbols" in idx else idx
    return syms, A


@functools.lru_cache(maxsize=1)
def reactome():
    gene2sets, set2genes = {}, {}
    with open(os.path.join(REF, "reactome", "ReactomePathways.gmt")) as fh:
        for line in fh:
            p = line.rstrip("\n").split("\t")
            if len(p) < 3:
                continue
            name, genes = p[0], [g for g in p[2:] if g]
            if not (3 <= len(genes) <= 300):
                continue
            set2genes[name] = genes
            for g in genes:
                gene2sets.setdefault(g, set()).add(name)
    return gene2sets, set2genes


@functools.lru_cache(maxsize=1)
def _string_u():
    """STRING physical network projected onto the AssayBench gene universe."""
    u = uni()
    syms, A = string_net()
    pos = np.array([u.sym2u.get(s, -1) for s in syms])
    keep = pos >= 0
    B = A[keep][:, keep].tocsr()
    return pos[keep], B


def _hgnc_like(text):
    """Gene symbols named in free text, restricted to symbols the universe knows."""
    u = uni()
    out = []
    for tok in re.findall(r"[A-Za-z][A-Za-z0-9\-]{1,12}", text or ""):
        t = tok.upper().replace("-", "")
        if t in u.sym2u and (any(c.isdigit() for c in t) or len(t) >= 4) and t not in _COMMON:
            out.append(t)
    return list(dict.fromkeys(out))


_COMMON = {"CELL", "CELLS", "GENE", "GENES", "TYPE", "HIGH", "LOW", "DAYS", "DAY",
           "RNA", "DNA", "CRISPR", "CAS9", "SGRNA", "KNOCKOUT", "SCREEN", "HITS",
           "MEDIUM", "ASSAY", "TEST", "LINE", "HUMAN", "MOUSE", "PROTEIN", "VIRUS",
           "INFECTION", "CD4", "CD8", "MOI", "FDR", "WT", "KO", "GFP", "MICE",
           "PBMC", "TNF", "SET", "REST", "MAX", "MIN", "IMPACT", "AGO", "AFTER"}

_REPORTER_ALIAS = {
    "pd-l1": ["CD274"], "pdl1": ["CD274"], "rela": ["RELA"], "nf-kb": ["RELA", "NFKB1"],
    "fetal hemoglobin": ["HBG1", "HBG2", "BCL11A"], "hbf": ["HBG1", "HBG2"],
    "il-2": ["IL2"], "il2": ["IL2"], "ifn-gamma": ["IFNG"], "interferon gamma": ["IFNG"],
    "tnf-alpha": ["TNF"], "egr1": ["EGR1"], "ace2": ["ACE2"],
    "mhc class i": ["B2M", "HLA-A", "HLA-B", "HLA-C", "TAP1", "TAP2"],
    "mhc class ii": ["CD74", "CIITA", "HLA-DRA", "HLA-DRB1"],
}


def named_genes(meta):
    txt = " ".join(str(meta.get(f) or "") for f in ("phenotype", "screen_rationale", "notes"))
    low = txt.lower()
    out = []
    for k, v in _REPORTER_ALIAS.items():
        if k in low:
            out += v
    out += _hgnc_like(txt)
    u = uni()
    return [g for g in dict.fromkeys(out) if g in u.sym2u]


class Knowledge:
    """Gene-level knowledge vectors for one screen, over the universe."""

    def __init__(self):
        self.u = uni()
        self.pos, self.B = _string_u()
        self.g2s, self.s2g = reactome()
        rows, cols = [], []
        names = sorted(self.s2g)
        self.setnames = names
        for si, nm in enumerate(names):
            for g in self.s2g[nm]:
                j = self.u.sym2u.get(g)
                if j is not None:
                    rows.append(si); cols.append(j)
        self.P = sparse.csr_matrix((np.ones(len(rows), np.float32), (rows, cols)),
                                   shape=(len(names), self.u.U))
        sz = np.asarray(self.P.sum(1)).ravel()
        self.Pn = sparse.diags(1.0 / np.maximum(sz, 1)) @ self.P

    def seed_vec(self, syms):
        v = np.zeros(self.u.U, np.float32)
        for s in syms:
            j = self.u.sym2u.get(s)
            if j is not None:
                v[j] = 1.0
        return v

    def expand_string(self, seed, decay=0.35):
        """One step of physical-network diffusion from a seed set."""
        out = np.zeros(self.u.U, np.float32)
        idx = np.where(seed > 0)[0]
        if not len(idx):
            return out
        sub = np.isin(self.pos, idx)
        rows = np.where(sub)[0]
        if not len(rows):
            return out
        agg = np.asarray(self.B[rows].sum(0)).ravel()
        if agg.max() > 0:
            agg = agg / agg.max()
        out[self.pos] = decay * agg
        out = np.maximum(out, seed)
        return out

    def expand_pathway(self, seed):
        """Genes sharing a Reactome pathway with the seed, weighted by set specificity."""
        s = seed / max(seed.sum(), 1.0)
        w = self.Pn @ s                      # pathway relevance
        if w.max() <= 0:
            return np.zeros(self.u.U, np.float32)
        v = np.asarray(self.Pn.T @ w).ravel().astype(np.float32)
        return v / max(v.max(), 1e-9)


_K = None
def know():
    global _K
    if _K is None:
        _K = Knowledge()
    return _K


def drug_vectors(meta):
    """(direct-target vector, complex/pathway-expanded vector, moa class tokens)."""
    k = know()
    r = pharm.resolve(str(meta.get("condition_name") or ""))
    if not r:
        return None
    _, targets, moas = r
    if not targets:
        return None
    seed = k.seed_vec(targets)
    net = np.maximum(k.expand_string(seed), 0.6 * k.expand_pathway(seed))
    return seed, net.astype(np.float32), pharm.class_tokens(moas)


def reporter_vectors(meta):
    k = know()
    g = named_genes(meta)
    if not g:
        return None
    seed = k.seed_vec(g[:12])
    net = np.maximum(k.expand_string(seed), 0.6 * k.expand_pathway(seed))
    return seed, net.astype(np.float32)


if __name__ == "__main__":
    u = uni()
    k = know()
    print("reactome sets", len(k.setnames), "string nodes", len(k.pos))
    n_drug = n_rep = 0
    for i in range(u.n):
        if u.split[i] != "test":
            continue
        if drug_vectors(u.meta[i]):
            n_drug += 1
        if reporter_vectors(u.meta[i]):
            n_rep += 1
    print("test screens with drug vectors:", n_drug, " with reporter vectors:", n_rep)
    for i in range(u.n):
        if u.split[i] == "test" and u.meta[i]["cleaned_phenotype"].startswith("Molecular"):
            print("  ", u.meta[i]["phenotype"][:60], "->", named_genes(u.meta[i])[:6])
