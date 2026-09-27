"""Compound identity -> target genes and mechanism class, from Open Targets.

This is pharmacology, not screen data: which protein a small molecule binds was
established when the molecule was characterised, years before any screen in the
test split.  No disease-association, GWAS or CRISPR-evidence table is read --
those are re-derived from current literature and would carry post-2021
information about the very screens being predicted.

Two products per screen:

* ``targets``  -- the compound's own target genes (bortezomib -> the 26S
  proteasome subunits, selinexor -> XPO1, olaparib -> PARP1/2).
* ``moa_class`` -- the mechanism string ("26S proteasome inhibitor"), reduced to
  class tokens, so that a test compound with no same-compound donor can still
  borrow from pre-2022 screens of a *different* molecule in the same class.
"""
import os, re, sys, json, functools
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
REF = "/Users/sahaj/Documents/Projects/SplicR/data/references"
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "pharm.json")

_STOP = {"inhibitor", "antagonist", "agonist", "modulator", "blocker", "opener",
         "activator", "binding", "agent", "inverse", "partial", "positive",
         "negative", "allosteric", "substrate", "inhibitors", "stabiliser",
         "stabilizer", "degrader", "disrupting", "and", "of", "the", "type"}


def _lst(v):
    if v is None:
        return []
    return [x for x in list(v) if isinstance(x, str)]


def _norm(s):
    s = re.sub(r"[^a-z0-9]+", " ", str(s).lower())
    return re.sub(r"\s+", " ", s).strip()


def build(force=False):
    if os.path.exists(CACHE) and not force:
        return json.load(open(CACHE))
    import duckdb
    con = duckdb.connect()
    ensg = json.load(open(os.path.join(REF, "derived", "ensg2sym.json")))
    mol = con.sql(f"select id, name, synonyms, tradeNames from '{REF}/opentargets/drug_molecule/*.parquet'").df()
    moa = con.sql(f"select mechanismOfAction, actionType, targetName, chemblIds, targets "
                  f"from '{REF}/opentargets/drug_mechanism_of_action/*.parquet'").df()
    name2id = {}
    for _, r in mol.iterrows():
        names = [r["name"]] + _lst(r["synonyms"]) + _lst(r["tradeNames"])
        for n in names:
            k = _norm(n)
            if len(k) >= 3:
                name2id.setdefault(k, r["id"])
    id2moa = {}
    for _, r in moa.iterrows():
        syms = sorted({ensg[e] for e in _lst(r["targets"]) if e in ensg})
        cls = _norm(r["mechanismOfAction"])
        for cid in _lst(r["chemblIds"]):
            e = id2moa.setdefault(cid, {"targets": set(), "moa": set(), "action": set()})
            e["targets"].update(syms); e["moa"].add(cls)
            e["action"].add(str(r["actionType"] or "").lower())
    out = {"name2id": name2id,
           "id2moa": {k: {"targets": sorted(v["targets"]), "moa": sorted(v["moa"]),
                          "action": sorted(v["action"])} for k, v in id2moa.items()}}
    json.dump(out, open(CACHE, "w"))
    return out


@functools.lru_cache(maxsize=1)
def tables():
    return build()


def resolve(name):
    """A free-text condition name -> (chembl id, targets, moa classes)."""
    t = tables()
    k = _norm(name)
    if not k:
        return None
    cid = t["name2id"].get(k)
    if cid is None:
        for part in re.split(r"[|;/(),]| and |\+", name):
            p = _norm(part)
            p = re.sub(r"\b(treatment|exposure|drug|compound|virus|mutation)\b", " ", p).strip()
            if len(p) >= 4 and p in t["name2id"]:
                cid = t["name2id"][p]
                break
            toks = p.split()
            for n in range(min(3, len(toks)), 0, -1):
                for s in range(len(toks) - n + 1):
                    cand = " ".join(toks[s:s + n])
                    if len(cand) >= 4 and cand in t["name2id"]:
                        cid = t["name2id"][cand]
                        break
                if cid:
                    break
            if cid:
                break
    if cid is None:
        return None
    e = t["id2moa"].get(cid)
    if not e:
        return (cid, [], [])
    return (cid, e["targets"], e["moa"])


def class_tokens(moas):
    out = set()
    for m in moas:
        toks = [t for t in m.split() if t not in _STOP and len(t) > 2]
        if toks:
            out.add(" ".join(toks))
            for t in toks:
                out.add(t)
    return out


if __name__ == "__main__":
    from core import uni, compound_key
    import collections
    u = uni()
    hit = miss = 0
    seen = {}
    for i in range(u.n):
        if u.split[i] != "test":
            continue
        nm = str(u.meta[i].get("condition_name") or "")
        r = resolve(nm)
        if r and r[1]:
            hit += 1
            seen.setdefault(nm[:34], (r[0], r[1][:6], sorted(class_tokens(r[2]))[:3]))
        else:
            miss += 1
    print(f"test screens with a resolved drug target: {hit}, unresolved: {miss}")
    for k, v in list(seen.items())[:28]:
        print(f"  {k:<36} {v[0]:<16} {','.join(v[1])[:56]:<58} {v[2][:2]}")
