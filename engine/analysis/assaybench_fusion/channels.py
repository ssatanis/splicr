"""Per-screen channel scores, all leave-one-publication-out exact.

A *channel* is a function (query screen) -> score vector over that screen's own
measured genes.  Every counter channel is a row-subset sum of the sparse
screen x gene matrices in :mod:`core`, with the query's own publication removed
by subtraction rather than by rebuilding the sum.

The donor pool is always ``pre2022`` (train + the 2021 validation split) minus
the query's publication.  That is the same rule for a tuning query and for a
test query, which is what makes weights fitted by leave-one-publication-out on
the 1567 pre-2022 screens transfer to the 334 test screens without any test
selection.
"""
import os, sys, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import uni, entity_keys
from common import base, split_idx, K

FIELDS = (
    "cleaned_phenotype", "screen_type", "library_methodology", "library_type",
    "experimental_setup", "cell_line", "cell_type", "direction",
    "pheno_x_dir", "pheno_x_type", "pathogen", "compound", "cytokine",
    "pathogen_x_dir", "compound_x_dir", "setup_x_dir", "method_x_dir",
)


class Counters:
    """Group sums over the donor pool, with exact per-publication subtraction."""

    def __init__(self, donor_rows):
        u = uni()
        self.u = u
        self.donor = np.asarray(sorted(donor_rows), dtype=np.int64)
        self.keys = [entity_keys(m) for m in u.meta]
        self.dset = np.zeros(u.n, bool); self.dset[self.donor] = True
        # global
        self.g = u.group_sums(self.donor)
        # per field/value groups, restricted to donors
        self.groups = {}
        for f in FIELDS:
            by = {}
            for i in self.donor:
                v = self.keys[i][f]
                if v:
                    by.setdefault(v, []).append(i)
            self.groups[f] = {v: (np.asarray(r, np.int64), u.group_sums(r)) for v, r in by.items()}
        # publication -> donor rows
        self.pub_rows = {}
        for i in self.donor:
            self.pub_rows.setdefault(u.pub[i], []).append(i)
        self.pub_rows = {p: np.asarray(r, np.int64) for p, r in self.pub_rows.items()}
        self._sub_cache = {}

    def _sub(self, rows):
        key = rows.tobytes()
        hit = self._sub_cache.get(key)
        if hit is None:
            hit = self._sub_cache[key] = self.u.group_sums(rows)
        return hit

    def global_sums(self, pub):
        own = self.pub_rows.get(pub)
        if own is None:
            return self.g
        s = self._sub(own)
        return tuple(a - b for a, b in zip(self.g, s))

    def field_sums(self, field, value, pub):
        grp = self.groups[field].get(value)
        if grp is None:
            return None
        rows, sums = grp
        own = self.pub_rows.get(pub)
        if own is None:
            return sums
        drop = rows[np.isin(rows, own)]
        if drop.size == 0:
            return sums
        s = self._sub(drop)
        return tuple(a - b for a, b in zip(sums, s))


def rate(hits, meas, prior, m):
    return (hits + m * prior) / (meas + m)


class ChannelBank:
    """Builds every channel's score vector for one query screen."""

    #: channel name -> how it is built.  Order is the canonical feature order.
    COUNTER_FIELDS = FIELDS
    LLM_MODELS = (
        "gemini-3-pro", "gemini-3.1-pro", "gpt-5.4", "gemini-3-flash", "gpt-5-mini",
        "gpt-5.2", "claude-opus-4.5", "claude-sonnet-4.5", "gpt-oss-120b",
        "fewshot/gemini-3-pro-fewshot-knn10", "fewshot/gemini-3-flash-fewshot-knn10",
        "gepa/gemini-3-flash", "Kimi-K2.5", "GLM-5", "qwen3.5-397b-a17b",
        "deepseek-v3.2", "qwen3-235b-a22b-2507", "biomni-a1-claude-4",
    )

    def __init__(self, donor_rows, m_global=20.0, m_field=8.0, ext=None, retr=None, cons_models=(), mretr=None):
        self.u = uni()
        self.c = Counters(donor_rows)
        self.retr = retr
        self.cons_models = tuple(cons_models)
        self.mretr = mretr
        self.m_global = m_global
        self.m_field = m_field
        self.ext = ext or {}
        d = base()
        self.preds = d["preds"]
        self.names = None

    def for_screen(self, i, mfield=None):
        u, c = self.u, self.c
        pub = u.pub[i]
        lib = u.ulib[i]
        m_field = self.m_field if mfield is None else mfield
        gm, gh, gr, gn = c.global_sums(pub)
        pooled = gh.sum() / max(gm.sum(), 1.0)
        g_rate = rate(gh[lib], gm[lib], pooled, self.m_global)
        g_rel = rate(gr[lib], gm[lib], pooled, self.m_global)
        g_neg = rate(gn[lib], gm[lib], 0.0, self.m_global)
        out = {"global_rate": g_rate, "global_relmass": g_rel, "neg_rate": -g_neg,
               "measured_freq": gm[lib] / max(len(c.donor), 1)}
        keys = c.keys[i]
        for f in self.COUNTER_FIELDS:
            v = keys[f]
            s = c.field_sums(f, v, pub) if v else None
            if s is None:
                out[f"cnt_{f}"] = np.zeros(len(lib), np.float32)
                out[f"rel_{f}"] = np.zeros(len(lib), np.float32)
                out[f"on_{f}"] = 0.0
                continue
            fm, fh, fr, fn = s
            out[f"cnt_{f}"] = rate(fh[lib], fm[lib], g_rate, m_field) - g_rate
            out[f"rel_{f}"] = rate(fr[lib], fm[lib], g_rel, m_field) - g_rel
            out[f"on_{f}"] = 1.0
        # published model lists, densified to the screen's own library
        gid = u.gene_ids
        for mdl in self.LLM_MODELS:
            p = self.preds.get(mdl, {}).get(i)
            v = np.zeros(len(lib), np.float32)
            if p is not None and len(p):
                pos = u.remap[p]
                pos = pos[pos >= 0]
                inlib = np.isin(pos, lib)
                keep = pos[inlib]
                r = np.arange(len(pos))[inlib]
                if len(keep):
                    where = np.searchsorted(np.sort(lib), keep)
                    # build map gene->index in lib
                    idxmap = self._libmap(i)
                    for gpos, rr in zip(keep, r):
                        j = idxmap.get(int(gpos))
                        if j is not None:
                            v[j] = 1.0 / (10.0 + rr)
            out[f"llm_{mdl}"] = v
        # metadata-only retrieval (used by the atlas-only variant)
        if self.mretr is not None:
            MR, MS = self.mretr
            own = np.where(MR.pub == pub)[0]
            mdrop = own if len(own) else None
            for tag, kk, pw, mm in (("m10", 10, 6.0, 2.0), ("m25", 25, 3.0, 8.0)):
                out[f"mretr_{tag}"] = MR.transfer(MS[i], lib, k=kk, power=pw, m=mm, drop=mdrop).astype(np.float32)
        # per-run consensus over the CV-chosen model subset
        if self.cons_models:
            from consensus import consensus_vec
            out["llm_cons"] = consensus_vec(i, self.cons_models)[lib]
        # LLM consensus aggregates: a different functional form from a weighted RRF
        lv = np.stack([out[f"llm_{m}"] for m in self.LLM_MODELS]) if self.LLM_MODELS else None
        self._lv = lv
        if lv is not None:
            listed = (lv > 0)
            out["llm_count"] = listed.mean(0).astype(np.float32)
            out["llm_best"] = lv.max(0).astype(np.float32)
            out["llm_rrf"] = lv.mean(0).astype(np.float32)
            with np.errstate(invalid="ignore"):
                mr = np.where(listed.any(0), lv.sum(0) / np.maximum(listed.sum(0), 1), 0.0)
            out["llm_meanrank"] = mr.astype(np.float32)
        # pseudo-label screen retrieval (see retrieval.Retriever)
        if self.retr is not None:
            R, S = self.retr
            srow = S[i]
            drop = np.where(R.pub == pub)[0] if len(np.where(R.pub == pub)[0]) else None
            for tag, kk, pw, mm in (("r10", 10, 6.0, 2.0), ("r25", 25, 3.0, 8.0), ("r100", 100, 3.0, 8.0)):
                out[f"retr_{tag}"] = R.transfer(srow, lib, k=kk, power=pw, m=mm, drop=drop).astype(np.float32)
            srt = np.sort(srow)[::-1]
            out[f"retr_conf"] = np.full(len(lib), float(srt[:5].mean()), np.float32)
        for name, vec in self.ext.items():
            out[name] = vec[lib] if isinstance(vec, np.ndarray) and vec.shape[0] == self.u.U else vec(i, lib)
        # knowledge channels: pharmacology and named-reporter neighbourhoods
        from knowledge import drug_vectors, reporter_vectors
        dv = drug_vectors(u.meta[i])
        out["kn_drug_target"] = (dv[0][lib] if dv else np.zeros(len(lib), np.float32))
        out["kn_drug_net"] = (dv[1][lib] if dv else np.zeros(len(lib), np.float32))
        rv = reporter_vectors(u.meta[i])
        out["kn_rep_seed"] = (rv[0][lib] if rv else np.zeros(len(lib), np.float32))
        out["kn_rep_net"] = (rv[1][lib] if rv else np.zeros(len(lib), np.float32))
        # screen-context features (constant within a screen; only a non-linear
        # model can use them, and they are what lets it route)
        lv2 = self._lv
        ctx = {
            "ctx_nmeas": math.log10(max(len(lib), 2)),
            "ctx_llm_agree": float((lv2 > 0).sum(0).mean()) if lv2 is not None else 0.0,
            "ctx_is_fitness": 1.0 * (keys["cleaned_phenotype"].startswith("Fitness")),
            "ctx_is_drug": 1.0 * (keys["cleaned_phenotype"].startswith("Drug")),
            "ctx_is_path": 1.0 * (keys["cleaned_phenotype"].startswith("Host")),
            "ctx_is_mol": 1.0 * (keys["cleaned_phenotype"].startswith("Molecular")),
            "ctx_dir_up": 1.0 * (keys["direction"] == "up"),
            "ctx_dir_down": 1.0 * (keys["direction"] == "down"),
            "ctx_dir_both": 1.0 * (keys["direction"] == "both"),
            "ctx_has_compound": 1.0 * bool(keys["compound"]),
            "ctx_has_pathogen": 1.0 * bool(keys["pathogen"]),
            "ctx_activation": 1.0 * (keys["library_methodology"] == "Activation"),
        }
        for kx, vx in ctx.items():
            out[kx] = np.full(len(lib), vx, np.float32)
        return out

    _maps = {}
    def _libmap(self, i):
        m = self._maps.get(i)
        if m is None:
            m = self._maps[i] = {int(g): j for j, g in enumerate(self.u.ulib[i])}
        return m
