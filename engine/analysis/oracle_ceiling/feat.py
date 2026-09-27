"""Label-free pair features between a query screen and a donor (train) screen.

Query side uses ONLY metadata + the measured-gene list (the library), never the
query's relevance/hit values.  Donor side may use donor labels: donors are always
train screens, whose labels are in-split.
"""
import os, re, csv, sys, pickle, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import SCRATCH, K, donor_topk

REF = "/Users/sahaj/Documents/Projects/SplicR/data/references"
_nz = lambda s: re.sub(r"[^A-Z0-9]", "", (s or "").upper())
_lc = lambda s: (s or "").strip().lower()


def _year(a):
    m = re.search(r"\((\d{4})\)", a or "")
    return int(m.group(1)) if m else 0


def _days(dur):
    s = _lc(dur)
    m = re.search(r"([\d.]+)", s)
    if not m:
        return 0.0
    v = float(m.group(1))
    if "week" in s: v *= 7
    elif "month" in s: v *= 30
    elif "hour" in s or "hr" in s: v /= 24
    return v


def depmap():
    """(alias->ModelID, ModelID->lineage, models, genes, gene-effect A, model corr C)."""
    p = os.path.join(SCRATCH, "depmap.pkl")
    if os.path.exists(p):
        with open(p, "rb") as fh:
            return pickle.load(fh)
    import pandas as pd
    alias, lineage = {}, {}
    with open(f"{REF}/depmap/Model.csv", newline="") as fh:
        for r in csv.DictReader(fh):
            lineage[r["ModelID"]] = r["OncotreeLineage"]
            for key in (r["StrippedCellLineName"], r["CellLineName"]):
                if _nz(key):
                    alias.setdefault(_nz(key), r["ModelID"])
    cur = {}
    with open(f"{REF}/cells/cellosaurus.txt", errors="ignore") as fh:
        for line in fh:
            tag, _, val = line.partition("   ")
            tag, val = tag.strip(), val.strip()
            if tag == "ID":
                cur = {"names": [val]}
            elif tag == "SY":
                cur.setdefault("names", []).extend(x.strip() for x in val.split(";"))
            elif tag == "//":
                ns = [_nz(x) for x in cur.get("names", []) if _nz(x)]
                tgt = next((alias[n] for n in ns if n in alias), None)
                if tgt:
                    for n in ns:
                        alias.setdefault(n, tgt)
                cur = {}
    ge = pd.read_csv(f"{REF}/depmap/CRISPRGeneEffect.csv", index_col=0)
    ge.columns = [c.split(" (")[0] for c in ge.columns]
    A = ge.to_numpy(dtype=np.float32)
    A = np.where(np.isnan(A), np.nanmean(A, axis=0, keepdims=True), A)
    Az = (A - A.mean(1, keepdims=True)) / (A.std(1, keepdims=True) + 1e-9)
    C = ((Az @ Az.T) / A.shape[1]).astype(np.float32)
    out = (alias, lineage, list(ge.index), list(ge.columns), A, C)
    with open(p, "wb") as fh:
        pickle.dump(out, fh, protocol=4)
    return out


def essentials():
    s = set()
    with open(f"{REF}/depmap/CRISPRInferredCommonEssentials.csv") as fh:
        next(fh)
        for line in fh:
            s.add(line.strip().split(" (")[0].strip('"'))
    return s


CATS = ["cell_line", "cell_type", "screen_type", "library_type", "library_methodology",
        "screen_category", "cleaned_phenotype", "experimental_setup", "author",
        "condition_name", "significance_criteria", "source"]
TXT = ["phenotype", "screen_rationale", "condition_clause", "notes", "ranking_rationale",
       "experimental_setup", "condition_name"]

FEATURES = (
    [f"cat_{c}" for c in CATS]
    + ["lineage_match", "year_diff", "days_logratio"]
    + [f"txt_{t}" for t in TXT]
    + ["corpus_cosine",
       "lib_jaccard", "lib_overlap", "q_libsize_log", "d_libsize_log", "libsize_logratio",
       "coverage_top100", "coverage_top20",
       "d_nhit_log", "d_hitfrac", "d_negfrac", "d_absrel", "d_ess_frac", "d_quality",
       "depmap_cell_corr", "ge_of_donortop_in_querycell", "ge_of_donortop20_in_querycell",
       "ge_donorcell_minus_querycell", "both_cells_mapped",
       "q_negsel", "d_negsel", "negsel_x_dess", "negsel_x_ge"]
)
NF = len(FEATURES)
I_GE = FEATURES.index("ge_of_donortop_in_querycell")


class Side:
    def __init__(self, screens, andcg, dm, ess, universe=None):
        alias, lineage, models, genes, A, C = dm
        mpos = {m: i for i, m in enumerate(models)}
        gpos = {g: i for i, g in enumerate(genes)}
        self.n = len(screens)
        self.cat = {c: np.array([(_lc(s.get(c)) if c == "condition_name" else _nz(s.get(c)))
                                 for s in screens], dtype=object) for c in CATS}
        self.year = np.array([_year(s.get("author")) for s in screens], float)
        self.days = np.array([_days(s.get("duration")) for s in screens], float)
        self.lib = [frozenset(andcg.normalize(g) for g in s["relevance_genes"]) for s in screens]
        self.libsz = np.array([len(x) for x in self.lib], float)
        self.top = donor_topk(screens, andcg, K)
        self.mrow = np.array([mpos.get(alias.get(_nz(s.get("cell_line")), ""), -1) for s in screens])
        self.lineage = np.array([lineage.get(alias.get(_nz(s.get("cell_line")), ""), "")
                                 for s in screens], dtype=object)
        self.nhit = np.array([sum(1 for h in s["hit"] if h) for s in screens], float)
        self.hitfrac = self.nhit / np.maximum(self.libsz, 1)
        self.negfrac = np.array([float(np.mean(np.asarray(s["relevance_scores"]) < 0))
                                 for s in screens])
        self.absrel = np.array([float(np.mean(np.abs(s["relevance_scores"]))) for s in screens])
        self.ess_frac = np.array([float(np.mean([g in ess for g in t])) if t else 0.0
                                  for t in self.top])
        self.negsel = (self.cat["screen_type"] == _nz("Negative Selection")).astype(np.float32)
        # integer-indexed libraries over a shared gene universe: fast set ops
        self.universe = universe if universe is not None else {}
        if universe is None:
            for L in self.lib:
                for g in L:
                    self.universe.setdefault(g, len(self.universe))
        U = self.universe
        self.libi = [np.fromiter((U[g] for g in L if g in U), int) for L in self.lib]
        self.topu = [np.fromiter((U.get(g, -1) for g in t), int) for t in self.top]
        gi = [np.array([gpos.get(g, -1) for g in t], int) for t in self.top]
        self.gi100 = [g[g >= 0] for g in gi]
        self.gi20 = [g[:20][g[:20] >= 0] for g in gi]
        # donor-cell-line mean effect of its own top-100 (constant per donor)
        self.self_ge = np.array([float(A[self.mrow[j]][self.gi100[j]].mean())
                                 if self.mrow[j] >= 0 and self.gi100[j].size else 0.0
                                 for j in range(self.n)])


def row_features(qi, q: Side, d: Side, didx, txt_cos, corpus_cos, donor_quality, A, C):
    """(len(didx), NF) features for query qi against donors didx."""
    didx = np.asarray(didx)
    X = np.zeros((didx.size, NF), np.float32)
    c = 0
    for cn in CATS:
        X[:, c] = (q.cat[cn][qi] == d.cat[cn][didx]) & (q.cat[cn][qi] != ""); c += 1
    X[:, c] = (q.lineage[qi] == d.lineage[didx]) & (q.lineage[qi] != ""); c += 1
    X[:, c] = np.abs(q.year[qi] - d.year[didx]); c += 1
    X[:, c] = np.log1p(q.days[qi]) - np.log1p(d.days[didx]); c += 1
    for f in TXT:
        X[:, c] = txt_cos[f][qi][didx]; c += 1
    X[:, c] = corpus_cos[qi][didx]; c += 1
    qn = q.libsz[qi]
    mask = np.zeros(max(len(q.universe), len(d.universe)) + 1, bool)
    mask[q.libi[qi]] = True
    inter = np.array([mask[d.libi[j]].sum() if d.libi[j].size else 0 for j in didx], float)
    dsz = d.libsz[didx]
    X[:, c] = inter / np.maximum(qn + dsz - inter, 1); c += 1
    X[:, c] = inter / np.maximum(np.minimum(qn, dsz), 1); c += 1
    X[:, c] = np.log10(max(qn, 1)); c += 1
    X[:, c] = np.log10(np.maximum(dsz, 1)); c += 1
    X[:, c] = np.log10(max(qn, 1)) - np.log10(np.maximum(dsz, 1)); c += 1
    X[:, c] = [float(mask[np.maximum(d.topu[j], 0)][d.topu[j] >= 0].sum()) / max(d.topu[j].size, 1)
               if d.topu[j].size else 0.0 for j in didx]; c += 1
    X[:, c] = [float(mask[np.maximum(d.topu[j][:20], 0)][d.topu[j][:20] >= 0].sum())
               / max(min(d.topu[j].size, 20), 1) if d.topu[j].size else 0.0 for j in didx]; c += 1
    X[:, c] = np.log1p(d.nhit[didx]); c += 1
    X[:, c] = d.hitfrac[didx]; c += 1
    X[:, c] = d.negfrac[didx]; c += 1
    X[:, c] = d.absrel[didx]; c += 1
    X[:, c] = d.ess_frac[didx]; c += 1
    X[:, c] = donor_quality[didx]; c += 1
    qm = q.mrow[qi]
    dm_ = d.mrow[didx]
    if qm >= 0:
        X[:, c] = np.where(dm_ >= 0, C[qm][np.maximum(dm_, 0)], 0.0); c += 1
        qv = A[qm]
        X[:, c] = [qv[d.gi100[j]].mean() if d.gi100[j].size else 0.0 for j in didx]; c += 1
        X[:, c] = [qv[d.gi20[j]].mean() if d.gi20[j].size else 0.0 for j in didx]; c += 1
        X[:, c] = np.where(dm_ >= 0, d.self_ge[didx] - X[:, c - 2], 0.0); c += 1
    else:
        c += 4
    X[:, c] = (qm >= 0) & (dm_ >= 0); c += 1
    X[:, c] = q.negsel[qi]; c += 1
    X[:, c] = d.negsel[didx]; c += 1
    X[:, c] = q.negsel[qi] * d.ess_frac[didx]; c += 1
    X[:, c] = q.negsel[qi] * X[:, I_GE]; c += 1
    assert c == NF, (c, NF)
    return X


def text_cosines(train, query, fit_on):
    """Per-field TF-IDF cosine, vocab+idf fit on `fit_on` (train) only."""
    from sklearn.feature_extraction.text import TfidfVectorizer
    out = {}
    for f in TXT:
        v = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), sublinear_tf=True, min_df=2)
        try:
            v.fit([_lc(s.get(f)) for s in fit_on])
        except ValueError:
            out[f] = np.zeros((len(query), len(train)), np.float32)
            continue
        Q = v.transform([_lc(s.get(f)) for s in query])
        R = v.transform([_lc(s.get(f)) for s in train])
        from sklearn.preprocessing import normalize
        out[f] = np.asarray((normalize(Q) @ normalize(R).T).todense()).astype(np.float32)
    return out
