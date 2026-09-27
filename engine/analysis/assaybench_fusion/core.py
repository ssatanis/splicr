"""Compact matrices, donor groups and leave-one-publication-out counters.

Every conditional hit-rate channel in this work is a row-subset sum of the same
sparse screen x gene matrices.  Group sums are computed once per
(field, value); a query's own publication is then *subtracted*, which makes
leave-one-publication-out exact and cheap enough to run for all 1567 pre-2022
screens.
"""
import os, re, sys, pickle
import numpy as np
from scipy import sparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import base, split_idx, K, DISC, andcg_from_order

HERE = os.path.dirname(os.path.abspath(__file__))


class Universe:
    """Genes measured by at least one AssayBench screen, plus the matrices over them."""

    def __init__(self):
        d = base()
        self.d = d
        lib = d["lib"]
        allg = np.unique(np.concatenate(lib))
        self.gene_ids = allg                      # index into d['genes']
        self.U = len(allg)
        remap = np.full(d["G"], -1, np.int32)
        remap[allg] = np.arange(self.U, dtype=np.int32)
        self.remap = remap
        self.sym = [d["genes"][j] for j in allg]
        self.sym2u = {s: i for i, s in enumerate(self.sym)}
        self.ulib = [remap[l] for l in lib]       # per screen, its library in universe ids
        self.rel = d["rel"]
        self.n = len(lib)
        rows = np.concatenate([np.full(len(l), i, np.int32) for i, l in enumerate(self.ulib)])
        cols = np.concatenate(self.ulib)
        relv = np.concatenate(self.rel).astype(np.float32)
        self.M = sparse.csr_matrix((np.ones(len(rows), np.float32), (rows, cols)), shape=(self.n, self.U))
        hit = (relv > 0).astype(np.float32)
        self.H = sparse.csr_matrix((hit, (rows, cols)), shape=(self.n, self.U)); self.H.eliminate_zeros()
        self.Rel = sparse.csr_matrix((np.maximum(relv, 0), (rows, cols)), shape=(self.n, self.U)); self.Rel.eliminate_zeros()
        neg = (relv < 0).astype(np.float32)
        self.Neg = sparse.csr_matrix((neg, (rows, cols)), shape=(self.n, self.U)); self.Neg.eliminate_zeros()
        self.split = d["split"]
        self.meta = d["meta"]
        self.pub = np.array([str(m.get("source_id") or f"nopub{i}") for i, m in enumerate(self.meta)])
        self.nhit = np.asarray(self.H.sum(1)).ravel()
        self.nmeas = np.asarray(self.M.sum(1)).ravel()

    # -- group accumulators ------------------------------------------------ #
    def group_sums(self, rows):
        """(measured, hits, relsum, negs) summed over the given screen rows."""
        r = np.asarray(rows, np.int64)
        return (np.asarray(self.M[r].sum(0)).ravel(),
                np.asarray(self.H[r].sum(0)).ravel(),
                np.asarray(self.Rel[r].sum(0)).ravel(),
                np.asarray(self.Neg[r].sum(0)).ravel())


_U = None
def uni():
    global _U
    if _U is None:
        _U = Universe()
    return _U


# --------------------------------------------------------------------------- #
# entity extraction from screen metadata (observable fields only)
# --------------------------------------------------------------------------- #

_VIRUS_RULES = [
    ("sars-cov-2", r"sars[\s\-]?cov[\s\-]?2|sars2|covid|hcov-19|betacov"),
    ("sars-cov-1", r"sars[\s\-]?cov(?![\s\-]?2)\b|sars coronavirus"),
    ("mers", r"\bmers\b"),
    ("hcov-229e", r"229e"),
    ("hcov-oc43", r"oc43"),
    ("hcov-nl63", r"nl63"),
    ("hiv", r"\bhiv\b|human immunodeficiency"),
    ("influenza-a", r"influenza a|\biav\b|h1n1|h3n2|\bpr8\b|wsn"),
    ("influenza-b", r"influenza b"),
    ("vaccinia", r"vaccinia|poxvirus|monkeypox|\bmpxv\b|cowpox|western reserve"),
    ("zika", r"\bzika\b|\bzikv\b"),
    ("dengue", r"dengue|\bdenv\b"),
    ("hcv", r"hepatitis c|\bhcv\b"),
    ("hbv", r"hepatitis b|\bhbv\b"),
    ("hsv", r"herpes simplex|\bhsv\b"),
    ("ebv", r"epstein|\bebv\b"),
    ("kshv", r"\bkshv\b|kaposi"),
    ("hcmv", r"cytomegalo|\bcmv\b"),
    ("vsv", r"vesicular stomatitis|\bvsv\b"),
    ("rsv", r"respiratory syncytial|\brsv\b"),
    ("hpiv", r"parainfluenza|hpiv"),
    ("ebola", r"ebola|\bebov\b|filovirus"),
    ("rift-valley", r"rift valley|\brvfv\b"),
    ("chikungunya", r"chikungunya|\bchikv\b"),
    ("enterovirus", r"enterovirus|\bev71\b|ev-d68|rhinovirus|coxsackie"),
    ("norovirus", r"norovirus|\bmnv\b"),
    ("rotavirus", r"rotavirus"),
    ("reovirus", r"reovirus"),
    ("adenovirus", r"adenovirus"),
    ("aav", r"\baav\b|adeno-associated"),
    ("lentivirus", r"lentivir|vsv-g pseudotyped"),
    ("measles", r"measles"),
    ("rabies", r"rabies"),
    ("polyomavirus", r"polyomavirus|\bbkv\b|\bjcv\b|sv40"),
    ("hpv", r"papillomavirus|\bhpv\b"),
    ("htlv", r"\bhtlv\b"),
    ("yellow-fever", r"yellow fever"),
    ("west-nile", r"west nile|\bwnv\b"),
    ("junin", r"junin|arenavirus|lassa|lcmv"),
    ("bunyavirus", r"bunyavirus|hantavirus|\bsftsv\b|oropouche|la crosse"),
]
_BACT_RULES = [
    ("salmonella", r"salmonella"), ("listeria", r"listeria"),
    ("mycobacterium", r"mycobacter|tuberculosis|\bbcg\b"),
    ("chlamydia", r"chlamydia"), ("legionella", r"legionella"),
    ("shigella", r"shigella"), ("s-aureus", r"aureus|\bmrsa\b|leukocidin"),
    ("e-coli", r"escherichia|\be\.? coli\b"),
    ("toxoplasma", r"toxoplasma"), ("plasmodium", r"plasmodium|malaria"),
    ("cryptosporidium", r"cryptosporidium"), ("candida", r"candida"),
    ("pseudomonas", r"pseudomonas"), ("helicobacter", r"helicobacter|pylori"),
    ("coxiella", r"coxiella"), ("burkholderia", r"burkholderia"),
    ("clostridium", r"clostrid|difficile"), ("streptococcus", r"streptococc"),
    ("yersinia", r"yersinia"), ("brucella", r"brucella"),
    ("anthrax", r"anthrax|bacillus anthracis"),
    ("diphtheria", r"diphther"), ("pertussis", r"pertussis"),
    ("vibrio", r"vibrio|cholera"),
]
_CYTO_RULES = [
    ("il2", r"\bil-?2\b|interleukin-?2|interleukin 2"),
    ("ifng", r"ifn-?(gamma|γ|g)\b|interferon gamma|interferon-γ"),
    ("ifnb", r"ifn-?(beta|β|b)\b|interferon beta"),
    ("ifna", r"ifn-?(alpha|α|a)\b|interferon alpha"),
    ("tnfa", r"tnf-?(alpha|α|a)?\b|tumor necrosis"),
    ("tgfb", r"tgf-?(beta|β|b)\b"),
    ("il1b", r"\bil-?1(beta|β|b)?\b"),
    ("il6", r"\bil-?6\b"), ("il4", r"\bil-?4\b"), ("il7", r"\bil-?7\b"),
    ("il10", r"\bil-?10\b"), ("il15", r"\bil-?15\b"), ("il12", r"\bil-?12\b"),
    ("il17", r"\bil-?17\b"), ("il21", r"\bil-?21\b"),
    ("gmcsf", r"gm-?csf"), ("mcsf", r"m-?csf"), ("gcsf", r"g-?csf"),
    ("trail", r"trail|tnfsf10"), ("fasl", r"\bfas-?l\b|fas ligand"),
    ("lps", r"\blps\b|lipopolysaccharide"),
    ("pma", r"\bpma\b|phorbol"),
    ("wnt", r"\bwnt\b"), ("shh", r"sonic hedgehog|\bshh\b"),
    ("egf", r"\begf\b"), ("insulin", r"insulin\b"),
    ("cd3cd28", r"cd3/cd28|anti-cd3|tcr stimulation"),
]
_MISS = {"", "not specified", "none", "nan", "unknown", "n/a", "na", "-"}


def _txt(*vals):
    return " | ".join(str(v) for v in vals if v is not None and str(v).strip().lower() not in _MISS).lower()


def condition_text(m):
    return _txt(m.get("condition_name"), m.get("condition_clause"), m.get("notes"),
                m.get("phenotype"), m.get("screen_rationale"), m.get("experimental_setup"))


_norm_cache = {}
def compound_key(m):
    """A normalised small-molecule identity from condition_name, or ''."""
    raw = str(m.get("condition_name") or "")
    if raw.strip().lower() in _MISS:
        return ""
    low = raw.lower()
    if re.search(r"virus|bacter|mutation:|cells?$|medium|pbmc", low):
        return ""
    # first clause, strip parentheticals, dose text and separators
    part = re.split(r"[|;/]| and | plus |\+", raw)[0]
    part = re.sub(r"\(.*?\)", " ", part)
    part = re.sub(r"[^a-z0-9\-\s]", " ", part.lower())
    part = re.sub(r"\b(treatment|exposure|drug|compound|inhibitor|nm|um|µm|mm|mg|ml|per|hours?|days?)\b", " ", part)
    part = re.sub(r"\s+", " ", part).strip()
    toks = [t for t in part.split() if len(t) > 2 and not t.isdigit()]
    return " ".join(toks[:3])


def pathogen_key(m):
    t = condition_text(m)
    for name, pat in _VIRUS_RULES + _BACT_RULES:
        if re.search(pat, t):
            return name
    if re.search(r"virus|viral|infection", t):
        return "virus-other"
    return ""


def cytokine_key(m):
    t = _txt(m.get("condition_name"), m.get("condition_clause"))
    for name, pat in _CYTO_RULES:
        if re.search(pat, t):
            return name
    return ""


DIR_UP, DIR_DOWN, DIR_BOTH = "up", "down", "both"
def direction_key(m):
    """Which way the screen's reported hits move, from observable fields."""
    cat = str(m.get("screen_category") or "").lower()
    st = str(m.get("screen_type") or "").lower()
    ph = str(m.get("phenotype") or "").lower()
    if "either increase" in ph or "bidirectional" in cat or "positive and negative" in st:
        return DIR_BOTH
    if re.search(r"\bdecreas|\breduc|\bloss|\bsensiti|\bimpair|depleti", ph):
        d = "down"
    elif re.search(r"\bincreas|\benhanc|\bresistan|\bgain|\benrich|promot", ph):
        d = "up"
    else:
        d = "pos" if "positive" in st else ("neg" if "negative" in st else "other")
    return d


def entity_keys(m):
    """All entity-conditioning keys for one screen, as (field, value) pairs."""
    out = {}
    for f in ("cleaned_phenotype", "screen_type", "library_methodology", "library_type",
              "experimental_setup", "cell_line", "cell_type", "screen_category"):
        v = str(m.get(f) or "").strip()
        out[f] = v if v.lower() not in _MISS else ""
    out["pathogen"] = pathogen_key(m)
    out["compound"] = compound_key(m)
    out["cytokine"] = cytokine_key(m)
    out["direction"] = direction_key(m)
    out["pheno_x_dir"] = (out["cleaned_phenotype"] + "|" + out["direction"]) if out["cleaned_phenotype"] else ""
    out["pheno_x_type"] = (out["cleaned_phenotype"] + "|" + out["screen_type"]) if out["cleaned_phenotype"] else ""
    out["pathogen_x_dir"] = (out["pathogen"] + "|" + out["direction"]) if out["pathogen"] else ""
    out["compound_x_dir"] = (out["compound"] + "|" + out["direction"]) if out["compound"] else ""
    out["setup_x_dir"] = (out["experimental_setup"] + "|" + out["direction"]) if out["experimental_setup"] else ""
    out["method_x_dir"] = (out["library_methodology"] + "|" + out["direction"]) if out["library_methodology"] else ""
    return out


if __name__ == "__main__":
    u = uni()
    print("universe", u.U, "screens", u.n)
    import collections
    for fld in ("pathogen", "compound", "cytokine", "direction"):
        te = collections.Counter(); pre = collections.Counter()
        for i in range(u.n):
            k = entity_keys(u.meta[i])[fld]
            if not k:
                continue
            (te if u.split[i] == "test" else pre)[k] += 1
        cov = sum(v for v in te.values())
        print(f"\n{fld}: covers {cov} test screens; top test values with pre-2022 donor counts")
        for k, v in te.most_common(12):
            print(f"   {k:<18} test={v:<4} pre2022={pre.get(k, 0)}")
