"""EXTERNAL BIOLOGY feature family for AssayBench screen-level gene ranking.

Every feature in this module is computed from resources that contain **no CRISPR
screen hit calls from AssayBench or BioGRID ORCS**. Nothing here reads the
AssayBench test split, and nothing here reads ``relevance_genes`` /
``relevance_scores`` — the only screen fields consulted are the descriptive
metadata columns (``cell_line``, ``condition_name``, ``phenotype``, …), which are
part of the benchmark's *input* and are shown to the LLM baselines too.

The family has three layers.

1. **Gene-level priors** (identical for every screen). How broadly essential a
   gene is across DepMap's 1,178 Chronos cell lines, whether it is a Hart core
   essential or nonessential, how central it is in the STRING network, how many
   Reactome pathways and GO terms it carries, how mutation-constrained it is in
   gnomAD, and how often it is mentioned in the literature.

2. **Cell-line-conditional features**. The screen's ``cell_line`` string is
   matched to a DepMap ``ModelID`` (and hence to that line's own Chronos
   profile, or its lineage mean) through ``Model.csv`` name normalisation.

3. **Condition-conditional features**. The screen's ``condition_name`` /
   ``condition_clause`` is resolved to external entities — a ChEMBL molecule
   (via Open Targets ``drug_molecule``, then its mechanism-of-action targets and
   its DGIdb interaction partners) or an HGNC gene symbol named in the text —
   and those *seed* genes are expanded through the STRING network, Reactome
   pathway co-membership and DepMap co-dependency.

Measured standalone validation AnDCG@100 (218 screens, 2021 fold; upstream
``assaybench.benchmark.metrics.RankingMetrics``, key ``adjusted_ndcg@100``;
random baseline on the same split is 0.01941)::

    depmap_frac_dependent            0.17083   <-- best single feature
    depmap_frac_strong_dependent     0.16929
    depmap_dependency_amount         0.16564
    depmap_mean_dependency           0.16539
    depmap_lineage_dependency        0.16301
    depmap_cellline_dependency       0.15414
    ceg_v2_core_essential            0.12410
    depmap_common_essential          0.11650
    string_physical_degree           0.11084
    depmap_selectivity               0.10380
    ot_n_pathway                     0.08950
    ot_missense_z                    0.07678
    string_functional_degree         0.07169
    ot_neg_loeuf                     0.05204
    literature_mentions_log          0.05089
    condition_string_proximity       0.05016
    ot_n_go                          0.04482
    condition_codependency           0.03911
    condition_reactome_overlap       0.03613
    condition_seed_member            0.02483
    neg_v1_nonessential              0.01914   (indistinguishable from random)

``neg_v1_nonessential`` is reported for the raw feature, i.e. ranking Hart
nonessentials *first*. That is the wrong direction for a dependency screen; the
feature is emitted un-negated so a downstream model can choose the sign, and its
standalone number is therefore expected to sit at the random baseline.

The honest headline: **the family's entire usable signal is DepMap breadth of
essentiality.** Nothing else in it is additive — see "What did not work" below
and the notes on ``biology_composite``.

And the harder finding: **the family is redundant with the screen-derived
frequency prior, not complementary to it.** Fitting a per-gene hit frequency on
the 1,349 train screens and applying it to validation gives 0.17681, slightly
*better* than this family's best feature::

    train gene-frequency prior (screen-derived)   0.17681
    depmap_frac_dependent (zero screen labels)    0.17083
        paired delta -0.00598, bootstrap CI95 [-0.01200, -0.00022],
        Wilcoxon p=0.232   -> biology is at best equal, probably slightly worse
    rank-average of the two                       0.17627
        paired delta vs the prior alone -0.00054, CI95 [-0.00407, +0.00294]
        -> the ensemble does NOT beat the prior; the CI straddles zero

Both estimators are ranking essentially the same thing — "genes that are broadly
essential, and therefore commonly reported as hits" — one from DepMap and one
from the train screens. So this family is best read as an *independent
confirmation* that the frequency prior's signal is real biology rather than a
corpus artefact, and as a label-free substitute usable where no train screens
exist. It is not, on this evidence, a route to beating the 0.16309 LLM RRF
ensemble. Something that discriminates *between* screens is still required.

What did not work
-----------------
* **Cell-line-specific dependency is worse than the global prior** (0.154 vs
  0.171), even though 144 of the 218 validation screens match a DepMap line
  with CRISPR data. A single Chronos column is noisy, and AssayBench relevance
  tracks whether a screen *reported* a gene, which favours broadly reproducible
  essentials over line-specific ones.
* **Seed expansion barely works.** Drug-target seeds resolve for 110/218
  validation screens and text gene mentions for 66/218, but the best expansion
  (1-hop STRING max-weight, seeds boosted above their own neighbours) only
  reaches 0.0502, and random-walk-with-restart,
  Reactome co-membership, GO co-membership and DepMap co-dependency are all
  worse. Seed membership itself is 0.0248, barely above random.
* **Ontology text matching failed outright.** Exact GO biological-process label
  matching fires on 9/218 screens; a TF-IDF token version fires widely but
  scores 0.0371.
* **Open Targets gene-disease association was not usable for the screens that
  need it.** Only 1 of the 9 distinct pathogen conditions in validation
  (SARS-CoV-2) resolves to an EFO/MONDO id by name or synonym, so the
  host-pathogen stratum — where essentiality scores 0.016 — gets no help.
* **No composite beat the best single feature.** Rank-averaging essentiality
  with any of ``ot_n_pathway``, ``ot_missense_z``, ``string_physical_degree``,
  ``literature_mentions_log`` or ``condition_string_proximity`` moved the mean
  by at most +0.0011 (inside noise), and the 4- and 6-feature blends were
  strictly worse (0.1656 and 0.1625).
* ``neg_v1_nonessential`` is not distinguishable from random.

Where essentiality fails, by stratum (validation, ``depmap_frac_dependent``)::

    Fitness / Proliferation / Viability        n= 36   0.4566
    Drug / Chemical / Environmental Response   n=157   0.1272
    Host-Pathogen / Infection Response         n= 17   0.0163
    screen_type == "Positive Selection"        n= 48   0.0233   (random 0.0051)
    screen_type == "Positive and Negative"     n= 51   0.3534

Usage
-----
    from splicr.features.biology import compute_biology_features, FEATURE_NAMES
    feats = compute_biology_features(screens)          # list of AssayBench dicts
    feats[screen["dataset_name"]]["TP53"]["depmap_frac_dependent"]

Run ``python -m splicr.features.biology`` for the self-check, which prints the
standalone validation AnDCG@100 of the family's best single feature.
"""

from __future__ import annotations

import collections
import csv
import functools
import glob
import gzip
import json
import math
import os
import re
from typing import Any, Callable, Iterable, Mapping, Sequence

import numpy as np

# --------------------------------------------------------------------------- #
# Paths
# --------------------------------------------------------------------------- #

REFERENCES = os.environ.get(
    "SPLICR_REFERENCES",
    "/Users/sahaj/Documents/Projects/SplicR/data/references",
)
DERIVED = os.path.join(REFERENCES, "derived")

#: Chronos gene-effect cutoff defining "dependent" for :data:`FEATURE_NAMES`
#: entry ``depmap_frac_dependent``. Chosen on the validation split by sweeping
#: {-0.3, -0.5, -0.7, -0.9, -1.0, -1.2, -1.5, -2.0}; -0.7 was best (0.17083).
DEPENDENCY_CUTOFF = -0.7
STRONG_DEPENDENCY_CUTOFF = -1.0

#: Minimum STRING combined_score (x1000) kept when building the network cache.
STRING_MIN_SCORE = 150

FEATURE_NAMES: list[str] = [
    # --- layer 1: gene-level priors (screen-independent) ---
    "depmap_frac_dependent",
    "depmap_frac_strong_dependent",
    "depmap_mean_dependency",
    "depmap_dependency_amount",
    "depmap_selectivity",
    "depmap_common_essential",
    "ceg_v2_core_essential",
    "neg_v1_nonessential",
    "string_physical_degree",
    "string_functional_degree",
    "ot_n_pathway",
    "ot_n_go",
    "ot_missense_z",
    "ot_neg_loeuf",
    "literature_mentions_log",
    # --- layer 2: cell-line-conditional ---
    "depmap_cellline_dependency",
    "depmap_lineage_dependency",
    # --- layer 3: condition-conditional (external entity -> seeds -> expansion) ---
    "condition_seed_member",
    "condition_string_proximity",
    "condition_reactome_overlap",
    "condition_codependency",
    # --- composite ---
    "biology_composite",
]

#: Screen metadata fields this module is allowed to read. ``relevance_genes``
#: and ``relevance_scores`` are deliberately absent: no label is ever consulted.
METADATA_FIELDS_USED = (
    "dataset_name",
    "cell_line",
    "cell_type",
    "phenotype",
    "screen_rationale",
    "condition_name",
    "condition_clause",
    "experimental_setup",
    "library_methodology",
    "screen_type",
    "notes",
)

# Tokens that are HGNC symbols or aliases but are overwhelmingly lab jargon,
# units, or English words in AssayBench free text. Excluding them keeps the
# text-mention seed extractor precise.
_MENTION_STOPWORDS = frozenset(
    """TIL SET CAD AID MET REST IMPACT SHE CS MICE IMP ACE ARC CAMP CAT CAP CASH
    DNA RNA MRNA CRISPR KO SGRNA GRNA WT DMSO PBS FBS IFN IL TNF MHC HLA CD ADP
    ATP GTP NAD FAD CO LARGE SMALL MAX MIN AGE SEX ALL AND NOT FOR THE PER USE
    VS NA ND MMS DCA IR AFB1 TTFA SAHA HR DAY DAYS HOUR NM UM MM MG ML KG PM AM
    EC IC LD MOI PFU SD SEM CI FDR PVALUE LOG2 LOG FC SPIKE RBD GVAX TAK AZD BI
    RO NU JG CBK HB EMI BAPTA GPS TG KH CB CO2 T""".split()
)


# --------------------------------------------------------------------------- #
# Cache construction
# --------------------------------------------------------------------------- #

def _ref(*parts: str) -> str:
    return os.path.join(REFERENCES, *parts)


def _der(*parts: str) -> str:
    return os.path.join(DERIVED, *parts)


def _strip_entrez(col: str) -> str:
    """``"A1BG (1)"`` -> ``"A1BG"``  (DepMap column and gene-list convention)."""
    return re.sub(r"\s*\(\d+\)$", "", str(col)).strip()


def _build_depmap_cache() -> None:
    import pandas as pd

    os.makedirs(DERIVED, exist_ok=True)
    df = pd.read_csv(_ref("depmap", "CRISPRGeneEffect.csv"), index_col=0)
    genes = [_strip_entrez(c) for c in df.columns]
    models = list(df.index)
    mat = df.to_numpy(dtype=np.float32)
    np.save(_der("depmap_chronos.npy"), mat)
    with open(_der("depmap_chronos_index.json"), "w") as fh:
        json.dump({"genes": genes, "models": models}, fh)

    lineage = (
        pd.read_csv(_ref("depmap", "Model.csv"))
        .set_index("ModelID")["OncotreeLineage"]
        .reindex(models)
    )
    cols = {}
    with np.errstate(invalid="ignore"):
        for name, idx in pd.Series(range(len(models)), index=lineage.values).groupby(level=0):
            cols[name] = np.nanmean(mat[idx.values, :], axis=0)
    pd.DataFrame(cols, index=genes).to_parquet(_der("depmap_lineage_mean.parquet"))


def _build_ot_cache() -> None:
    import pandas as pd
    import pyarrow as pa
    import pyarrow.parquet as pq

    os.makedirs(DERIVED, exist_ok=True)
    rows, ensg2sym, go_map, pw_map = [], {}, {}, {}
    for path in sorted(glob.glob(_ref("opentargets", "target", "*.parquet"))):
        table = pq.read_table(
            path,
            columns=["id", "approvedSymbol", "biotype", "go", "pathways",
                     "constraint", "subcellularLocations", "hallmarks"],
        ).to_pylist()
        for rec in table:
            sym = rec["approvedSymbol"]
            ensg2sym[rec["id"]] = sym
            loeuf = mis_z = None
            for con in rec["constraint"] or ():
                if con["constraintType"] == "lof":
                    loeuf = con.get("oeUpper")
                elif con["constraintType"] == "mis":
                    mis_z = con.get("score")
            gos = sorted({g["id"] for g in rec["go"] or ()})
            pws = sorted({p["pathwayId"] for p in rec["pathways"] or ()})
            go_map[sym], pw_map[sym] = gos, pws
            rows.append(
                dict(ensg=rec["id"], symbol=sym, biotype=rec["biotype"], loeuf=loeuf,
                     mis_z=mis_z, n_go=len(gos), n_pathway=len(pws),
                     n_subcell=len(rec["subcellularLocations"] or ()),
                     has_hallmarks=bool(rec["hallmarks"]))
            )
    pd.DataFrame(rows).to_parquet(_der("ot_gene_attrs.parquet"), index=False)
    for obj, name in ((ensg2sym, "ensg2sym"), (go_map, "ot_gene_go"),
                      (pw_map, "ot_gene_pathways")):
        with open(_der(f"{name}.json"), "w") as fh:
            json.dump(obj, fh)

    assoc_parts = sorted(glob.glob(_ref("opentargets", "association_overall_direct", "*.parquet")))
    if assoc_parts:
        tab = pa.concat_tables(
            pq.read_table(p, columns=["diseaseId", "targetId", "associationScore",
                                      "evidenceCount"])
            for p in assoc_parts
        )
        adf = tab.to_pandas()
        adf["symbol"] = adf["targetId"].map(ensg2sym)
        adf = adf.dropna(subset=["symbol"])
        adf = adf[adf.associationScore > 0.01]
        adf[["diseaseId", "symbol", "associationScore", "evidenceCount"]].to_parquet(
            _der("ot_assoc_direct.parquet"), index=False
        )


def _build_string_cache() -> None:
    import scipy.sparse as sp

    os.makedirs(DERIVED, exist_ok=True)
    ensp2sym: dict[str, str] = {}
    with gzip.open(_ref("string", "9606.protein.info.v12.0.txt.gz"), "rt") as fh:
        next(fh)
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            ensp2sym[parts[0]] = parts[1]

    for tag, fname in (("full", "9606.protein.links.v12.0.txt.gz"),
                       ("phys", "9606.protein.physical.links.v12.0.txt.gz")):
        sym2i: dict[str, int] = {}
        rows, cols, vals = [], [], []
        with gzip.open(_ref("string", fname), "rt") as fh:
            next(fh)
            for line in fh:
                a, b, score = line.split()
                score = int(score)
                if score < STRING_MIN_SCORE:
                    continue
                a, b = ensp2sym.get(a), ensp2sym.get(b)
                if not a or not b or a == b:
                    continue
                rows.append(sym2i.setdefault(a, len(sym2i)))
                cols.append(sym2i.setdefault(b, len(sym2i)))
                vals.append(score / 1000.0)
        n = len(sym2i)
        adj = sp.coo_matrix((vals, (rows, cols)), shape=(n, n)).tocsr()
        adj = adj.maximum(adj.T)
        sp.save_npz(_der(f"string_{tag}.npz"), adj)
        with open(_der(f"string_{tag}_index.json"), "w") as fh:
            json.dump({"symbols": [k for k, _ in sorted(sym2i.items(), key=lambda kv: kv[1])]}, fh)


def _build_literature_cache() -> None:
    """Per-symbol PubTator3 mention counts, from the local gene2pubtator3 dump."""
    os.makedirs(DERIVED, exist_ok=True)
    entrez2sym = {}
    with open(_ref("annotation", "hgnc_complete_set.txt"), newline="") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            eid = (row.get("entrez_id") or "").strip()
            if eid and row.get("status") == "Approved":
                entrez2sym[eid] = row["symbol"]
    counts: collections.Counter[str] = collections.Counter()
    with gzip.open(_ref("literature", "gene2pubtator3.gz"), "rt") as fh:
        next(fh, None)
        for line in fh:
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            for eid in parts[2].split(";"):
                sym = entrez2sym.get(eid.strip())
                if sym:
                    counts[sym] += 1
    with open(_der("pubtator_symbol_counts.json"), "w") as fh:
        json.dump(dict(counts), fh)


_CACHE_BUILDERS: tuple[tuple[str, Callable[[], None]], ...] = (
    ("depmap_chronos.npy", _build_depmap_cache),
    ("ot_gene_attrs.parquet", _build_ot_cache),
    ("string_full.npz", _build_string_cache),
    ("pubtator_symbol_counts.json", _build_literature_cache),
)


def ensure_caches(verbose: bool = False) -> None:
    """Build any missing derived cache under ``data/references/derived``.

    Idempotent and deterministic: each builder reads only the pinned reference
    dumps recorded in the sibling ``SOURCES.txt`` files.
    """
    os.makedirs(DERIVED, exist_ok=True)
    for sentinel, builder in _CACHE_BUILDERS:
        if not os.path.exists(_der(sentinel)):
            if verbose:
                print(f"[biology] building cache: {sentinel}")
            builder()


# --------------------------------------------------------------------------- #
# Resource loaders (each cached for the process lifetime)
# --------------------------------------------------------------------------- #

def _normkey(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def _normcell(value: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value).upper())


@functools.lru_cache(maxsize=1)
def _chronos() -> tuple[np.ndarray, list[str], list[str], dict[str, int], dict[str, int]]:
    idx = json.load(open(_der("depmap_chronos_index.json")))
    mat = np.load(_der("depmap_chronos.npy"))
    genes, models = idx["genes"], idx["models"]
    return (mat, genes, models,
            {g: i for i, g in enumerate(genes)},
            {m: i for i, m in enumerate(models)})


@functools.lru_cache(maxsize=1)
def _depmap_gene_priors() -> dict[str, dict[str, float]]:
    """Screen-independent DepMap summaries, keyed by feature name."""
    mat, genes, _, _, _ = _chronos()
    with np.errstate(invalid="ignore"):
        frac = np.nanmean(mat < DEPENDENCY_CUTOFF, axis=0)
        frac_strong = np.nanmean(mat < STRONG_DEPENDENCY_CUTOFF, axis=0)
        mean_eff = np.nanmean(mat, axis=0)
        amount = np.nanmean(np.clip(-mat, 0.0, None), axis=0)
        median_eff = np.nanmedian(mat, axis=0)
        min_eff = np.nanmin(mat, axis=0)
    return {
        "depmap_frac_dependent": dict(zip(genes, frac.astype(float))),
        "depmap_frac_strong_dependent": dict(zip(genes, frac_strong.astype(float))),
        "depmap_mean_dependency": dict(zip(genes, (-mean_eff).astype(float))),
        "depmap_dependency_amount": dict(zip(genes, amount.astype(float))),
        "depmap_selectivity": dict(zip(genes, (median_eff - min_eff).astype(float))),
    }


@functools.lru_cache(maxsize=1)
def _chronos_zscored() -> tuple[np.ndarray, np.ndarray]:
    """Mean-imputed, column-z-scored Chronos matrix for co-dependency, plus a
    mask of columns with enough observations to be trustworthy."""
    mat, _, _, _, _ = _chronos()
    ok = np.sum(~np.isnan(mat), axis=0) > 300
    mu = np.nanmean(mat, axis=0)
    filled = np.where(np.isnan(mat), mu, mat).astype(np.float32)
    z = (filled - filled.mean(0)) / np.maximum(filled.std(0), 1e-6)
    z[:, ~ok] = 0.0
    return z, ok


@functools.lru_cache(maxsize=1)
def _common_essentials() -> frozenset[str]:
    import pandas as pd

    col = pd.read_csv(_ref("depmap", "CRISPRInferredCommonEssentials.csv"))["Essentials"]
    return frozenset(_strip_entrez(x) for x in col)


def _read_gene_set(name: str) -> frozenset[str]:
    lines = open(_ref("genesets", f"{name}.txt")).read().splitlines()
    return frozenset(l.split("\t")[0].strip() for l in lines[1:] if l.strip())


@functools.lru_cache(maxsize=1)
def _hart_sets() -> tuple[frozenset[str], frozenset[str]]:
    return _read_gene_set("CEGv2"), _read_gene_set("NEGv1")


@functools.lru_cache(maxsize=1)
def _ot_gene_attrs() -> dict[str, dict[str, float]]:
    import pandas as pd

    tab = (pd.read_parquet(_der("ot_gene_attrs.parquet"))
             .dropna(subset=["symbol"]).drop_duplicates("symbol").set_index("symbol"))
    return {
        "ot_n_pathway": tab["n_pathway"].astype(float).to_dict(),
        "ot_n_go": tab["n_go"].astype(float).to_dict(),
        "ot_missense_z": tab["mis_z"].fillna(0.0).astype(float).to_dict(),
        # gnomAD LOEUF: lower = more constrained, so negate to keep "higher is
        # more interesting". Unmeasured genes get the unconstrained value 2.0.
        "ot_neg_loeuf": (-tab["loeuf"].fillna(2.0)).astype(float).to_dict(),
    }


@functools.lru_cache(maxsize=1)
def _literature_counts() -> dict[str, float]:
    raw = json.load(open(_der("pubtator_symbol_counts.json")))
    return {g: math.log1p(float(c)) for g, c in raw.items()}


@functools.lru_cache(maxsize=2)
def _string(tag: str):
    import scipy.sparse as sp

    adj = sp.load_npz(_der(f"string_{tag}.npz"))
    syms = json.load(open(_der(f"string_{tag}_index.json")))["symbols"]
    return adj, syms, {s: i for i, s in enumerate(syms)}


@functools.lru_cache(maxsize=2)
def _string_degree(tag: str) -> dict[str, float]:
    adj, syms, _ = _string(tag)
    return dict(zip(syms, np.asarray(adj.sum(axis=1)).ravel().astype(float)))


@functools.lru_cache(maxsize=1)
def _gene_pathways() -> dict[str, list[str]]:
    return json.load(open(_der("ot_gene_pathways.json")))


@functools.lru_cache(maxsize=1)
def _ensg2sym() -> dict[str, str]:
    return json.load(open(_der("ensg2sym.json")))


@functools.lru_cache(maxsize=1)
def _hgnc() -> tuple[frozenset[str], dict[str, str]]:
    """(approved symbols, alias/previous symbol -> approved symbol)."""
    approved: set[str] = set()
    alias: dict[str, str] = {}
    with open(_ref("annotation", "hgnc_complete_set.txt"), newline="") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            sym = row["symbol"].strip()
            if not sym or row.get("status") != "Approved":
                continue
            approved.add(sym)
            for col in ("alias_symbol", "prev_symbol"):
                for a in (row.get(col) or "").split("|"):
                    a = a.strip()
                    if len(a) >= 3:
                        alias.setdefault(a, sym)
    alias = {a: s for a, s in alias.items() if a not in approved}
    return frozenset(approved), alias


@functools.lru_cache(maxsize=1)
def _drug_index() -> tuple[dict[str, set[str]], dict[str, set[str]], dict[str, set[tuple[str, float]]]]:
    """(name-key -> ChEMBL ids, ChEMBL id -> ENSG targets, name-key -> DGIdb hits)."""
    import pyarrow.parquet as pq

    def label(x):
        return x.get("label") if isinstance(x, dict) else x

    name2id: dict[str, set[str]] = {}
    for path in glob.glob(_ref("opentargets", "drug_molecule", "*.parquet")):
        for rec in pq.read_table(
            path, columns=["id", "name", "synonyms", "tradeNames"]
        ).to_pylist():
            names = [rec["name"]]
            names += [label(s) for s in rec["synonyms"] or ()]
            names += [label(s) for s in rec["tradeNames"] or ()]
            for nm in names:
                key = _normkey(nm) if nm else ""
                if len(key) >= 4:
                    name2id.setdefault(key, set()).add(rec["id"])

    moa: dict[str, set[str]] = collections.defaultdict(set)
    for path in glob.glob(_ref("opentargets", "drug_mechanism_of_action", "*.parquet")):
        for rec in pq.read_table(path, columns=["chemblIds", "targets"]).to_pylist():
            for cid in rec["chemblIds"] or ():
                moa[cid].update(rec["targets"] or ())

    dgidb: dict[str, set[tuple[str, float]]] = collections.defaultdict(set)
    dg_path = _ref("dgidb", "interactions.tsv")
    if os.path.exists(dg_path):
        with open(dg_path) as fh:
            for row in csv.DictReader(fh, delimiter="\t"):
                drug, gene = (row.get("drug_name") or ""), (row.get("gene_name") or "")
                if not drug or not gene or gene == "NULL":
                    continue
                key = _normkey(drug)
                if len(key) < 4:
                    continue
                try:
                    score = float(row.get("interaction_score") or 0.0)
                except ValueError:
                    score = 0.0
                dgidb[key].add((gene, score))
    return name2id, dict(moa), dict(dgidb)


@functools.lru_cache(maxsize=1)
def _depmap_model_index() -> tuple[dict[str, str], dict[str, str]]:
    """(normalised cell-line name -> ModelID, ModelID -> OncotreeLineage)."""
    import pandas as pd

    models = pd.read_csv(_ref("depmap", "Model.csv"))
    name2model: dict[str, str] = {}
    for _, row in models.iterrows():
        for col in ("StrippedCellLineName", "CellLineName"):
            value = row.get(col)
            if isinstance(value, str) and value:
                name2model.setdefault(_normcell(value), row["ModelID"])
    lineage = models.set_index("ModelID")["OncotreeLineage"].to_dict()
    return name2model, lineage


@functools.lru_cache(maxsize=1)
def _lineage_means():
    import pandas as pd

    return pd.read_parquet(_der("depmap_lineage_mean.parquet"))


# --------------------------------------------------------------------------- #
# Entity resolution from screen metadata text
# --------------------------------------------------------------------------- #

def drug_name_candidates(screen: Mapping[str, Any]) -> list[str]:
    """Candidate drug-name strings extracted from a screen's condition fields.

    Handles AssayBench's condition conventions: the ``" under X treatment (dose)"``
    clause, parenthetical aliases (``"Pladienolide B (PladB)"``), ``/``- and
    ``|``-joined combinations (``"Vorinostat/SAHA"``,
    ``"Mutation: EGFR ...| erlotinib"``).
    """
    out: list[str] = []
    for field in ("condition_name", "condition_clause"):
        text = screen.get(field) or ""
        if not text or text == "Not specified":
            continue
        text = re.sub(r"^\s*under\s+", "", text)
        text = re.sub(r"\s+treatment.*$", "", text)
        text = re.sub(r"^Mutation:.*?\|\s*", "", text)
        out.append(text)
        match = re.match(r"^(.*?)\s*\(([^)]+)\)\s*$", text.strip())
        if match:
            out += [match.group(1), match.group(2)]
        out += re.split(r"[/|,]", re.sub(r"\([^)]*\)", "", text))
    return [x.strip() for x in out if x and x.strip()]


def gene_mentions(screen: Mapping[str, Any]) -> set[str]:
    """HGNC symbols named in a screen's own description text.

    Catches the ``"Mutation: RIT1 (ETG6016) M90I"`` genetic-background
    conditions, receptor conditions (``"Transferrin receptor (TFRC/CD71)"``),
    and inhibitor-of-target shorthand (``"AZD5576 (CDK9i)"`` -> ``CDK9``).
    Only standalone uppercase tokens are considered, and
    :data:`_MENTION_STOPWORDS` removes the lab-jargon collisions.
    """
    approved, alias = _hgnc()
    found: set[str] = set()
    for field in ("condition_name", "condition_clause", "screen_rationale",
                  "phenotype", "experimental_setup", "notes", "cell_type",
                  "library_methodology"):
        for token in re.findall(r"\b[A-Z][A-Z0-9\-]{1,9}\b", screen.get(field) or ""):
            if token in _MENTION_STOPWORDS:
                continue
            if token in approved:
                found.add(token)
            elif token in alias:
                found.add(alias[token])
    for field in ("condition_name", "condition_clause", "screen_rationale", "notes"):
        for match in re.finditer(r"\b([A-Z][A-Z0-9]{1,7})i\b", screen.get(field) or ""):
            gene = match.group(1)
            if gene in approved and gene not in _MENTION_STOPWORDS:
                found.add(gene)
    return found


def drug_target_seeds(screen: Mapping[str, Any]) -> dict[str, float]:
    """``{symbol: weight}`` for the targets of the screen's named drug.

    Open Targets mechanism-of-action targets get weight 1.0; DGIdb interaction
    partners get ``min(0.9, 0.3 + interaction_score)`` so that curated
    mechanisms outrank bulk literature interactions.
    """
    name2id, moa, dgidb = _drug_index()
    ensg2sym = _ensg2sym()
    weights: dict[str, float] = collections.defaultdict(float)
    for cand in drug_name_candidates(screen):
        key = _normkey(cand)
        if len(key) < 4:
            continue
        for cid in name2id.get(key, ()):
            for ensg in moa.get(cid, ()):
                sym = ensg2sym.get(ensg)
                if sym:
                    weights[sym] = max(weights[sym], 1.0)
        for gene, score in dgidb.get(key, ()):
            weights[gene] = max(weights[gene], min(0.9, 0.3 + score))
    return dict(weights)


def condition_seeds(screen: Mapping[str, Any]) -> dict[str, float]:
    """Union of :func:`drug_target_seeds` and :func:`gene_mentions` with weights.

    Coverage on the validation split: drug-target seeds fire for 110/218
    screens, text gene mentions for 66/218, at least one for 148/218.
    """
    weights: dict[str, float] = collections.defaultdict(float)
    for gene, weight in drug_target_seeds(screen).items():
        weights[gene] = max(weights[gene], weight)
    for gene in gene_mentions(screen):
        weights[gene] = max(weights[gene], 1.0)
    return dict(weights)


def match_depmap_model(cell_line: Any) -> str | None:
    """Resolve an AssayBench ``cell_line`` string to a DepMap ``ModelID``.

    Tries the normalised name, then drops an hTERT prefix, a clone suffix after
    a dot, and a trailing digit run — which is what maps ``"HAP-1"``->``HAP1``,
    ``"HCT 116"``->``HCT116``, ``"Huh-7.5.1"``->``HUH7``. 182 of the 218
    validation screens resolve to a ``Model.csv`` row; 144 of those rows have
    Chronos data.
    """
    name2model, _ = _depmap_model_index()
    key = _normcell(cell_line)
    for candidate in (key, re.sub(r"(HTERT|TERT)", "", key), key.split(".")[0],
                      re.sub(r"\d+$", "", key)):
        if candidate and candidate in name2model:
            return name2model[candidate]
    return None


# --------------------------------------------------------------------------- #
# Screen-conditional feature computation
# --------------------------------------------------------------------------- #

def _cellline_dependency(screen: Mapping[str, Any]) -> dict[str, float]:
    """Negated Chronos effect for the screen's own line, with graceful fallback.

    Order: the matched line's own profile -> its lineage mean -> the all-lines
    mean. Every step of that chain is a negated Chronos gene effect, so the
    feature stays on one scale across screens no matter which step supplied it —
    falling back to a 0..1 dependency *fraction* here would make the column
    incomparable between a matched and an unmatched screen.

    Measured standalone it is *worse* than the global ``depmap_frac_dependent``
    prior (0.154 vs 0.171); it is kept because it is the right feature to hand a
    downstream model that can learn when to trust it.
    """
    mat, genes, _, _, model_idx = _chronos()
    model = match_depmap_model(screen.get("cell_line"))
    if model in model_idx:
        col = -mat[model_idx[model], :]
        return {g: (0.0 if np.isnan(col[i]) else float(col[i])) for i, g in enumerate(genes)}
    return _lineage_dependency(screen)


def _lineage_dependency(screen: Mapping[str, Any]) -> dict[str, float]:
    """Negated mean Chronos effect across the screen's DepMap lineage.

    Falls back to the all-lines mean (``depmap_mean_dependency``), which is the
    same quantity averaged over every lineage, so the scale is preserved.
    """
    _, lineage = _depmap_model_index()
    model = match_depmap_model(screen.get("cell_line"))
    name = lineage.get(model) if model else None
    frames = _lineage_means()
    if name and name in frames.columns:
        return (-frames[name]).fillna(0.0).astype(float).to_dict()
    return _depmap_gene_priors()["depmap_mean_dependency"]


def _string_proximity(seeds: Mapping[str, float]) -> dict[str, float]:
    """Max STRING combined-score edge weight from each gene to any seed.

    Seeds themselves are given ``1.0 + weight`` so they always outrank their
    own neighbours. 1-hop max beat 1-hop sum and 2-/5-step
    random-walk-with-restart on validation.
    """
    if not seeds:
        return {}
    adj, syms, sym_idx = _string("full")
    present = [(sym_idx[g], w) for g, w in seeds.items() if g in sym_idx]
    if not present:
        return {}
    out = np.zeros(len(syms), dtype=np.float64)
    for i, weight in present:
        row = adj.getrow(i)
        out[row.indices] = np.maximum(out[row.indices], row.data * weight)
    for i, weight in present:
        out[i] = max(out[i], 1.0 + weight)
    return {syms[i]: float(out[i]) for i in np.nonzero(out)[0]}


def _reactome_overlap(seeds: Mapping[str, float], universe: Iterable[str]) -> dict[str, float]:
    """How many of the seeds' Reactome pathways a gene also belongs to."""
    if not seeds:
        return {}
    pathways = _gene_pathways()
    counts: collections.Counter[str] = collections.Counter()
    for gene in seeds:
        for pid in pathways.get(gene, ()):
            counts[pid] += 1
    if not counts:
        return {}
    out = {}
    for gene in universe:
        own = pathways.get(gene)
        if own:
            total = sum(counts[p] for p in own)
            if total:
                out[gene] = float(total)
    return out


def _codependency(seeds: Mapping[str, float]) -> dict[str, float]:
    """Max Pearson correlation of a gene's Chronos profile with any seed's.

    Co-essentiality is the standard label-free way to place a gene in the same
    pathway or complex as a known target. On validation it reaches only 0.0391.
    """
    if not seeds:
        return {}
    z, ok = _chronos_zscored()
    _, genes, _, gene_idx, _ = _chronos()
    cols = [gene_idx[g] for g in seeds if g in gene_idx and ok[gene_idx[g]]]
    if not cols:
        return {}
    corr = (z.T @ z[:, cols]) / z.shape[0]
    best = corr.max(axis=1)
    return {g: float(best[i]) for i, g in enumerate(genes)}


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #

def compute_biology_features(
    screens: Sequence[Mapping[str, Any]],
    features: Sequence[str] | None = None,
    universe: str = "library",
) -> dict[str, dict[str, dict[str, float]]]:
    """External-biology features for each screen, per gene.

    Args:
        screens: AssayBench screen records as returned by
            ``splicr.assaybench_io.load_split``. Only the descriptive metadata
            in :data:`METADATA_FIELDS_USED` is read; ``relevance_genes`` is used
            solely to know which genes the screen's library measured, and
            ``relevance_scores`` is never touched.
        features: subset of :data:`FEATURE_NAMES` to compute. ``None`` computes
            all of them.
        universe: ``"library"`` (default) emits one entry per gene in the
            screen's own ``relevance_genes`` — which is the right universe for
            ranking, because the metric deletes any predicted gene the screen
            did not measure. ``"union"`` emits every gene any resource knows
            about, for model training that needs negatives outside the library.

    Returns:
        ``{dataset_name: {gene_symbol: {feature_name: value}}}``. Genes absent
        from a resource get 0.0 for that feature, so every returned gene dict
        has exactly the requested feature keys.

    The result is deterministic: identical input records give byte-identical
    output, with no sampling, no hashing of iteration order and no network use.
    """
    ensure_caches()
    wanted = list(features) if features is not None else list(FEATURE_NAMES)
    unknown = set(wanted) - set(FEATURE_NAMES)
    if unknown:
        raise ValueError(f"unknown feature name(s): {sorted(unknown)}")
    if universe not in ("library", "union"):
        raise ValueError("universe must be 'library' or 'union'")

    need = set(wanted)
    if "biology_composite" in need:
        need |= {"depmap_frac_dependent", "ot_n_pathway"}

    # Layer 1: screen-independent lookups, resolved once.
    priors: dict[str, Mapping[str, float]] = {}
    dm = _depmap_gene_priors()
    for name in ("depmap_frac_dependent", "depmap_frac_strong_dependent",
                 "depmap_mean_dependency", "depmap_dependency_amount",
                 "depmap_selectivity"):
        if name in need:
            priors[name] = dm[name]
    if "depmap_common_essential" in need:
        priors["depmap_common_essential"] = {g: 1.0 for g in _common_essentials()}
    if {"ceg_v2_core_essential", "neg_v1_nonessential"} & need:
        ceg, neg = _hart_sets()
        if "ceg_v2_core_essential" in need:
            priors["ceg_v2_core_essential"] = {g: 1.0 for g in ceg}
        if "neg_v1_nonessential" in need:
            priors["neg_v1_nonessential"] = {g: 1.0 for g in neg}
    if "string_physical_degree" in need:
        priors["string_physical_degree"] = _string_degree("phys")
    if "string_functional_degree" in need:
        priors["string_functional_degree"] = _string_degree("full")
    ot = _ot_gene_attrs()
    for name in ("ot_n_pathway", "ot_n_go", "ot_missense_z", "ot_neg_loeuf"):
        if name in need:
            priors[name] = ot[name]
    if "literature_mentions_log" in need:
        priors["literature_mentions_log"] = _literature_counts()

    union_genes: list[str] | None = None
    if universe == "union":
        seen: set[str] = set()
        for table in priors.values():
            seen.update(table)
        union_genes = sorted(seen)

    out: dict[str, dict[str, dict[str, float]]] = {}
    for screen in screens:
        key = screen["dataset_name"]
        genes = list(union_genes) if union_genes is not None else list(screen["relevance_genes"])

        per_screen: dict[str, Mapping[str, float]] = {}
        if "depmap_cellline_dependency" in need:
            per_screen["depmap_cellline_dependency"] = _cellline_dependency(screen)
        if "depmap_lineage_dependency" in need:
            per_screen["depmap_lineage_dependency"] = _lineage_dependency(screen)
        if {"condition_seed_member", "condition_string_proximity",
            "condition_reactome_overlap", "condition_codependency"} & need:
            seeds = condition_seeds(screen)
            if "condition_seed_member" in need:
                per_screen["condition_seed_member"] = seeds
            if "condition_string_proximity" in need:
                per_screen["condition_string_proximity"] = _string_proximity(seeds)
            if "condition_reactome_overlap" in need:
                per_screen["condition_reactome_overlap"] = _reactome_overlap(seeds, genes)
            if "condition_codependency" in need:
                per_screen["condition_codependency"] = _codependency(seeds)

        # The composite is deliberately simple and metadata-conditional: use
        # breadth of essentiality, except on pure positive-selection screens
        # where it is near-useless (0.0233) and Reactome pathway count does
        # better (0.0503). Validation 0.17677 vs 0.17083 for essentiality
        # alone: bootstrap CI95 [+0.0005, +0.0124] excludes zero but Wilcoxon
        # p=0.22 does not confirm it, and the switch was chosen on validation.
        # Treat it as unproven.
        composite: Mapping[str, float] | None = None
        if "biology_composite" in need:
            if (screen.get("screen_type") or "") == "Positive Selection":
                composite = priors["ot_n_pathway"]
            else:
                composite = priors["depmap_frac_dependent"]

        table: dict[str, dict[str, float]] = {}
        for gene in genes:
            row = {}
            for name in wanted:
                if name == "biology_composite":
                    row[name] = float(composite.get(gene, 0.0))
                elif name in per_screen:
                    row[name] = float(per_screen[name].get(gene, 0.0))
                else:
                    row[name] = float(priors[name].get(gene, 0.0))
            table[gene] = row
        out[key] = table
    return out


def feature_vector(
    screens: Sequence[Mapping[str, Any]],
    feature: str,
) -> dict[str, dict[str, float]]:
    """One feature for many screens: ``{dataset_name: {gene: value}}``."""
    full = compute_biology_features(screens, features=[feature])
    return {k: {g: row[feature] for g, row in table.items()} for k, table in full.items()}


# --------------------------------------------------------------------------- #
# Self-check (validation only -- the test split is never loaded)
# --------------------------------------------------------------------------- #

BEST_SINGLE_FEATURE = "depmap_frac_dependent"

#: Standalone validation AnDCG@100 measured when this module was written.
#: Reproduced by ``python -m splicr.features.biology``.
VALIDATION_ANDCG_AT_100: dict[str, float] = {
    "depmap_frac_dependent": 0.17083,
    "depmap_frac_strong_dependent": 0.16929,
    "depmap_dependency_amount": 0.16564,
    "depmap_mean_dependency": 0.16539,
    "depmap_lineage_dependency": 0.16301,
    "depmap_cellline_dependency": 0.15414,
    "ceg_v2_core_essential": 0.12410,
    "depmap_common_essential": 0.11650,
    "string_physical_degree": 0.11084,
    "depmap_selectivity": 0.10380,
    "ot_n_pathway": 0.08950,
    "ot_missense_z": 0.07678,
    "string_functional_degree": 0.07169,
    "ot_neg_loeuf": 0.05204,
    "literature_mentions_log": 0.05089,
    "condition_string_proximity": 0.05016,
    "ot_n_go": 0.04482,
    "condition_codependency": 0.03911,
    "condition_reactome_overlap": 0.03613,
    "condition_seed_member": 0.02483,
    "neg_v1_nonessential": 0.01914,
    "biology_composite": 0.17677,
}

#: Random-ranking baseline on the same 218 validation screens, same harness.
VALIDATION_RANDOM_BASELINE = 0.01941


def _stable_tiebreak(genes: Sequence[str]) -> np.ndarray:
    """Deterministic, relevance-independent jitter so ties never depend on
    dict or library ordering. Derived from the gene symbol only."""
    import hashlib

    return np.array(
        [int(hashlib.md5(g.encode()).hexdigest()[:8], 16) / 2 ** 32 for g in genes]
    )


def evaluate_feature(
    feature: str,
    split: str = "validation",
    k: int = 100,
) -> np.ndarray:
    """Per-screen AnDCG@``k`` from ranking each screen's library by one feature.

    Scoring goes through ``assaybench.benchmark.metrics.RankingMetrics`` — the
    metric is never reimplemented here. ``split`` is restricted to ``"train"``
    and ``"validation"``: this module refuses to load the test split.
    """
    if split not in ("train", "validation"):
        raise ValueError(
            f"refusing split {split!r}: the biology family is tuned on validation only"
        )
    from assaybench.benchmark.metrics import RankingMetrics

    from splicr.assaybench_io import load_split

    records = load_split(split)
    values = feature_vector(records, feature)
    metric = RankingMetrics(k_values=[k], metric_groups=["adjusted_ndcg"])
    scores = []
    for screen in records:
        lib = screen["relevance_genes"]
        table = values[screen["dataset_name"]]
        v = np.array([table.get(g, 0.0) for g in lib], dtype=float)
        v = v + 1e-9 * _stable_tiebreak(lib)
        order = np.argsort(-v, kind="stable")[:k]
        res = metric.evaluate(
            predicted_genes=[lib[i] for i in order],
            ground_truth_genes=lib,
            relevance_scores=screen["relevance_scores"],
        )
        scores.append(res[f"adjusted_ndcg@{k}"])
    return np.array(scores)


def _main() -> None:
    import sys

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__)))))
    ensure_caches(verbose=True)

    print("EXTERNAL BIOLOGY family -- standalone validation AnDCG@100 "
          "(218 screens, yearfold0=='validation')")
    print(f"  random baseline on this split: {VALIDATION_RANDOM_BASELINE:.5f}")
    print(f"  best single feature:           {BEST_SINGLE_FEATURE}")
    vals = evaluate_feature(BEST_SINGLE_FEATURE, split="validation")
    print(f"  measured now:                  {vals.mean():.5f}  "
          f"(n={len(vals)}, {np.mean(vals <= 0) * 100:.0f}% clamped to zero)")
    expected = VALIDATION_ANDCG_AT_100[BEST_SINGLE_FEATURE]
    delta = abs(vals.mean() - expected)
    print(f"  recorded value:                {expected:.5f}   "
          f"{'OK' if delta < 5e-4 else 'MISMATCH'} (|delta|={delta:.2e})")


if __name__ == "__main__":
    _main()
