"""DepMap cell-line-matched features for AssayBench screens.

What this family knows
----------------------
A CRISPR screen is run in one cell line.  DepMap has already knocked out ~18.5k
genes in ~1.2k cell lines and published a *Chronos* gene-effect score per
(cell line, gene): 0 = no growth effect, negative = knockout hurts the line.
If we can name the screen's cell line, DepMap hands us a label-free prior over
which genes matter *in that exact biological system*, which is strictly more
information than a pan-cancer gene-frequency prior.

What it turned out to be worth
-----------------------------
Measured on the 218 AssayBench validation screens, ranking each screen's own
library by one feature, scored with ``adjusted_ndcg@100``.  Test was never
loaded.  Random is 0.0202 on this split; the frequency prior is ~0.177.

    dm_effect_lineage_p10   0.17458   <- best single feature (pre-registered)
    dm_effect_p10           0.17055
    dm_effect_lineage       0.16860
    dm_effect_global        0.16698   <- the family with cell-line matching off
    dm_effect               0.15678   <- the screen's OWN matched cell line
    dm_pan_essential        0.10888
    dm_cn_log2              0.02166   (= random; copy number carries nothing here)

Two findings, both paired-tested across the 218 screens:

1. **Matching the exact cell line is significantly harmful.**  ``dm_effect``
   loses 0.0102 to the pan-cancer mean (bootstrap CI ``[-0.0163, -0.0044]``,
   Wilcoxon ``p = 6e-3``).  Restricted to the 147 screens that *did* match a cell
   line exactly, that line's own Chronos row scores 0.0773 against 0.0948 for the
   lineage mean (``d = -0.0175``, CI ``[-0.0276, -0.0077]``, ``p = 1e-3``).  A
   single Chronos row is a noisy estimate; averaging over cell lines denoises it.
   Anything built on this family should use the aggregate, not the matched line.

2. **The left tail over cell lines beats the centre.**  ``dm_effect_p10`` gains
   0.0036 over the mean (CI ``[+0.0014, +0.0058]``, ``p = 4e-3``), and the same
   direction and magnitude holds on the 24Q4 release, so it is not a fluke of one
   Chronos build.  Narrowing that percentile to the screen's own lineage
   (``dm_effect_lineage_p10``) adds a further 0.0040 on 26Q1, but Wilcoxon puts
   that at ``p = 0.10`` and it *reverses* on 24Q4 -- treat the lineage refinement
   as unproven even though it is the best number here.

By stratum the family is one signal wearing five hats: fitness screens 0.471,
drug response 0.128, host-pathogen 0.020 (= random), and the two 4-screen strata
are noise.  Within-screen Spearman against relevance is -0.126 on fitness and
-0.044 on non-fitness for ``dm_effect_p10``; ``dm_pan_essential`` has the highest
fitness correlation of all (0.175) yet a much worse AnDCG, because a binary flag
cannot order the genes inside the essential set.

Three signals are separable and are all exposed here:

* **level** -- how essential a gene is in the matched line (``dm_neg_effect``).
  This is what a fitness / proliferation / viability screen measures.
* **selectivity** -- how *unusual* that essentiality is (``dm_selective``,
  ``dm_selectivity_score``, ``dm_effect_sd``).  A gene that kills every line is
  a housekeeping essential and shows up in every screen's hit list; a gene that
  kills only this lineage is the interesting, screen-specific dependency.
* **context** -- copy number in the matched line (``dm_cn_log2``), which flags
  both the amplified oncogene dependencies and the copy-number artefacts that
  make a gene look essential for non-biological reasons.

Fallback chain
--------------
``dm_effect`` and ``dm_dep_prob`` are resolved per screen in this order, and
``dm_effect_source`` records which rung was used:

    2.0  exact cell line  -> that model's Chronos row
    1.0  lineage          -> mean over the Chronos models of the screen's lineage
    0.0  pan-cancer       -> mean over all Chronos models

The lineage rung fires when the cell line resolves to a DepMap ``ModelID`` that
has no CRISPR data, or when the line is unknown to DepMap but its
``cell_type`` string names a lineage (see :data:`CELL_TYPE_TO_LINEAGE`, which was
derived from the **train** split only).  The pan-cancer rung is the floor, so
every gene always gets a finite value and no screen is silently dropped.

Cell-line resolution
--------------------
:class:`CellLineResolver` matches ``screen["cell_line"]`` in tiers, most
trustworthy first: DepMap's own names, then Cellosaurus ID/synonym -> RRID ->
``ModelID``, then Cellosaurus parent and child lines (so ``LNCaP`` reaches
``LNCaP clone FGC``), each retried against progressively de-engineered name
variants (``HepG2-NTCP1 HBV Cas9`` -> ``HepG2``).  The tier is reported, never
hidden: see :func:`match_report`.

Coverage, measured:

    validation (218)  cell-line rung 67.4%  lineage rung 31.2%  global rung 1.4%
    train      (1349) cell-line rung 30.9%  lineage rung 68.1%  global rung 1.0%

Train's low cell-line rung is not a matching failure -- 1116 of 1349 train screens
match a DepMap name exactly -- it is the leakage guard below deliberately pushing
697 DepMap-derived screens down to the lineage rung.  195 of 218 validation
screens resolve to a ``ModelID``; the 23 that do not are the systems DepMap has no
model for (``HEK293-A``, ``HEK293T``, ``primary melanoma cell line``,
``hTERT-RPE1``, iPSC/ESC lines), and they fall back to a lineage inferred from
``cell_type``, which reaches 215 of 218 screens.

Leakage
-------
DepMap *is* BioGRID ORCS for three publications.  ``Meyers RM (2017)`` is
Project Achilles / Avana, ``Behan FM (2019)`` is Sanger Project Score and
``Aguirre AJ (2016)`` is the Broad pilot; together they are 697 of the 1349
train screens.  For those screens the Chronos value of the matched cell line is
*a reprocessing of the screen's own raw counts* -- reading it is reading the
label.  :data:`DEPMAP_DERIVED_SOURCE_IDS` lists the PubMed ids, and the default
``on_self_measured="degrade"`` drops such a screen to the lineage rung with its
own model held out, so the feature can never echo the screen's own measurement.
This bites train only: all three papers predate 2021, and the AssayBench
temporal split puts everything before 2021 in train (verified: zero validation
screens carry these ids, and test is 2022+ by construction).

This module never loads the test split.

Usage
-----
    from splicr.features.depmap import compute, FEATURE_NAMES, match_report

    screens = load_split("validation")
    feats = compute(screens)            # {dataset_name: {gene: {name: value}}}
    print(match_report(screens))        # match rate by tier

Run ``python -m splicr.features.depmap`` for the self-check, which prints the
standalone validation AnDCG@100 of the family's best single feature.
"""

from __future__ import annotations

import contextlib
import csv
import os
import re
import sys
import warnings
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Iterable, Mapping, Sequence

import numpy as np

# --------------------------------------------------------------------------- #
# paths
# --------------------------------------------------------------------------- #

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.abspath(os.path.join(_HERE, "..", "..", ".."))

from ..config import REFERENCE_DIR

REFERENCES = os.environ.get("SPLICR_REFERENCES", str(REFERENCE_DIR))
DEPMAP_DIR = os.path.join(REFERENCES, "depmap")
CELLS_DIR = os.path.join(REFERENCES, "cells")
CACHE_DIR = os.environ.get("SPLICR_DEPMAP_CACHE", os.path.join(DEPMAP_DIR, "_cache"))

#: Chronos gene-effect releases, newest first.  ``26Q1`` is the larger matrix
#: (1208 models x 18531 genes); ``24Q4`` is the newest *complete* release and is
#: the only one that also ships copy number and ``Model.csv``.
RELEASES: dict[str, str] = {
    "26Q1": os.path.join(DEPMAP_DIR, "26Q1", "gene_effect.csv"),
    "24Q4": os.path.join(DEPMAP_DIR, "CRISPRGeneEffect.csv"),
}
DEFAULT_RELEASE = os.environ.get("SPLICR_DEPMAP_RELEASE", "26Q1")

_GENE_DEPENDENCY = os.path.join(DEPMAP_DIR, "CRISPRGeneDependency.csv")
_COMMON_ESSENTIALS = os.path.join(DEPMAP_DIR, "CRISPRInferredCommonEssentials.csv")
_MODEL_CSV = os.path.join(DEPMAP_DIR, "Model.csv")
_CN_CSV = os.path.join(DEPMAP_DIR, "OmicsCNGene.csv")
_CELLOSAURUS = os.path.join(CELLS_DIR, "cellosaurus.txt")


# --------------------------------------------------------------------------- #
# leakage boundary
# --------------------------------------------------------------------------- #

#: PubMed ids whose BioGRID ORCS / AssayBench screens *are* the DepMap CRISPR
#: screens.  For a screen with one of these ``source_id`` values, the Chronos
#: row of its own cell line is a reprocessing of its own raw data.
#:
#: Measured on train+validation: 29083409 -> 340 train screens, 30971826 -> 324,
#: 27260156 -> 33; **0 validation screens** carry any of them.  The remaining
#: ids are the other Broad/Sanger releases that feed the same matrices and are
#: listed defensively even though they contribute no AssayBench screens here.
DEPMAP_DERIVED_SOURCE_IDS: frozenset[str] = frozenset(
    {
        "29083409",  # Meyers RM 2017   -- Avana / Project Achilles
        "30971826",  # Behan FM 2019    -- Sanger Project Score
        "27260156",  # Aguirre AJ 2016  -- Broad pilot
        "28753430",  # Tsherniak A 2017 -- Defining a Cancer Dependency Map
        "31699904",  # Dempster JM 2019 -- Achilles/Score agreement
        "34469736",  # Pacini C 2021    -- integrated Broad + Sanger
        "33712601",  # Dempster JM 2021 -- Chronos
    }
)

#: Author-string patterns for the same publications, used as a belt-and-braces
#: check when ``source_id`` is missing.
_DEPMAP_AUTHOR_RE = re.compile(
    r"\b(meyers\s+rm|behan\s+fm|aguirre\s+aj|tsherniak\s+a|dempster\s+jm|pacini\s+c)\b",
    re.IGNORECASE,
)


def is_depmap_derived(screen: Mapping[str, Any]) -> bool:
    """True when this screen's own raw data feeds the DepMap Chronos matrices.

    Such a screen must not be given the Chronos value of its matched cell line:
    that value is its own label.  See :data:`DEPMAP_DERIVED_SOURCE_IDS`.
    """
    sid = str(screen.get("source_id") or "").strip()
    if sid in DEPMAP_DERIVED_SOURCE_IDS:
        return True
    return bool(_DEPMAP_AUTHOR_RE.search(str(screen.get("author") or "")))


# --------------------------------------------------------------------------- #
# features
# --------------------------------------------------------------------------- #

#: Every feature this family emits, in a fixed order.  All values are finite
#: floats; a gene DepMap never measured gets 0.0 for the effect-like features
#: and ``dm_in_depmap == 0.0``, which is the honest encoding (Chronos 0 means
#: "no growth effect").
FEATURE_NAMES: list[str] = [
    # --- level: how essential is this gene in this screen's cell line? ------
    "dm_effect",            # Chronos gene effect, fallback chain applied (neg = essential)
    "dm_neg_effect",        # -dm_effect, so larger = more essential. The headline ranker.
    "dm_dep_prob",          # P(dependency) in the matched line, fallback chain applied
    "dm_effect_source",     # 2 = cell line, 1 = lineage, 0 = pan-cancer  (per-screen constant)
    # --- reference levels ---------------------------------------------------
    "dm_effect_lineage",    # mean effect over the screen's lineage
    "dm_effect_global",     # mean effect over every Chronos model
    "dm_effect_median",     # median effect over every Chronos model (robust centre)
    "dm_effect_p10",        # 10th-percentile effect across lines: the left tail.
                            # Standalone validation winner -- see module docstring.
    "dm_effect_p25",        # 25th-percentile effect across lines
    "dm_effect_lineage_p10",  # 10th-percentile effect within the screen's lineage
    "dm_effect_min",        # most-essential value the gene reaches in any line
    "dm_effect_sd",         # sd across lines: raw variability
    "dm_effect_skew",       # skewness across lines (negative = a few lines depend on it)
    "dm_effect_shrunk",     # 0.6 * lineage mean + 0.4 * global mean (weights fit on
                            # validation; carries NO cell-line term, because every
                            # gram of cell-line weight measurably hurt)
    # --- selectivity: is the essentiality specific to this system? ----------
    "dm_selective",         # global mean - dm_effect  (>0 = more essential here than typical)
    "dm_selective_lineage",  # lineage mean - dm_effect
    "dm_effect_z",          # (dm_effect - global mean) / global sd
    "dm_pan_essential",     # 1.0 if in CRISPRInferredCommonEssentials
    "dm_frac_dependent",    # fraction of lines with dependency probability >= 0.5
    "dm_dep_prob_global",   # mean dependency probability across every line
    "dm_selectivity_score",  # dm_neg_effect * (1 - dm_frac_dependent)
    # --- genomic context ----------------------------------------------------
    "dm_cn_log2",           # log2(relative copy number + 1) in the matched line
    "dm_cn_loss",           # 1.0 when dm_cn_log2 < 0.7  (copy loss)
    "dm_cn_amp",            # 1.0 when dm_cn_log2 > 1.3  (amplification)
    # --- coverage -----------------------------------------------------------
    "dm_in_depmap",         # 1.0 when DepMap measured this gene at all
]

_FEATURE_INDEX = {n: i for i, n in enumerate(FEATURE_NAMES)}


# --------------------------------------------------------------------------- #
# cell-line resolution
# --------------------------------------------------------------------------- #

#: ``cell_type`` -> ``OncotreeLineage``, derived from the **train** split only:
#: for each ``cell_type`` string, the modal lineage of the train screens whose
#: cell line matched a DepMap model (kept when the mode held >=60% of the
#: tally).  Two train-derived entries that were biologically wrong were
#: corrected by hand (``Lymphoma Cell Line`` and ``B-lymphoblastoid cell line``
#: both resolved to ``Myeloid``); the extra entries at the bottom cover
#: non-cancer systems that never match a DepMap model and so could not appear
#: in a train tally.  No validation or test screen was consulted.
CELL_TYPE_TO_LINEAGE: dict[str, str] = {
    "Acute Myeloid Leukemia Cell Line": "Myeloid",
    "Adrenal Gland Neuroblastoma": "Peripheral Nervous System",
    "Anaplastic Large Cell Lymphoma Cell Line": "Lymphoid",
    "Anaplastic Thyroid Cancer Cell Line": "Thyroid",
    "Askin Tumor": "Bone",
    "Astrocytoma Cell Line": "CNS/Brain",
    "B-cell non-Hodgkin lymphoma cell line": "Lymphoid",
    "B-lymphoblastoid cell line": "Lymphoid",          # hand-corrected
    "B-lymphoma cell line": "Lymphoid",
    "Bladder Carcinoma": "Bladder/Urinary Tract",
    "Bladder Transitional Cell Carcinoma Cell Line": "Bladder/Urinary Tract",
    "Breast Adenocarcinoma Cell Line": "Breast",
    "Breast Cancer Cell Line": "Breast",
    "Burkitt Lymphoma Cell Line": "Lymphoid",
    "Cecum Cancer Cell Line": "Bowel",
    "Cervical Adenocarcinoma Cell Line": "Cervix",
    "Cholangiocarcinoma Cell": "Biliary Tract",
    "Chondrosarcoma": "Bone",
    "Chronic Myelogenous Leukemia Cell Line": "Myeloid",
    "Chronic Myeloid Leukemia Cell Line": "Myeloid",
    "Colonic Adenocarcinoma Cell Line": "Bowel",
    "Colonic Cancer Cell Line": "Bowel",
    "Colorectal Adenocarcinoma Cell Line": "Bowel",
    "Colorectal Cancer Cell Line": "Bowel",
    "Diffuse Large B-cell Lymphoma Cell": "Lymphoid",
    "Endometrial Cancer Cell Line": "Uterus",
    "Eosinophilic Leukemia Cell Line": "Myeloid",
    "Erythroleukemia Cell Line": "Myeloid",
    "Esophageal Cancer Cell Line": "Esophagus/Stomach",
    "Esophageal Squamous Cell Carcinoma Cell Line": "Esophagus/Stomach",
    "Ewing's Sarcoma Cell Line": "Bone",
    "Fibrosarcoma Cell Line": "Soft Tissue",
    "Gastric Adenocarcinoma Cell Line": "Esophagus/Stomach",
    "Gastric Cancer Cell Line": "Esophagus/Stomach",
    "Gingival Cancer Cell Line": "Head and Neck",
    "Glioblastoma Cell Line": "CNS/Brain",
    "Glioma Cell Line": "CNS/Brain",
    "Gliosarcoma": "CNS/Brain",
    "Head and Neck Squamous Cell Carcinoma Cell Line": "Head and Neck",
    "Hepatoblastoma Cell Line": "Liver",
    "Hepatocellular Carcinoma": "Liver",
    "Hepatoma Cell Line": "Liver",
    "Hypopharyngeal Squamous Cell Carcinoma Cell Line": "Head and Neck",
    "Large Cell Lung Cancer Cell Line": "Lung",
    "Lung Adenocarcinoma Cell Line": "Lung",
    "Lung Cancer Cell Line": "Lung",
    "Lung Squamous Cell Carcinoma Cell Line": "Lung",
    "Lymphoblastoid Cell Line": "Lymphoid",
    "Lymphoma Cell Line": "Lymphoid",                   # hand-corrected
    "MDA-MB-435 cell": "Skin",
    "Mammary Epithelial Cell Line": "Breast",
    "Mammary Gland Tumor Cell Line": "Breast",
    "Medulloblastoma Cell Line": "CNS/Brain",
    "Melanoma Cell Line": "Skin",
    "Meningioma Cell Line": "CNS/Brain",
    "Monocytic Leukemia Cell Line": "Myeloid",
    "Multiple Myeloma Cell Line": "Lymphoid",
    "Neuroblastoma Cell Line": "Peripheral Nervous System",
    "Neuroepithelioma Cell Line": "Bone",
    "Non-Small Cell Lung Adenocarcinoma Cell Line": "Lung",
    "Non-Small Cell Lung Cancer Cell Line": "Lung",
    "Oral Squamous Cell Carcinoma Cell Line": "Head and Neck",
    "Osteosarcoma Cell Line": "Bone",
    "Ovarian Cancer Cell Line": "Ovary/Fallopian Tube",
    "Ovary Adenocarcinoma Cell Line": "Ovary/Fallopian Tube",
    "Pancreatic Adenocarcinoma Cell Line": "Pancreas",
    "Pancreatic Cancer Cell Line": "Pancreas",
    "Pancreatic Ductal Adenocarcinoma Cell Line": "Pancreas",
    "Pre-B Acute Lymphoblastic Leukemia Cell Line": "Lymphoid",
    "Primary Effusion Lymphoma Cell Line": "Lymphoid",
    "Prostate Cancer Cell Line": "Prostate",
    "Renal Cancer Cell Line": "Kidney",
    "Renal Cell Carcinoma Cell Line": "Kidney",
    "Salivary Gland Cancer Cell": "Head and Neck",
    "T-lymphoblastic leukemia cell line": "Lymphoid",
    "T-lymphoma cell line": "Lymphoid",
    "Tongue Cancer Cell Line": "Head and Neck",
    "Urinary Bladder Cancer Cell Line": "Bladder/Urinary Tract",
    "Urinary Bladder Squamous Cell Carcinoma Cell Line": "Bladder/Urinary Tract",
    "Uterine Adenocarcinoma Cell Line": "Uterus",
    "Uterine Carcinosarcoma Cell Line": "Uterus",
    # non-cancer systems: DepMap has no model, so they can never appear above
    "Retinal Pigment Epithelium Cell Line": "Eye",
    "Embryonic Kidney Cell Line": "Kidney",
    "Fibroblast": "Fibroblast",
    "Foreskin Fibroblast": "Fibroblast",
    "Embryonic Stem Cell Line": "Embryonal",
    "Induced Pluripotent Stem Cell Line": "Embryonal",
}

#: Engineering / provenance suffixes stripped from a cell-line string before
#: retrying the match.  ``HepG2-NTCP1 HBV Cas9`` -> ``HepG2``.
_ENGINEERING_SUFFIXES = (
    r"CAS9", r"DCAS9", r"NCAS9", r"CAS12A", r"CAS13", r"SPCAS9", r"ZIMCAS9",
    r"CRISPRI", r"CRISPRA", r"SGRNA", r"SHRNA", r"PURO", r"BLAST",
    r"GFP", r"EGFP", r"MCHERRY", r"RFP", r"YFP", r"BFP", r"LUC", r"LUCIFERASE",
    r"TETON", r"TETOFF", r"DOX", r"RTTA", r"NTCP\d*", r"HBV", r"ACE2",
    r"ATCC", r"DSMZ", r"ECACC", r"JCRB", r"RIKEN",
    r"PARENTAL", r"WT", r"CLONE\d*", r"CLONES?", r"SUBCLONE\d*",
    r"HUMAN", r"CELLS?", r"CELLLINE", r"EMPTY", r"CTRL", r"CONTROL", r"NULL", r"KO",
)
_ENGINEERING_RE = tuple(re.compile(s + r"$") for s in _ENGINEERING_SUFFIXES)


def _nz(s: Any) -> str:
    """Normalize a cell-line name to letters+digits, upper case."""
    return re.sub(r"[^A-Z0-9]", "", str(s or "").upper())


def _name_variants(cell_line: str) -> list[str]:
    """De-engineered variants of one cell-line string, most literal first."""
    base = _nz(cell_line)
    out = [base]
    cur = base
    for _ in range(4):
        cut = None
        for rx in _ENGINEERING_RE:
            m = rx.search(cur)
            if m and m.start() > 2:      # never strip the whole name
                cut = m.start()
                break
        if cut is None:
            break
        cur = cur[:cut]
        out.append(cur)
    toks = [t for t in re.split(r"[\s\-_/.,;]+", str(cell_line or "").strip()) if t]
    for i in range(len(toks) - 1, 0, -1):
        out.append(_nz("".join(toks[:i])))
        out.append(_nz(" ".join(toks[:i])))
    return [v for v in dict.fromkeys(out) if len(v) >= 2]


@dataclass(frozen=True)
class CellLineMatch:
    """How one screen's cell line resolved onto DepMap.

    Attributes:
        cell_line: the raw ``screen["cell_line"]`` string.
        model_id: DepMap ``ModelID``, or ``None``.
        tier: ``"depmap_name"``, ``"cellosaurus"``, ``"cellosaurus_parent"``,
            ``"cellosaurus_child"``, each optionally ``"_variant"`` when a
            de-engineered name was needed, or ``"unmatched"``.
        lineage: ``OncotreeLineage`` of ``model_id``, else the lineage inferred
            from ``cell_type`` via :data:`CELL_TYPE_TO_LINEAGE`, else ``""``.
        lineage_source: ``"model"``, ``"cell_type"`` or ``""``.
        has_crispr: ``model_id`` has a row in the chosen Chronos release.
        depmap_derived: this screen's own data feeds DepMap (see
            :func:`is_depmap_derived`).
        source: rung actually used -- ``"cell_line"``, ``"lineage"`` or
            ``"global"``.  This is what ``dm_effect_source`` encodes.
    """

    cell_line: str
    model_id: str | None
    tier: str
    lineage: str
    lineage_source: str
    has_crispr: bool
    depmap_derived: bool
    source: str


class CellLineResolver:
    """Resolve free-text cell-line names onto DepMap ``ModelID``s.

    Built from ``Model.csv`` (DepMap's own names plus the ``RRID`` Cellosaurus
    accession) and the full Cellosaurus flat file (human entries only, with
    synonyms and the parent/child hierarchy).  Construction parses a 122 MB text
    file, so build one and reuse it; :func:`resolver` memoises a shared instance.
    """

    def __init__(
        self,
        model_csv: str = _MODEL_CSV,
        cellosaurus: str = _CELLOSAURUS,
    ) -> None:
        self.lineage: dict[str, str] = {}
        self.subtype: dict[str, str] = {}
        self.disease: dict[str, str] = {}
        self._name2model: dict[str, str] = {}
        self._cvcl2model: dict[str, str] = {}

        with open(model_csv, newline="") as fh:
            for row in csv.DictReader(fh):
                mid = row["ModelID"]
                self.lineage[mid] = row.get("OncotreeLineage") or ""
                self.subtype[mid] = row.get("OncotreeSubtype") or ""
                self.disease[mid] = row.get("OncotreePrimaryDisease") or ""
                rrid = (row.get("RRID") or "").strip()
                if rrid.startswith("CVCL_"):
                    self._cvcl2model.setdefault(rrid, mid)
                for key in (
                    row.get("StrippedCellLineName"),
                    row.get("CellLineName"),
                    (row.get("CCLEName") or "").split("_")[0],
                ):
                    k = _nz(key)
                    if k:
                        self._name2model.setdefault(k, mid)

        self._name2cvcl: dict[str, tuple[str, ...]] = {}
        self._parents: dict[str, tuple[str, ...]] = {}
        self._children: dict[str, list[str]] = {}
        self._secondary: dict[str, str] = {}
        self._load_cellosaurus(cellosaurus)
        self._cache: dict[tuple[str, str], CellLineMatch] = {}

    def _load_cellosaurus(self, path: str) -> None:
        name2cvcl: dict[str, list[str]] = {}
        acc = ident = None
        syns: list[str] = []
        taxa: list[str] = []
        hier: list[str] = []
        secs: list[str] = []

        def flush() -> None:
            if not acc:
                return
            for s in secs:
                self._secondary[s] = acc
            if "9606" not in taxa:      # human entries only
                return
            if hier:
                self._parents[acc] = tuple(hier)
                for p in hier:
                    self._children.setdefault(p, []).append(acc)
            for nm in [ident, *syns]:
                k = _nz(nm)
                if k:
                    bucket = name2cvcl.setdefault(k, [])
                    if acc not in bucket:
                        bucket.append(acc)

        with open(path, errors="ignore") as fh:
            for line in fh:
                tag, val = line[:2], line[5:].strip()
                if tag == "ID":
                    flush()
                    acc, ident, syns, taxa, hier, secs = None, val, [], [], [], []
                elif ident is None:
                    continue
                elif tag == "AC":
                    acc = val
                elif tag == "AS":
                    secs = [x.strip() for x in val.split(";") if x.strip()]
                elif tag == "SY":
                    syns = [x.strip() for x in val.split(";") if x.strip()]
                elif tag == "OX":
                    m = re.search(r"NCBI_TaxID=(\d+)", val)
                    if m:
                        taxa.append(m.group(1))
                elif tag == "HI":
                    m = re.match(r"(CVCL_\w+)", val)
                    if m:
                        hier.append(m.group(1))
                elif line.startswith("//"):
                    flush()
                    acc, ident, syns, taxa, hier, secs = None, None, [], [], [], []
        flush()
        self._name2cvcl = {k: tuple(v) for k, v in name2cvcl.items()}

    # -- lookup ------------------------------------------------------------ #

    def _cvcl_model(self, cvcl: str) -> str | None:
        return self._cvcl2model.get(self._secondary.get(cvcl, cvcl))

    def _walk(self, start: Sequence[str], edges: Mapping[str, Sequence[str]]) -> str | None:
        """Breadth-first hierarchy walk to the nearest DepMap model. Deterministic."""
        seen: set[str] = set()
        frontier = [self._secondary.get(c, c) for c in start]
        for _ in range(3):
            nxt: list[str] = []
            for cvcl in frontier:
                if cvcl in seen:
                    continue
                seen.add(cvcl)
                for step in edges.get(cvcl, ()):  # type: ignore[arg-type]
                    step = self._secondary.get(step, step)
                    mid = self._cvcl2model.get(step)
                    if mid is not None:
                        return mid
                    nxt.append(step)
            if not nxt:
                return None
            frontier = nxt
        return None

    def resolve(self, cell_line: Any, cell_type: Any = None) -> tuple[str | None, str]:
        """``(ModelID or None, tier)`` for one cell-line string."""
        for i, nm in enumerate(_name_variants(str(cell_line or ""))):
            suffix = "" if i == 0 else "_variant"
            mid = self._name2model.get(nm)
            if mid is not None:
                return mid, "depmap_name" + suffix
            cvcls = self._name2cvcl.get(nm, ())
            for cvcl in cvcls:
                mid = self._cvcl_model(cvcl)
                if mid is not None:
                    return mid, "cellosaurus" + suffix
            if cvcls:
                mid = self._walk(cvcls, self._parents)
                if mid is not None:
                    return mid, "cellosaurus_parent" + suffix
                mid = self._walk(cvcls, self._children)
                if mid is not None:
                    return mid, "cellosaurus_child" + suffix
        return None, "unmatched"

    def match(
        self,
        screen: Mapping[str, Any],
        crispr_models: Iterable[str] | None = None,
    ) -> CellLineMatch:
        """Full :class:`CellLineMatch` for one AssayBench screen record."""
        cl = str(screen.get("cell_line") or "")
        ct = str(screen.get("cell_type") or "")
        derived = is_depmap_derived(screen)
        key = (cl, ct)
        cached = self._cache.get(key)
        if cached is None:
            mid, tier = self.resolve(cl, ct)
            lineage = self.lineage.get(mid or "", "") or ""
            lineage_source = "model" if lineage else ""
            if not lineage:
                lineage = CELL_TYPE_TO_LINEAGE.get(ct.strip(), "")
                lineage_source = "cell_type" if lineage else ""
            cached = CellLineMatch(cl, mid, tier, lineage, lineage_source,
                                   False, False, "")
            self._cache[key] = cached
        models = set(crispr_models or ())
        has = cached.model_id is not None and cached.model_id in models
        if derived:
            source = "lineage" if cached.lineage else "global"
        elif has:
            source = "cell_line"
        elif cached.lineage:
            source = "lineage"
        else:
            source = "global"
        return CellLineMatch(cached.cell_line, cached.model_id, cached.tier,
                             cached.lineage, cached.lineage_source, has,
                             derived, source)


@lru_cache(maxsize=1)
def resolver() -> CellLineResolver:
    """Shared :class:`CellLineResolver`.  First call parses Cellosaurus (~20 s)."""
    return CellLineResolver()


# --------------------------------------------------------------------------- #
# DepMap matrices
# --------------------------------------------------------------------------- #

def _parse_gene_header(header: str) -> list[str]:
    """``"A1BG (1)"`` -> ``"A1BG"`` for every column after the index column."""
    return [c.split(" (")[0].strip().strip('"') for c in header.rstrip("\n").split(",")[1:]]


def _read_matrix(path: str, keep_rows: set[str] | None = None) -> tuple[list[str], list[str], np.ndarray]:
    """Stream a DepMap wide CSV into ``(row_ids, gene_symbols, float32 matrix)``.

    NaNs are preserved.  Done by hand rather than with pandas because
    ``OmicsCNGene.csv`` is 1.4 GB and pandas peaks at several times that.
    """
    with open(path) as fh:
        genes = _parse_gene_header(fh.readline())
        width = len(genes)
        rows: list[str] = []
        blocks: list[np.ndarray] = []
        buf: list[float] = []
        for line in fh:
            if not line.strip():
                continue
            idx = line.index(",")
            rid = line[:idx]
            if keep_rows is not None and rid not in keep_rows:
                continue
            vals = line[idx + 1:].rstrip("\n").split(",")
            if len(vals) != width:
                raise ValueError(f"{path}: row {rid} has {len(vals)} values, expected {width}")
            rows.append(rid)
            buf.extend(float(v) if v else np.nan for v in vals)
            if len(buf) >= width * 256:
                blocks.append(np.asarray(buf, dtype=np.float32).reshape(-1, width))
                buf = []
    if buf:
        blocks.append(np.asarray(buf, dtype=np.float32).reshape(-1, width))
    mat = (np.concatenate(blocks, axis=0) if blocks
           else np.zeros((0, width), dtype=np.float32))
    return rows, genes, mat


@contextlib.contextmanager
def _quiet_nan():
    """Silence the all-NaN / empty-slice warnings that NaN-aware reductions raise.

    DepMap matrices are legitimately sparse -- a gene a library never targeted is
    NaN in every row -- and every such reduction is followed by an explicit
    ``nan_to_num``, so the warnings are noise rather than signal.
    """
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", r"(Mean|All-NaN|Degrees).*", RuntimeWarning)
        warnings.filterwarnings("ignore", r"invalid value encountered", RuntimeWarning)
        with np.errstate(invalid="ignore", divide="ignore"):
            yield


def _cache_path(name: str) -> str:
    return os.path.join(CACHE_DIR, name + ".npz")


def _load_cached(name: str, build, *, verbose: bool = False):
    """Memoise ``build()`` -- ``(rows, cols, matrix)`` -- as a compressed npz."""
    path = _cache_path(name)
    if os.path.exists(path):
        with np.load(path, allow_pickle=False) as z:
            return list(z["rows"]), list(z["cols"]), z["mat"]
    if verbose:
        print(f"  building DepMap cache {name} (one-off)...", file=sys.stderr, flush=True)
    rows, cols, mat = build()
    os.makedirs(CACHE_DIR, exist_ok=True)
    # np.savez appends ".npz" when the name lacks it, so the temp name carries it.
    tmp = f"{path[:-4]}.{os.getpid()}.tmp.npz"
    np.savez(tmp, rows=np.asarray(rows), cols=np.asarray(cols), mat=mat)
    os.replace(tmp, path)
    return rows, cols, mat


@dataclass
class _GeneStats:
    """Pan-cancer per-gene statistics over the Chronos matrix. Label-free.

    ``p10`` is the 10th percentile of a gene's effect across cell lines -- "how
    essential does this gene get in the lines that do depend on it".  It is the
    best standalone ranker in this family on validation, which is the whole
    story of the family: the useful signal is a *left tail over cell lines*,
    not the value in the screen's own cell line.
    """

    mean: np.ndarray
    median: np.ndarray
    p10: np.ndarray
    p25: np.ndarray
    sd: np.ndarray
    minimum: np.ndarray
    skew: np.ndarray
    frac_dependent: np.ndarray
    dep_prob_mean: np.ndarray
    pan_essential: np.ndarray


class DepMapResource:
    """Loaded DepMap matrices plus the derived per-gene statistics.

    One instance holds the Chronos gene-effect matrix, the dependency-probability
    matrix, the copy-number matrix, the common-essential set and every pan-cancer
    per-gene statistic.  Everything is keyed by *normalized* gene symbol so it
    joins against AssayBench libraries without further mapping.

    Args:
        release: key of :data:`RELEASES`.
        normalize: symbol normalizer applied to DepMap's own column names, so the
            join matches whatever the metric will do.  Defaults to the
            AssayBench ``GeneMapper`` when importable, else ``str.upper``.
        with_copy_number: load ``OmicsCNGene.csv`` (1.4 GB on first build).
        with_dependency: load ``CRISPRGeneDependency.csv``.
        verbose: log cache builds to stderr.
    """

    def __init__(
        self,
        release: str = DEFAULT_RELEASE,
        normalize=None,
        with_copy_number: bool = True,
        with_dependency: bool = True,
        verbose: bool = False,
    ) -> None:
        if release not in RELEASES:
            raise ValueError(f"unknown release {release!r}; choose from {sorted(RELEASES)}")
        self.release = release
        self.verbose = verbose
        self._normalize = normalize or _default_normalizer()

        rows, cols, mat = _load_cached(
            f"chronos_{release}",
            lambda: _read_matrix(RELEASES[release]),
            verbose=verbose,
        )
        self.models: list[str] = rows
        self._model_pos = {m: i for i, m in enumerate(rows)}
        self.genes, self._gene_pos, self.effect = self._collapse(cols, mat)

        self.lineage_of = resolver().lineage
        self._lineage_rows: dict[str, np.ndarray] = {}
        for i, m in enumerate(self.models):
            ln = self.lineage_of.get(m) or ""
            if ln:
                self._lineage_rows.setdefault(ln, []).append(i)  # type: ignore[arg-type]
        self._lineage_rows = {k: np.asarray(v, dtype=np.int32)
                              for k, v in self._lineage_rows.items()}

        self.dependency: np.ndarray | None = None
        self._dep_model_pos: dict[str, int] = {}
        if with_dependency and os.path.exists(_GENE_DEPENDENCY):
            drows, dcols, dmat = _load_cached(
                "dependency_24Q4",
                lambda: _read_matrix(_GENE_DEPENDENCY),
                verbose=verbose,
            )
            self._dep_model_pos = {m: i for i, m in enumerate(drows)}
            self.dependency = self._align_columns(dcols, dmat)

        self.copy_number: np.ndarray | None = None
        self._cn_model_pos: dict[str, int] = {}
        if with_copy_number and os.path.exists(_CN_CSV):
            crows, ccols, cmat = _load_cached(
                "cn_24Q4",
                lambda: _read_matrix(_CN_CSV),
                verbose=verbose,
            )
            self._cn_model_pos = {m: i for i, m in enumerate(crows)}
            self.copy_number = self._align_columns(ccols, cmat)

        self.stats = self._gene_stats()
        self._lineage_pct: dict[tuple[str, float], np.ndarray] = {}

    # -- construction helpers --------------------------------------------- #

    def _collapse(
        self, cols: Sequence[str], mat: np.ndarray
    ) -> tuple[list[str], dict[str, int], np.ndarray]:
        """Normalize column symbols and average any that collide."""
        buckets: dict[str, list[int]] = {}
        for j, c in enumerate(cols):
            buckets.setdefault(self._normalize(c), []).append(j)
        genes = sorted(buckets)
        out = np.empty((mat.shape[0], len(genes)), dtype=np.float32)
        for k, g in enumerate(genes):
            idx = buckets[g]
            out[:, k] = mat[:, idx[0]] if len(idx) == 1 else np.nanmean(mat[:, idx], axis=1)
        return genes, {g: i for i, g in enumerate(genes)}, out

    def _align_columns(self, cols: Sequence[str], mat: np.ndarray) -> np.ndarray:
        """Reindex a secondary matrix onto :attr:`genes`; missing genes -> NaN."""
        out = np.full((mat.shape[0], len(self.genes)), np.nan, dtype=np.float32)
        buckets: dict[str, list[int]] = {}
        for j, c in enumerate(cols):
            g = self._normalize(c)
            if g in self._gene_pos:
                buckets.setdefault(g, []).append(j)
        for g, idx in buckets.items():
            k = self._gene_pos[g]
            out[:, k] = mat[:, idx[0]] if len(idx) == 1 else np.nanmean(mat[:, idx], axis=1)
        return out

    def _gene_stats(self) -> _GeneStats:
        A = self.effect
        with _quiet_nan():
            mean = np.nanmean(A, axis=0)
            median = np.nanmedian(A, axis=0)
            p10, p25 = np.nanpercentile(A, [10, 25], axis=0)
            sd = np.nanstd(A, axis=0)
            minimum = np.nanmin(A, axis=0)
            centred = A - mean
            m2 = np.nanmean(centred ** 2, axis=0)
            m3 = np.nanmean(centred ** 3, axis=0)
            skew = np.where(m2 > 1e-12, m3 / np.maximum(m2, 1e-12) ** 1.5, 0.0)
        mean = np.nan_to_num(mean, nan=0.0)
        median = np.nan_to_num(median, nan=0.0)
        p10 = np.nan_to_num(p10, nan=0.0)
        p25 = np.nan_to_num(p25, nan=0.0)
        sd = np.nan_to_num(sd, nan=0.0)
        minimum = np.nan_to_num(minimum, nan=0.0)
        skew = np.nan_to_num(skew, nan=0.0)

        if self.dependency is not None:
            with _quiet_nan():
                frac = np.nanmean((self.dependency >= 0.5).astype(np.float32), axis=0)
                dep_mean = np.nanmean(self.dependency, axis=0)
            frac = np.nan_to_num(frac, nan=0.0)
            dep_mean = np.nan_to_num(dep_mean, nan=0.0)
        else:
            # no dependency matrix: fall back to the Chronos -0.5 convention
            with _quiet_nan():
                frac = np.nan_to_num(
                    np.nanmean((A <= -0.5).astype(np.float32), axis=0), nan=0.0
                )
            dep_mean = frac

        ess = np.zeros(len(self.genes), dtype=np.float32)
        for g in self.common_essentials():
            k = self._gene_pos.get(g)
            if k is not None:
                ess[k] = 1.0
        return _GeneStats(
            mean=mean.astype(np.float32),
            median=median.astype(np.float32),
            p10=p10.astype(np.float32),
            p25=p25.astype(np.float32),
            sd=sd.astype(np.float32),
            minimum=minimum.astype(np.float32),
            skew=skew.astype(np.float32),
            frac_dependent=frac.astype(np.float32),
            dep_prob_mean=dep_mean.astype(np.float32),
            pan_essential=ess,
        )

    @lru_cache(maxsize=1)
    def common_essentials(self) -> frozenset[str]:  # type: ignore[misc]
        """Normalized symbols from ``CRISPRInferredCommonEssentials.csv``."""
        if not os.path.exists(_COMMON_ESSENTIALS):
            return frozenset()
        out = set()
        with open(_COMMON_ESSENTIALS) as fh:
            next(fh, None)
            for line in fh:
                sym = line.strip().strip('"').split(" (")[0].strip()
                if sym:
                    out.add(self._normalize(sym))
        return frozenset(out)

    # -- row accessors ----------------------------------------------------- #

    def _mean_rows(self, mat: np.ndarray, idx: np.ndarray) -> np.ndarray:
        if idx.size == 0:
            return np.full(mat.shape[1], np.nan, dtype=np.float32)
        with _quiet_nan():
            return np.nanmean(mat[idx], axis=0)

    def lineage_profile(self, lineage: str, exclude: str | None = None) -> np.ndarray:
        """Mean Chronos effect over a lineage, optionally holding one model out."""
        idx = self._lineage_rows.get(lineage)
        if idx is None:
            return np.full(len(self.genes), np.nan, dtype=np.float32)
        if exclude is not None:
            drop = self._model_pos.get(exclude)
            if drop is not None:
                idx = idx[idx != drop]
        return self._mean_rows(self.effect, idx)

    #: A lineage needs at least this many Chronos models before its own
    #: percentile is trusted; below it, the pan-cancer percentile is used.
    MIN_LINEAGE_MODELS = 5

    def lineage_percentile(self, lineage: str, q: float = 10.0) -> np.ndarray:
        """``q``-th percentile Chronos effect within a lineage.

        This is the family's strongest signal: ranking a screen's library by the
        10th percentile of its own lineage beats the pan-cancer mean by
        +0.0076 AnDCG@100 on validation (bootstrap CI ``[+0.0037, +0.0117]``,
        Wilcoxon ``p = 3e-4``).  Falls back to the pan-cancer percentile when the
        lineage is unknown or has fewer than :attr:`MIN_LINEAGE_MODELS` models.

        Memoised per ``(lineage, q)``; the percentile over a 40 x 18.5k slab is
        not cheap enough to redo per screen.
        """
        key = (lineage, float(q))
        hit = self._lineage_pct.get(key)
        if hit is not None:
            return hit
        idx = self._lineage_rows.get(lineage)
        if idx is None or idx.size < self.MIN_LINEAGE_MODELS:
            out = self.stats.p10 if abs(q - 10.0) < 1e-9 else self._global_percentile(q)
        else:
            with _quiet_nan():
                out = np.nanpercentile(self.effect[idx], q, axis=0)
            out = np.nan_to_num(out, nan=0.0).astype(np.float32)
        self._lineage_pct[key] = out
        return out

    def _global_percentile(self, q: float) -> np.ndarray:
        with _quiet_nan():
            out = np.nanpercentile(self.effect, q, axis=0)
        return np.nan_to_num(out, nan=0.0).astype(np.float32)

    def effect_row(self, match: CellLineMatch) -> np.ndarray:
        """Chronos effect vector for a screen, following the fallback chain."""
        if match.source == "cell_line" and match.model_id in self._model_pos:
            return self.effect[self._model_pos[match.model_id]]
        if match.source == "lineage":
            row = self.lineage_profile(
                match.lineage,
                exclude=match.model_id if match.depmap_derived else None,
            )
            if not np.all(np.isnan(row)):
                return row
        return self.stats.mean

    def dependency_row(self, match: CellLineMatch) -> np.ndarray:
        """Dependency-probability vector, same fallback chain; NaN when absent."""
        if self.dependency is None:
            return np.full(len(self.genes), np.nan, dtype=np.float32)
        if match.source == "cell_line":
            i = self._dep_model_pos.get(match.model_id or "")
            if i is not None:
                return self.dependency[i]
        idx = [self._dep_model_pos[m] for m in self.models
               if (self.lineage_of.get(m) or "") == match.lineage
               and m in self._dep_model_pos
               and not (match.depmap_derived and m == match.model_id)]
        if match.lineage and idx:
            return self._mean_rows(self.dependency, np.asarray(idx, dtype=np.int32))
        with _quiet_nan():
            return np.nanmean(self.dependency, axis=0)

    def copy_number_row(self, match: CellLineMatch) -> np.ndarray:
        """Copy-number vector for the matched line; NaN when the line is unknown."""
        if self.copy_number is None:
            return np.full(len(self.genes), np.nan, dtype=np.float32)
        i = self._cn_model_pos.get(match.model_id or "")
        if i is not None and not match.depmap_derived:
            return self.copy_number[i]
        idx = [self._cn_model_pos[m] for m in self.models
               if (self.lineage_of.get(m) or "") == match.lineage
               and m in self._cn_model_pos]
        if match.lineage and idx:
            return self._mean_rows(self.copy_number, np.asarray(idx, dtype=np.int32))
        return np.full(len(self.genes), np.nan, dtype=np.float32)


def _default_normalizer():
    """AssayBench's ``GeneMapper``-backed normalizer, or plain upper-casing.

    Using the same normalizer the metric uses keeps the DepMap join consistent
    with how predictions will be scored.
    """
    try:
        from splicr.benchmark import AnDCG

        scorer = AnDCG(k=100)
        return scorer.normalize
    except Exception:  # pragma: no cover - assaybench not installed
        return lambda s: str(s).strip().upper()


@lru_cache(maxsize=4)
def resource(
    release: str = DEFAULT_RELEASE,
    with_copy_number: bool = True,
    with_dependency: bool = True,
) -> DepMapResource:
    """Shared :class:`DepMapResource` per configuration."""
    return DepMapResource(
        release=release,
        with_copy_number=with_copy_number,
        with_dependency=with_dependency,
        verbose=True,
    )


# --------------------------------------------------------------------------- #
# the public feature function
# --------------------------------------------------------------------------- #

@dataclass
class ScreenMatrix:
    """One screen's features as a dense array -- the efficient shape.

    Attributes:
        dataset_name: the screen's AssayBench ``dataset_name``.
        match: how its cell line resolved onto DepMap.
        genes: sorted, deduplicated, metric-normalized symbols -- exactly the
            screen's own measured library, so any ranking taken from ``values``
            is library-restricted by construction.
        values: ``(len(genes), len(feature_names))`` float32, all finite.
        feature_names: the columns of ``values``.
    """

    dataset_name: str
    match: CellLineMatch
    genes: list[str]
    values: np.ndarray
    feature_names: list[str]

    def column(self, name: str) -> np.ndarray:
        """One feature as a vector aligned to :attr:`genes`."""
        return self.values[:, self.feature_names.index(name)]

    def as_dict(self) -> dict[str, dict[str, float]]:
        """``{gene: {feature: value}}`` -- the shape :func:`compute` returns."""
        names = self.feature_names
        return {
            g: dict(zip(names, (float(v) for v in row)))
            for g, row in zip(self.genes, self.values)
        }


@dataclass
class ScreenFeatures:
    """Per-screen result of :func:`compute`."""

    dataset_name: str
    match: CellLineMatch
    features: dict[str, dict[str, float]] = field(default_factory=dict)


def compute(
    screens: Sequence[Mapping[str, Any]],
    *,
    release: str = DEFAULT_RELEASE,
    on_self_measured: str = "degrade",
    with_copy_number: bool = True,
    with_dependency: bool = True,
    feature_names: Sequence[str] | None = None,
) -> dict[str, dict[str, dict[str, float]]]:
    """DepMap features for every gene each screen actually measured.

    Args:
        screens: AssayBench records as :func:`splicr.assaybench_io.load_split`
            returns them.  Only ``cell_line``, ``cell_type``, ``source_id``,
            ``author``, ``dataset_name`` and ``relevance_genes`` are read --
            never ``relevance_scores`` or ``hit``.
        release: Chronos release key, see :data:`RELEASES`.
        on_self_measured: what to do for a screen whose own data feeds DepMap
            (:func:`is_depmap_derived`).  ``"degrade"`` (default) drops it to the
            lineage rung with its own model held out, so the feature cannot echo
            the screen's own measurement; ``"flag"`` computes the features
            normally and leaves it to the caller to honour
            :attr:`CellLineMatch.depmap_derived`; ``"drop"`` omits the screen
            from the result entirely.
        with_copy_number: include the ``dm_cn_*`` features.
        with_dependency: include ``dm_dep_prob`` from the dependency matrix.
        feature_names: restrict the output to these features, in this order.

    Returns:
        ``{dataset_name: {gene_symbol: {feature_name: value}}}``.  Gene symbols
        are normalized exactly as the metric normalizes them, and the gene set
        per screen is the screen's own measured library -- so a ranking built
        from these features is library-restricted by construction, which the
        ``condensed`` AnDCG evaluation rewards.  Values are always finite
        Python floats.

    Note:
        This shape costs roughly 500 000 dict entries for one 18 500-gene
        fitness library.  For bulk work -- anything over a few dozen screens --
        use :func:`iter_feature_matrices`, which returns the same numbers as a
        dense array and is the path :func:`compute` itself is built on.

    Raises:
        ValueError: unknown ``release``, ``on_self_measured`` or feature name.
    """
    out: dict[str, dict[str, dict[str, float]]] = {}
    for sm in iter_feature_matrices(
        screens,
        release=release,
        on_self_measured=on_self_measured,
        with_copy_number=with_copy_number,
        with_dependency=with_dependency,
        feature_names=feature_names,
    ):
        out[sm.dataset_name] = sm.as_dict()
    return out


def iter_feature_matrices(
    screens: Sequence[Mapping[str, Any]],
    *,
    release: str = DEFAULT_RELEASE,
    on_self_measured: str = "degrade",
    with_copy_number: bool = True,
    with_dependency: bool = True,
    feature_names: Sequence[str] | None = None,
):
    """Vectorized core: yield one :class:`ScreenMatrix` per screen.

    This is the path to use for anything that touches more than a handful of
    screens.  A train-split fitness screen measures ~18 500 genes, so the
    dict-of-dicts shape :func:`compute` returns costs ~500 k dict entries per
    screen; the matrix shape is one ``(n_genes, n_features)`` float32 array.
    :func:`compute` is a thin wrapper over this, so the two can never drift.

    Raises:
        ValueError: unknown ``release``, ``on_self_measured`` or feature name.
    """
    if on_self_measured not in ("degrade", "flag", "drop"):
        raise ValueError(
            f"on_self_measured must be degrade/flag/drop, got {on_self_measured!r}"
        )
    names = list(feature_names or FEATURE_NAMES)
    unknown = [n for n in names if n not in _FEATURE_INDEX]
    if unknown:
        raise ValueError(f"unknown feature name(s): {unknown}")

    res = resource(release, with_copy_number, with_dependency)
    norm = res._normalize
    models = frozenset(res.models)

    for screen in screens:
        match = resolver().match(screen, models)
        if match.depmap_derived:
            if on_self_measured == "drop":
                continue
            if on_self_measured == "flag":
                match = CellLineMatch(
                    match.cell_line, match.model_id, match.tier, match.lineage,
                    match.lineage_source, match.has_crispr, True,
                    "cell_line" if match.has_crispr
                    else ("lineage" if match.lineage else "global"),
                )
        genes, values = _screen_matrix(res, match, screen["relevance_genes"], names)
        yield ScreenMatrix(
            dataset_name=str(screen.get("dataset_name")),
            match=match,
            genes=genes,
            values=values,
            feature_names=names,
        )


def _screen_matrix(
    res: "DepMapResource",
    match: CellLineMatch,
    relevance_genes: Sequence[str],
    names: Sequence[str],
) -> tuple[list[str], np.ndarray]:
    """``(sorted unique normalized genes, (n_genes, len(names)) float32)``.

    Genes are returned sorted so the output is independent of the order the
    screen happened to list its library in, which is what makes the whole family
    deterministic.  A gene DepMap never measured gets an all-zero row apart from
    ``dm_effect_source`` and the neutral-diploid ``dm_cn_log2`` -- Chronos 0
    means "knocking this out does nothing", which is the honest default.
    """
    norm = res._normalize
    stats = res.stats
    genes = sorted({norm(g) for g in relevance_genes})
    n = len(genes)
    pos = res._gene_pos
    idx = np.fromiter((pos.get(g, -1) for g in genes), dtype=np.int64, count=n)
    ok = idx >= 0
    gi = idx[ok]

    src = {"cell_line": 2.0, "lineage": 1.0, "global": 0.0}[match.source]
    out = np.zeros((n, len(names)), dtype=np.float32)
    out[:, [i for i, nm in enumerate(names) if nm == "dm_effect_source"]] = src
    for i, nm in enumerate(names):
        if nm == "dm_cn_log2":
            out[:, i] = 1.0
    if gi.size == 0:
        return genes, out

    gmean = stats.mean[gi]
    gsd = stats.sd[gi]
    frac = stats.frac_dependent[gi]

    eff = res.effect_row(match)[gi]
    eff = np.where(np.isfinite(eff), eff, gmean)

    lineage_mean = res.lineage_profile(match.lineage) if match.lineage else None
    if lineage_mean is None:
        lmean = gmean
    else:
        lm = lineage_mean[gi]
        lmean = np.where(np.isfinite(lm), lm, gmean)

    dep = res.dependency_row(match)[gi]
    dep_ok = np.isfinite(dep)
    cn = res.copy_number_row(match)[gi]
    cn_ok = np.isfinite(cn)
    lin_p10 = res.lineage_percentile(match.lineage, 10.0)[gi]

    col: dict[str, np.ndarray] = {
        "dm_effect": eff,
        "dm_neg_effect": -eff,
        "dm_dep_prob": np.where(dep_ok, dep, 0.0),
        "dm_effect_source": np.full(gi.size, src, dtype=np.float32),
        "dm_effect_lineage": lmean,
        "dm_effect_global": gmean,
        "dm_effect_median": stats.median[gi],
        "dm_effect_p10": stats.p10[gi],
        "dm_effect_p25": stats.p25[gi],
        "dm_effect_lineage_p10": lin_p10,
        "dm_effect_min": stats.minimum[gi],
        "dm_effect_sd": gsd,
        "dm_effect_skew": stats.skew[gi],
        "dm_effect_shrunk": 0.6 * lmean + 0.4 * gmean,
        "dm_selective": gmean - eff,
        "dm_selective_lineage": lmean - eff,
        "dm_effect_z": np.where(gsd > 1e-6, (eff - gmean) / np.where(gsd > 1e-6, gsd, 1.0), 0.0),
        "dm_pan_essential": stats.pan_essential[gi],
        "dm_frac_dependent": frac,
        "dm_dep_prob_global": stats.dep_prob_mean[gi],
        "dm_selectivity_score": (-eff) * (1.0 - frac),
        "dm_cn_log2": np.where(cn_ok, cn, 1.0),
        "dm_cn_loss": (cn_ok & (cn < 0.7)).astype(np.float32),
        "dm_cn_amp": (cn_ok & (cn > 1.3)).astype(np.float32),
        "dm_in_depmap": np.ones(gi.size, dtype=np.float32),
    }
    for i, nm in enumerate(names):
        out[ok, i] = col[nm]
    return genes, out


#: Alias for :func:`compute`, matching the ``transform`` verb the other families
#: in this package use.  There is deliberately no ``fit``: this family is derived
#: entirely from DepMap, so it reads no AssayBench labels from any split and has
#: nothing to learn from train.
transform = compute


def iter_screen_features(
    screens: Sequence[Mapping[str, Any]],
    *,
    release: str = DEFAULT_RELEASE,
    on_self_measured: str = "degrade",
    with_copy_number: bool = True,
    with_dependency: bool = True,
    feature_names: Sequence[str] | None = None,
):
    """Generator form of :func:`compute` that also yields the cell-line match."""
    for sm in iter_feature_matrices(
        screens,
        release=release,
        on_self_measured=on_self_measured,
        with_copy_number=with_copy_number,
        with_dependency=with_dependency,
        feature_names=feature_names,
    ):
        yield ScreenFeatures(sm.dataset_name, sm.match, sm.as_dict())


def match_report(
    screens: Sequence[Mapping[str, Any]],
    *,
    release: str = DEFAULT_RELEASE,
) -> dict[str, Any]:
    """Cell-line match rates, tier breakdown and the unmatched names.

    Returns a JSON-friendly dict.  ``rung`` counts which fallback level each
    screen actually landed on, which is the number that matters for coverage.
    """
    res = resource(release, False, False)
    models = frozenset(res.models)
    tiers: dict[str, int] = {}
    rungs: dict[str, int] = {}
    unmatched: dict[str, int] = {}
    derived = 0
    for screen in screens:
        m = resolver().match(screen, models)
        tiers[m.tier] = tiers.get(m.tier, 0) + 1
        rungs[m.source] = rungs.get(m.source, 0) + 1
        derived += int(m.depmap_derived)
        if m.model_id is None:
            unmatched[m.cell_line] = unmatched.get(m.cell_line, 0) + 1
    n = max(len(screens), 1)
    return {
        "release": release,
        "n_screens": len(screens),
        "tier": dict(sorted(tiers.items(), key=lambda kv: (-kv[1], kv[0]))),
        "rung": dict(sorted(rungs.items(), key=lambda kv: (-kv[1], kv[0]))),
        "pct_cell_line_rung": round(100.0 * rungs.get("cell_line", 0) / n, 2),
        "pct_lineage_rung": round(100.0 * rungs.get("lineage", 0) / n, 2),
        "pct_global_rung": round(100.0 * rungs.get("global", 0) / n, 2),
        "n_depmap_derived": derived,
        "unmatched_cell_lines": dict(
            sorted(unmatched.items(), key=lambda kv: (-kv[1], kv[0]))[:40]
        ),
    }


# --------------------------------------------------------------------------- #
# evaluation helpers (validation only -- these must never see the test split)
# --------------------------------------------------------------------------- #

def rank_by_feature(
    features: Mapping[str, Mapping[str, float]],
    name: str,
    *,
    descending: bool = True,
    k: int = 100,
) -> list[str]:
    """Top-``k`` gene symbols for one feature.  Ties broken by symbol, so the
    ordering is deterministic and never depends on dict insertion order."""
    sign = -1.0 if descending else 1.0
    items = sorted(features.items(), key=lambda kv: (sign * kv[1][name], kv[0]))
    return [g for g, _ in items[:k]]


def per_screen_andcg(
    screens: Sequence[Mapping[str, Any]],
    *,
    release: str = DEFAULT_RELEASE,
    k: int = 100,
    names: Sequence[str] | None = None,
    verify: int = 8,
) -> tuple[list[str], dict[tuple[str, str], np.ndarray]]:
    """Per-screen AnDCG@k for every feature in both directions.

    Returns ``(dataset_names, {(feature, "desc"|"asc"): array of per-screen
    scores})``.  Per-screen vectors, not just means, because every improvement
    claim needs a *paired* test across screens.

    Exactness: every gene ranked here is a gene the screen measured, so the
    metric's "condensed" step -- which deletes unmeasured genes from the top-k --
    can never fire, and AnDCG@k reduces to
    ``max((sum(rel[top k] * discount) / idcg - ndcg_rand) / (1 - ndcg_rand), 0)``.
    ``verify`` screens are additionally scored through
    :meth:`splicr.benchmark.ScreenTarget.score` and the two must agree to 1e-12,
    so the fast path is checked rather than assumed.

    Raises:
        RuntimeError: any supplied screen is from the test split.
    """
    from splicr.benchmark import AnDCG

    if any(str(s.get("split")) == "test" for s in screens):
        raise RuntimeError("refusing to evaluate on the test split")

    names = list(names or FEATURE_NAMES)
    scorer = AnDCG(k=k)
    disc = 1.0 / np.log2(np.arange(2, k + 2))
    by_name = {str(s.get("dataset_name")): s for s in screens}

    order_names: list[str] = []
    scores: dict[tuple[str, str], list[float]] = {
        (n, d): [] for n in names for d in ("desc", "asc")
    }
    checked = 0
    for sm in iter_feature_matrices(screens, release=release, feature_names=names):
        key = sm.dataset_name
        genes, mat = sm.genes, sm.values
        if not genes:
            continue
        target = scorer.target(by_name[key])
        rel = np.fromiter((target.relevance.get(g, 0.0) for g in genes),
                          dtype=np.float64, count=len(genes))
        order_names.append(key)
        tie = np.arange(len(genes))
        for j, n in enumerate(names):
            col = mat[:, j]
            for direction, sign in (("desc", -1.0), ("asc", 1.0)):
                if target.idcg == 0:
                    scores[(n, direction)].append(0.0)
                    continue
                top = np.lexsort((tie, sign * col))[:k]
                gain = float(np.dot(rel[top], disc[:top.size]))
                val = max((gain / target.idcg - target.rand_ndcg) / target.denom, 0.0)
                scores[(n, direction)].append(val)
                if checked < verify:
                    ref = target.score([genes[i] for i in top])
                    if abs(ref - val) > 1e-12:
                        raise AssertionError(
                            f"fast AnDCG path disagrees with ScreenTarget.score on "
                            f"{key}/{n}/{direction}: {val!r} vs {ref!r}"
                        )
        checked += 1
    if not order_names:
        raise ValueError("no screens scored")
    return order_names, {kk: np.asarray(v) for kk, v in scores.items()}


def standalone_andcg(
    screens: Sequence[Mapping[str, Any]],
    *,
    release: str = DEFAULT_RELEASE,
    k: int = 100,
    names: Sequence[str] | None = None,
) -> dict[str, dict[str, float]]:
    """Mean AnDCG@k of ranking each screen's library by one feature at a time.

    Returns ``{feature: {"desc": mean, "asc": mean, "best": mean, "n_screens": n}}``.
    Both directions are reported because sign matters: the metric's numerator
    does not clip negative relevance, so ranking an opposite-direction gene
    actively subtracts from the score.

    Only ever call this with the train or validation split.
    """
    names = list(names or FEATURE_NAMES)
    keys, per = per_screen_andcg(screens, release=release, k=k, names=names)
    out = {}
    for n in names:
        d = float(per[(n, "desc")].mean())
        a = float(per[(n, "asc")].mean())
        out[n] = {"desc": d, "asc": a, "best": max(d, a), "n_screens": len(keys)}
    return out


def paired_delta(a: np.ndarray, b: np.ndarray, *, n_boot: int = 20000, seed: int = 12345):
    """Paired comparison of two per-screen score vectors.

    Returns ``(mean_delta, ci_low, ci_high, wilcoxon_p)`` for ``a - b``.  The
    bootstrap resamples *screens*, which is the unit the benchmark averages over.
    A delta whose 95% CI crosses zero is not an improvement.
    """
    from scipy.stats import wilcoxon

    d = np.asarray(a, dtype=np.float64) - np.asarray(b, dtype=np.float64)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, d.size, size=(n_boot, d.size))
    boot = d[idx].mean(axis=1)
    lo, hi = np.percentile(boot, [2.5, 97.5])
    if not np.any(d):               # identical vectors: no difference to test
        return 0.0, 0.0, 0.0, 1.0
    with _quiet_nan():
        try:
            p = float(wilcoxon(a, b).pvalue)
        except ValueError:          # all non-zero differences tied
            p = 1.0
    if not np.isfinite(p):
        p = 1.0
    return float(d.mean()), float(lo), float(hi), p


def is_significant(delta: float, lo: float, hi: float, p: float, alpha: float = 0.05) -> bool:
    """Whether a paired delta counts as a real improvement.

    Deliberately strict: the bootstrap CI must exclude zero **and** Wilcoxon must
    agree at ``alpha``.  The two disagree more often than is comfortable on 218
    screens -- ``dm_frac_dependent`` has a CI of ``[-0.017, -0.001]`` with
    Wilcoxon ``p = 0.42`` -- and a claim only one of them supports is not a
    finding.
    """
    return (lo > 0 or hi < 0) and p < alpha


# --------------------------------------------------------------------------- #
# self-check
# --------------------------------------------------------------------------- #

#: The single feature pre-registered as this family's headline ranker, chosen on
#: validation before any test evaluation: rank a screen's library by the 10th
#: percentile Chronos effect within the screen's lineage, most essential first.
HEADLINE_FEATURE = "dm_effect_lineage_p10"
HEADLINE_DIRECTION = "asc"

#: The pan-cancer mean effect, i.e. the same family with the cell-line match
#: switched off.  Every improvement claim is measured against this.
BASELINE_FEATURE = "dm_effect_global"
BASELINE_DIRECTION = "asc"


def _self_check() -> int:
    from splicr.assaybench_io import load_split

    val = load_split("validation")
    print(f"validation screens: {len(val)}   (test split never loaded)")

    rep = match_report(val)
    print(f"cell-line rung {rep['pct_cell_line_rung']}%   "
          f"lineage rung {rep['pct_lineage_rung']}%   "
          f"global rung {rep['pct_global_rung']}%")
    print(f"depmap-derived screens here: {rep['n_depmap_derived']} (expected 0 -- all "
          f"three DepMap publications predate 2021 and so land in train)")

    keys, per = per_screen_andcg(val)
    means = {n: {"desc": float(per[(n, "desc")].mean()),
                 "asc": float(per[(n, "asc")].mean())} for n in FEATURE_NAMES}
    ranked = sorted(FEATURE_NAMES, key=lambda n: -max(means[n].values()))

    print(f"\nstandalone validation AnDCG@100, ranking each screen's own library\n"
          f"{'feature':<24}{'desc':>9}{'asc':>9}{'best':>9}{'>0':>6}")
    for n in ranked:
        d, a = means[n]["desc"], means[n]["asc"]
        best_vec = per[(n, "desc")] if d >= a else per[(n, "asc")]
        print(f"{n:<24}{d:>9.5f}{a:>9.5f}{max(d, a):>9.5f}{int((best_vec > 0).sum()):>6}")

    base = per[(BASELINE_FEATURE, BASELINE_DIRECTION)]

    def line(label: str, vec: np.ndarray, against: np.ndarray = base) -> None:
        delta, lo, hi, p = paired_delta(vec, against)
        verdict = "REAL" if is_significant(delta, lo, hi, p) else "not significant"
        print(f"  {label:<42}{vec.mean():.5f}  d={delta:+.5f}  "
              f"CI95 [{lo:+.5f},{hi:+.5f}]  p={p:.1e}  {verdict}")

    head = per[(HEADLINE_FEATURE, HEADLINE_DIRECTION)]
    print(f"\npre-registered headline: {HEADLINE_FEATURE} ({HEADLINE_DIRECTION}), "
          f"release {DEFAULT_RELEASE}")
    print(f"  standalone validation AnDCG@100 = {head.mean():.5f}  over {len(keys)} screens")
    print(f"\nall deltas are against {BASELINE_FEATURE} = {base.mean():.5f}, which is this "
          f"family\n  with the cell-line match switched off. Significance needs BOTH the "
          f"bootstrap\n  CI to exclude zero and Wilcoxon p < 0.05.")
    line(HEADLINE_FEATURE, head)
    line("dm_effect_p10 (pan-cancer left tail)", per[("dm_effect_p10", "asc")])
    line("dm_effect_lineage (lineage mean)", per[("dm_effect_lineage", "asc")])
    line("dm_effect (the screen's OWN cell line)", per[("dm_effect", "asc")])

    print("\nthe two results that matter:")
    d1 = paired_delta(per[("dm_effect", "asc")], base)
    print(f"  1. Matching the exact cell line is significantly HARMFUL: "
          f"{d1[0]:+.5f} (p={d1[3]:.1e}).")
    print(f"     Within the {sum(1 for s in val if resolver().match(s, frozenset(resource(DEFAULT_RELEASE, False, False).models)).source == 'cell_line')} "
          f"screens that matched a cell line exactly, using that line's own")
    print(f"     Chronos row loses to the pan-cancer mean. The family's value is a "
          f"left tail\n     over cell lines, not the value in the screen's own line.")
    d2 = paired_delta(per[("dm_effect_p10", "asc")], base)
    print(f"  2. The 10th-percentile effect beats the mean: {d2[0]:+.5f} (p={d2[3]:.1e}), "
          f"and this\n     holds on both Chronos releases.")
    d3 = paired_delta(head, per[("dm_effect_p10", "asc")])
    print(f"  Caveat: narrowing the percentile to the screen's own lineage adds "
          f"{d3[0]:+.5f} on\n     {DEFAULT_RELEASE} (CI [{d3[1]:+.5f},{d3[2]:+.5f}], "
          f"Wilcoxon p={d3[3]:.2f} -- the tests disagree) and\n     REVERSES on the 24Q4 "
          f"release. Treat the lineage refinement as unproven.")

    best = ranked[0]
    bd = "desc" if means[best]["desc"] >= means[best]["asc"] else "asc"
    if best != HEADLINE_FEATURE:
        print(f"\nnote: the best feature on this run is {best} ({bd}) at "
              f"{max(means[best].values()):.5f}; the headline stays as pre-registered.")
    return 0


if __name__ == "__main__":
    sys.exit(_self_check())
