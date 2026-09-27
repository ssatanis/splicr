"""The independent replication benchmark: dataset construction and loader.

THE QUESTION THIS DATASET ASKS

Given only screen A's own measurements, which of A's hits are real? There is no
public dataset of "which hits validated", so this uses the strongest available
proxy: independent replication. If two labs screen the same phenotype in the
same cell line with different libraries, and a gene is called a hit in both,
that gene is far more likely to be real than one called in only one of them.

So the task is: given screen A's gene-level scores and hit calls, rank A's genes
by the probability that the gene is also a hit in screen B. B's hit calls are
the label and a predictor never sees them.

WHY IT IS BUILT THE WAY IT IS

Every filter below is mechanical and is applied to metadata that BioGRID ORCS
ships, never to the labels. The counts each filter removes are recorded in the
built artifact so the funnel can be audited. ``docs/07-replication-benchmark.md``
argues each choice and lists the objections that remain.

The one judgement that is not mechanical is the restriction to unperturbed
proliferation screens. The ORCS PHENOTYPE vocabulary is too coarse outside
proliferation to establish that two screens measure the same thing: five screens
in HEK293T all carry PHENOTYPE "protein/peptide accumulation" while, per their
own NOTES, reading out GFP-PARKIN levels, ERAD of a GFP-CYP51A1TM substrate,
autophagy deficiency, the GFP-LC3-RFP autophagic flux reporter, and readthrough
translation of an AMD1 reporter. The assay identity lives in the free-text NOTES
field, which cannot be matched at scale. Pairing on the vocabulary alone would
have admitted 136 further pairs of screens that measure unrelated things and
would have destroyed the meaning of the label. See ``EXCLUDED_PHENOTYPE_NOTE``
and :func:`excluded_phenotype_audit`, which re-derives that count.

LEAKAGE

B's hit calls are the answer. Three channels are closed structurally rather than
by convention:

1. :func:`load_pair_inputs` issues a query that reads screen A's rows only, so
   the frame handed to a predictor cannot contain B.
2. :func:`load_pair_labels` refuses held-out pairs unless the caller passes
   ``evaluating=True``, so a tuning loop that reaches for labels raises.
3. :func:`allowed_background_screens` is the only sanctioned screen set for
   fitting anything that is not pair-specific: it removes both pair screens,
   every screen from either publication, and every screen in the pair's cell
   line. A frequency prior fitted over that set cannot contain B.
   :func:`forbidden_external` names the DepMap models that are off limits for
   the same reason: 130 of the 133 cell lines here are in DepMap, and DepMap
   CRISPRGeneEffect *is* the Broad Avana experiment, so for a pair whose B side
   is a Broad Avana screen the DepMap column for that cell line is the label in
   a later release.

The existing AssayBench boundary is honoured on top of all of this: the only
screens considered are those :mod:`splicr.orcs_safe` marks safe under the
publication-level policy, and gene-level rows are read from the safe-only parsed
cache, which physically does not contain the AssayBench validation and test
screens.

USAGE

    from splicr.replication import dataset

    bench = dataset.load()
    for unit in bench.units("development"):
        inputs = dataset.load_pair_inputs(unit)      # gene, a_hit, a_score1
        pred = my_method(inputs, dataset.allowed_background_screens(unit))
        truth = dataset.load_pair_labels(unit, evaluating=True)

Rebuild the artifact with ``python -m splicr.replication.dataset build``.
"""

from __future__ import annotations

import collections
import csv
import itertools
import json
import os
import re
from dataclasses import dataclass, asdict
from functools import lru_cache
from typing import Iterable, Sequence

from .. import orcs_safe

_HERE = os.path.dirname(os.path.abspath(__file__))
ARTIFACT = os.path.join(_HERE, "_pairs_v1.json")
SCHEMA_VERSION = 1

# ---------------------------------------------------------------------------
# Thresholds. Every one of these has its source recorded, because a reader is
# entitled to ask why it is not some other number.
# ---------------------------------------------------------------------------

#: A screen must report a genome-scale background, not only a hit list. ORCS
#: flags this as FULL_SIZE_AVAILABLE, and the flag is exact: of the 1,574 safe
#: screens, all 134 with SIGNIFICANCE_INDICATOR "All Significant" have
#: FULL_SIZE_AVAILABLE="No" and a measured hit fraction of exactly 1.000 (both
#: the minimum and the maximum over those 134 are 1.0), while the 1,372 screens
#: with FULL_SIZE_AVAILABLE="Yes" have a median hit fraction of 0.0823.
#: A hit-list-only deposit cannot serve as either side: its non-hits are absent
#: rather than negative.
REQUIRE_FULL_BACKGROUND = True

#: Minimum genes measured. The measured-gene distribution of the 1,355
#: full-background pooled safe screens is strongly bimodal: 207 focused
#: libraries at or below 3,000 genes, 1,141 genome-scale libraries at or above
#: 14,500, and only 7 screens in between (4,568; 7,111 four times; 11,465;
#: 11,466). The band is sparse but it is NOT empty, so this cut is a real choice
#: and not a formality: at 10,000 it excludes the 4,568-gene and the four
#: 7,111-gene screens and admits the 11,465 and 11,466-gene pair. None of those
#: seven ends up in a pair, so moving the cut anywhere in the band leaves the
#: benchmark unchanged, but the reason is that the band is empty of PAIRABLE
#: screens, not empty of screens. Also matches the ORCS_MIN_LIBRARY threshold
#: that ``_assaybench_safe_orcs.json`` already uses for "usable full library".
MIN_MEASURED_GENES = 10_000

#: A screen with almost no hits gives a label with no positives, and a screen
#: that calls a fifth of the genome a hit is not making a discriminative call.
#: Over the 1,143 full-background safe screens with at least 10,000 genes the
#: hit fraction has median 0.0862 and standard deviation 0.0449, so 0.20 sits
#: 2.5 standard deviations above the median (3 would be 0.221). It excludes 5 of
#: those 1,143 screens, and MIN_HITS excludes 50, so the benchmark does not
#: depend on where in that tail the line is drawn.
MIN_HITS = 10
MAX_HIT_FRACTION = 0.20

#: The comparison must be over a gene space both screens actually measured.
#: 10,000 shared genes keeps the per-pair ranking task large enough that average
#: precision has a tight estimate; the 60% coverage rule stops a genome-scale
#: screen being compared against the fraction of itself that a smaller library
#: happens to cover. Neither binds in practice: all 181 candidate pairs pass
#: both, with a minimum shared space of 16,220 genes and a minimum per-side
#: coverage of 0.862. They are kept as guards, not as active filters, so that a
#: future ORCS release cannot quietly introduce a badly overlapping pair.
MIN_SHARED_GENES = 10_000
MIN_SHARED_COVERAGE = 0.60

#: Both sides need enough hits inside the shared space for the task to be
#: rankable and for the label to have enough positives. 50 positives puts the
#: standard error of average precision at roughly 0.05, which is the resolution
#: any claim here would be made at.
#:
#: This is enforced on BOTH gene spaces, and in particular on
#: :data:`PRIMARY_SPACE`, because a guard that does not bind where the headline
#: is computed is not a guard. On the full space it never binds: the smallest
#: side of any candidate pair has 61 hits. On the primary space it removes 6 of
#: the 181 candidate pairs, whose weaker side calls only 15, 29, 30, 30, 32 and
#: 15 non-common-essential hits (S16-S1075, S29-S629, S281-S629, S349-S1076,
#: S783-S1075, S852-S1076). Average precision over 15 positives is not a
#: measurement.
#:
#: Like every other filter it is applied BEFORE the split, so it is not a choice
#: about which split loses pairs. Removing those 6 does change the publication
#: graph, and therefore the split: the hub rule then strands fewer pairs across
#: the two sides, 37 instead of 45, so the benchmark ends up with 138 pairs
#: rather than 136 and the held-out side with 124 rather than 120. That is a
#: consequence of the rule and not a tuning knob, and it is recorded here because
#: a reader comparing two builds is entitled to know why the totals moved.
#:
#: WHICH LABEL-DERIVED QUANTITIES MAY GATE A PAIR. This filter reads each side's
#: own marginal hit count, which is unavoidable: a ranking task with no positives
#: cannot be scored. It must never read ``n_both``, the agreement between the two
#: sides, because agreement is the quantity the benchmark measures and selecting
#: pairs on it would manufacture the result. No filter in this module touches
#: ``n_both``; the funnel in the built artifact is the audit of that claim.
MIN_SHARED_HITS = 50

#: The phenotype restriction. See the module docstring.
PHENOTYPE = "cell proliferation"
EXPERIMENTAL_SETUP = "Timecourse"
CONDITION_NAME = "-"
SCREEN_TYPE = "Negative Selection"

EXCLUDED_PHENOTYPE_NOTE = (
    "Screens outside PHENOTYPE='cell proliferation' / EXPERIMENTAL_SETUP='Timecourse' / "
    "CONDITION_NAME='-' are excluded because the ORCS PHENOTYPE vocabulary does not "
    "identify the assay, so a phenotype match does not establish that two screens measure "
    "the same thing. Relaxing the restriction to a PHENOTYPE match alone, with every other "
    "rule unchanged, admits 136 further pairs: 101 'response to chemicals', 29 "
    "'protein/peptide accumulation' and 6 'response to virus'. Inspection of the free-text "
    "NOTES and CONDITION_NAME shows those pairs compare unrelated experiments. Five "
    "HEK293T screens all carry 'protein/peptide accumulation' while reading out, per their "
    "own NOTES, GFP-PARKIN levels (screen 182), ERAD of a GFP-CYP51A1TM substrate (1461), "
    "autophagy deficiency (1618), the GFP-LC3-RFP autophagic flux reporter (1686) and "
    "readthrough translation of an AMD1 reporter (2134); screen 182 pairs with all four of "
    "the others. The perturbed pairs match phenotype while comparing different "
    "perturbations: GSK983 against formaldehyde, resveratrol against ONC201, cisplatin "
    "against olaparib, SARS-CoV-2 against influenza A. Non-replication in such a pair means "
    "the two labs did different experiments, not that a hit was an artifact, which is "
    "precisely the meaning the label must carry. Salvaging the handful of pairs that do "
    "survive a reading of the notes would mean hand-picking pairs after seeing them, which "
    "is the 'you chose the pairs' objection in its purest form. "
    "Re-derive these counts with excluded_phenotype_audit()."
)

#: SCORE.1 sign convention, keyed by the ORCS SCORE.1_TYPE string. This is read
#: from metadata, never inferred from the hit calls, because inferring it from a
#: screen's own hits would mean touching the label whenever that screen is the
#: B side. Sources: the SIGNIFICANCE_CRITERIA strings in this dataset state the
#: direction directly for Bayes Factor ("> 0.0", "> 1.57", ...), CRISPR Score
#: ("< -1.0"), Log2 ("< -2.0"), FDR ("< 0.05") and MaGeCK Score ("< 0.0", from
#: Liang J 2020, the only screen here whose criteria names Score.1 as MaGeCK).
#: CERES score is a fitness effect on the Broad's scale where negative is loss
#: of viability. CasTLE Score is a confidence statistic whose sign carries no
#: direction, and no screen here states a Score.1 criterion for it, so it is
#: left unknown rather than guessed.
SCORE1_DIRECTION = {
    "Bayes Factor": "higher_is_stronger",
    "CERES score": "lower_is_stronger",
    "CRISPR Score (CS)": "lower_is_stronger",
    "MaGeCK Score": "lower_is_stronger",
    "Log2": "lower_is_stronger",
    "FDR": "lower_is_stronger",
    "CasTLE Score": "unknown",
}

SPLITS = ("development", "heldout")

#: The gene space the headline number is computed over, and the single most
#: important design decision after the pairing rule.
#:
#: Measured on development, average precision over the FULL shared space is
#: 0.4750 for a ranking by screen A's own effect size and 0.4366 for a ranking
#: by "is this gene on the CEGv2 / DepMap common-essential list", a lookup table
#: that never opens the screen. The difference is not significant: +0.0383, 95%
#: CI [-0.0255, +0.0989], Wilcoxon p = 0.30 over 14 screen pairs. The reason is
#: that common essentials are 58% of development query hits and 72% of held-out
#: query hits, and they replicate almost unconditionally: in that stratum
#: development precision is 0.709 against a marginal of 0.637, a lift of 1.11,
#: and held out 0.827 against 0.774, a lift of 1.07.
#:
#: So a headline computed over the full space would be mostly a test of whether
#: a method can recall a published gene list, and any method that consults one
#: would score well without saying anything about whether a hit is real.
#:
#: Restricted to non-common-essential genes the shortcut dies, exactly as it
#: must: the lookup table scores 0.0436 against a random 0.0453, while A's
#: effect size scores 0.2517, beating random by +0.2065, CI [0.1465, 0.2670],
#: and beating A's own binary hit call by +0.0827, CI [0.0445, 0.1187]. Lift in
#: this stratum is 8.1 on development and 11.2 held out. That is where the
#: benchmark has headroom and where being right about artifacts can pay, so that
#: is the primary space. The full-space number is reported alongside it, never
#: instead of it.
#:
#: Every number in this note is development-only and is reproduced by
#: ``docs/07-replication-benchmark.md``; none of it was computed on held-out
#: pairs.
PRIMARY_SPACE = "non_common_essential"
GENE_SPACES = ("non_common_essential", "all")

GENESET_DIR = os.environ.get(
    "SPLICR_GENESET_DIR",
    "/Users/sahaj/Documents/Projects/SplicR/data/references/genesets",
)
DEPMAP_DIR = os.environ.get(
    "SPLICR_DEPMAP_DIR",
    "/Users/sahaj/Documents/Projects/SplicR/data/references/depmap",
)


# ---------------------------------------------------------------------------
# Normalisation helpers
# ---------------------------------------------------------------------------

def cell_line_key(name: str) -> str:
    """Strict cell-line key: lowercase, alphanumerics only.

    Deliberately conservative. It merges "HEK293T" with "HEK-293T" but keeps
    "HEK293T", "HEK-293" and "HEK293-A" apart, and keeps "HeLa" apart from
    "HeLa S3" and "U-87MG" from "U-87MG ATCC". Missing a true match costs a
    pair; inventing one puts two different cell lines in a pair and makes
    non-replication mean biology instead of noise, which would be fatal.
    """
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def first_author_key(author: str) -> str:
    """"Wang T (2014)" -> "wang t". A lab proxy, and the reason is in the spec."""
    return re.sub(r"\s*\(\d{4}\)", "", author or "").strip().lower()


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def screen_index() -> dict[int, dict]:
    """ORCS screen index rows for safe screens only, keyed by SCREEN_ID.

    Reads the safe-only parsed index, so an excluded AssayBench validation or
    test screen is not present to be considered in the first place.
    """
    path = os.path.join(orcs_safe.PARSED_DIR, "orcs_human_safe_index.json")
    with open(path) as fh:
        raw = json.load(fh)
    out = {int(k): v for k, v in raw["screens"].items()}
    orcs_safe.assert_safe(out.keys(), policy=raw.get("policy"))
    return out


def _long_path() -> str:
    return os.path.join(orcs_safe.PARSED_DIR, "orcs_human_safe_long.parquet")


def _duck():
    import duckdb

    return duckdb.connect()


def _rows_sql(where: str = "") -> str:
    """SQL for the gene-level table with ONE row per (screen_id, gene).

    The parsed cache is one row per ORCS record, and ORCS records are not unique
    per gene within a screen: 1,213 of the 1,574 safe screens carry at least one
    repeated gene, 23,557 (screen, gene) groups have more than one row, and the
    repeats share the same ENTREZ_GENE id, so they are repeated measurements of
    one gene rather than two genes with one symbol. Screen 930 reports NAA38
    twice, once HIT=YES with SCORE.1 3.495 and once HIT=NO with SCORE.1 -0.719.

    Leaving that alone breaks the benchmark in three ways. The shared gene space
    is counted in rows rather than genes, so it is overstated. A repeated gene
    contributes several times to a hit count and to any average precision, so it
    is silently upweighted. Worst, joining inputs to labels on ``gene``, which is
    the obvious thing for a caller to do, is a many-to-many join and inflates
    both sides: for pair 420/930 it turns 17,151 genes into 17,208 rows.

    So every read goes through here and the gene key is unique by construction.

    The collapse rule, and why this one. ``hit`` is kept only where the repeated
    rows AGREE, and the gene is dropped from that screen otherwise: 1,290 of the
    23,557 groups contradict themselves, and for those the screen states both
    that the gene is a hit and that it is not. On the A side we cannot say what A
    claimed, and on the B side the label itself is undefined. Dropping is the
    neutral choice. Taking the OR would manufacture hits and bias every measured
    replication rate upward, which is the direction that flatters the benchmark.
    ``score1`` is the mean over the surviving rows, which only ever averages
    rows that agree on the call.
    """
    return f"""
        select screen_id,
               gene,
               (min(hit::int) = 1) as hit,
               avg(score1)         as score1
        from read_parquet('{_long_path()}')
        {where}
        group by screen_id, gene
        having min(hit::int) = max(hit::int)
    """


@lru_cache(maxsize=1)
def _screen_counts() -> dict[int, tuple[int, int]]:
    """``{screen_id: (n_measured, n_hit)}``, counting genes and not ORCS rows."""
    con = _duck()
    df = con.execute(
        f"select screen_id, count(*) n, sum(hit::int) h from ({_rows_sql()}) group by 1"
    ).fetchdf()
    return {int(r.screen_id): (int(r.n), int(r.h)) for r in df.itertuples()}


@lru_cache(maxsize=1)
def dedup_cost() -> dict:
    """What the one-row-per-gene rule removes, so the spec can state it."""
    con = _duck()
    row = con.execute(
        f"""
        select count(*)                                  n_groups,
               sum((c > 1)::int)                         n_repeated,
               sum((c > 1 and mn <> mx)::int)            n_contradictory,
               sum(c)                                    n_rows
        from (select screen_id, gene, count(*) c, min(hit::int) mn, max(hit::int) mx
              from read_parquet('{_long_path()}') group by 1, 2)
        """
    ).fetchone()
    return {
        "n_orcs_rows": int(row[3]),
        "n_screen_gene_groups": int(row[0]),
        "n_groups_with_repeats": int(row[1]),
        "n_groups_contradicting_themselves": int(row[2]),
        "n_genes_kept": int(row[0]) - int(row[2]),
    }


@lru_cache(maxsize=1)
def common_essentials() -> frozenset[str]:
    """CEGv2 union the DepMap inferred common essentials.

    Used only to stratify the reported base rates and to define the harder
    non-common-essential slice. It is a gene-level, cell-line-independent list,
    so using it does not name the pair's own cell line; a predictor that wants
    DepMap must still respect :func:`forbidden_external`.
    """
    genes: set[str] = set()
    with open(os.path.join(GENESET_DIR, "CEGv2.txt")) as fh:
        next(fh, None)
        for line in fh:
            g = line.split("\t")[0].strip()
            if g:
                genes.add(g)
    path = os.path.join(DEPMAP_DIR, "CRISPRInferredCommonEssentials.csv")
    if os.path.exists(path):
        with open(path) as fh:
            next(fh, None)
            for line in fh:
                g = line.strip().strip('"').split(" (")[0]
                if g:
                    genes.add(g)
    return frozenset(genes)


@lru_cache(maxsize=1)
def _depmap_models() -> dict[str, str]:
    """``{cell_line_key: DepMap ModelID}`` from DepMap Model.csv."""
    path = os.path.join(DEPMAP_DIR, "Model.csv")
    if not os.path.exists(path):
        return {}
    out: dict[str, str] = {}
    with open(path) as fh:
        for row in csv.DictReader(fh):
            for field in (row.get("StrippedCellLineName"), row.get("CellLineName")):
                key = cell_line_key(field or "")
                if key:
                    out.setdefault(key, row["ModelID"])
    return out


# ---------------------------------------------------------------------------
# Eligibility
# ---------------------------------------------------------------------------

def eligible_screens() -> tuple[list[int], dict[str, int]]:
    """Screens that may appear on either side of a pair, plus the drop funnel."""
    idx = screen_index()
    counts = _screen_counts()
    funnel: dict[str, int] = collections.OrderedDict()

    def step(name: str) -> None:
        funnel[name] = funnel.get(name, 0) + 1

    keep: list[int] = []
    for sid, meta in sorted(idx.items()):
        n_measured, n_hit = counts.get(sid, (0, 0))
        step("E0 safe human ORCS screens")
        if meta["THROUGHPUT"] != "High Throughput":
            continue
        step("E1 high throughput")
        if meta["SCREEN_FORMAT"] != "Pool":
            continue
        step("E2 pooled")
        if REQUIRE_FULL_BACKGROUND and meta["FULL_SIZE_AVAILABLE"] != "Yes":
            continue
        step("E3 genome-scale background reported")
        if n_measured < MIN_MEASURED_GENES:
            continue
        step(f"E4 >={MIN_MEASURED_GENES} genes measured")
        if n_hit < MIN_HITS or n_hit / n_measured > MAX_HIT_FRACTION:
            continue
        step(f"E5 {MIN_HITS}<=hits, hit fraction<={MAX_HIT_FRACTION}")
        if meta["PHENOTYPE"] != PHENOTYPE:
            continue
        step(f"E6 phenotype={PHENOTYPE!r}")
        if meta["EXPERIMENTAL_SETUP"] != EXPERIMENTAL_SETUP:
            continue
        step(f"E7 setup={EXPERIMENTAL_SETUP!r}")
        if meta["CONDITION_NAME"].strip() != CONDITION_NAME:
            continue
        step("E8 unperturbed (no condition)")
        if meta["SCREEN_TYPE"] != SCREEN_TYPE:
            continue
        step(f"E9 screen type={SCREEN_TYPE!r}")
        keep.append(sid)
    return keep, funnel


# ---------------------------------------------------------------------------
# Pairing
# ---------------------------------------------------------------------------

def _candidate_pairs(eligible: Sequence[int]) -> tuple[list[tuple[int, int]], dict[str, int]]:
    """Metadata-only pairing. Nothing here reads a hit call."""
    idx = screen_index()
    funnel: dict[str, int] = collections.OrderedDict()

    def step(name: str) -> None:
        funnel[name] = funnel.get(name, 0) + 1

    out: list[tuple[int, int]] = []
    for a, b in itertools.combinations(sorted(eligible), 2):
        ma, mb = idx[a], idx[b]
        step("P0 eligible screen pairs")
        # Independence, condition 1: not the same paper.
        if ma["SOURCE_ID"] == mb["SOURCE_ID"]:
            continue
        step("P1 different publication")
        # Independence, condition 2: not the same lead author. Two papers with
        # the same first author are one lab, so they are not independent labs.
        if first_author_key(ma["AUTHOR"]) == first_author_key(mb["AUTHOR"]):
            continue
        step("P2 different first author")
        # A CRISPRa hit and a CRISPRn hit are not the same claim.
        if ma["LIBRARY_TYPE"] != mb["LIBRARY_TYPE"]:
            continue
        step("P3 same modality")
        # Independence, condition 3: different library. Two screens with the
        # same library share guide sequences, so a seed or off-target artifact
        # of a particular guide replicates. Requiring different libraries means
        # guide-level artifacts do NOT replicate, which is what makes the label
        # informative about whether a hit is real.
        if ma["LIBRARY"] == mb["LIBRARY"]:
            continue
        step("P4 different library")
        # Comparability: the same cell line. A dependency that is real in one
        # line and absent in another is biology, not a failure to replicate, so
        # allowing different lines would make the label mean something else.
        if cell_line_key(ma["CELL_LINE"]) != cell_line_key(mb["CELL_LINE"]):
            continue
        step("P5 same cell line")
        out.append((a, b))
    return out, funnel


def _overlap(cands: Sequence[tuple[int, int]]) -> dict[tuple[int, int], dict]:
    """Shared gene space and hit counts per candidate pair, in one SQL pass."""
    if not cands:
        return {}
    ids = sorted({x for p in cands for x in p})
    orcs_safe.assert_safe(ids)
    ce = sorted(common_essentials())
    con = _duck()
    con.execute(
        "create table L as "
        + _rows_sql(f"where screen_id in ({','.join(map(str, ids))})")
    )
    con.execute("create table CE(gene varchar)")
    con.executemany("insert into CE values (?)", [(g,) for g in ce])
    con.execute("create table P(a int, b int)")
    con.executemany("insert into P values (?,?)", [(int(a), int(b)) for a, b in cands])
    df = con.execute(
        """
        select p.a, p.b,
               count(*)                                            n_shared,
               sum(la.hit::int)                                     a_hits,
               sum(lb.hit::int)                                     b_hits,
               sum((la.hit and lb.hit)::int)                        n_both,
               sum((ce.gene is null)::int)                          n_shared_nce,
               sum((la.hit and ce.gene is null)::int)               a_hits_nce,
               sum((lb.hit and ce.gene is null)::int)               b_hits_nce,
               sum((la.hit and lb.hit and ce.gene is null)::int)    n_both_nce
        from P p
        join L la on la.screen_id = p.a
        join L lb on lb.screen_id = p.b and lb.gene = la.gene
        left join CE ce on ce.gene = la.gene
        group by 1, 2
        """
    ).fetchdf()
    return {
        (int(r.a), int(r.b)): {
            k: int(getattr(r, k))
            for k in (
                "n_shared", "a_hits", "b_hits", "n_both",
                "n_shared_nce", "a_hits_nce", "b_hits_nce", "n_both_nce",
            )
        }
        for r in df.itertuples()
    }


# ---------------------------------------------------------------------------
# Split
# ---------------------------------------------------------------------------

def _split_publications(pair_pubs: Sequence[tuple[str, str]]) -> tuple[set[str], set[str], str]:
    """Publication-disjoint split. Returns (development pubs, heldout pubs, rule).

    The rule, stated before looking at any result: hold out the two publications
    that appear in the most pairs, together with every publication that pairs
    ONLY with those two. Everything else is development. Pairs whose two
    publications land on opposite sides are dropped, which is what "split by
    publication, not by pair" costs.

    Why this rule and not a balanced one. The publication graph here has one
    connected component and is hub-dominated: Behan 2019 and Meyers 2017 are in
    145 and 133 of the 181 pairs and mostly in pairs with each other, so no
    publication-disjoint partition is both balanced and large. The best balanced
    partition keeps 50 pairs and throws away 131. This rule keeps 136 and puts
    the well-powered homogeneous block on the evaluation side and the small
    heterogeneous tail on the development side, which is the direction that
    makes tuning harder rather than easier: anything tuned on development is
    tuned against a mixture of libraries and significance thresholds and then
    has to work on a block it has never seen. :func:`balanced_split` returns the
    balanced partition as well, because a claim that only holds on the large
    block should be reported as such.
    """
    count: collections.Counter[str] = collections.Counter()
    partners: dict[str, set[str]] = collections.defaultdict(set)
    for x, y in pair_pubs:
        count[x] += 1
        count[y] += 1
        partners[x].add(y)
        partners[y].add(x)
    # Deterministic: pair count descending, then PubMed id ascending.
    hubs = {p for p, _ in sorted(count.items(), key=lambda kv: (-kv[1], kv[0]))[:2]}
    held = set(hubs) | {p for p, part in partners.items() if part and part <= hubs}
    dev = {p for p in count if p not in held}
    rule = (
        "hold out the two publications appearing in the most pairs plus every "
        "publication that pairs only with those two; drop pairs that cross"
    )
    return dev, held, rule


def balanced_split(pair_pubs: Sequence[tuple[str, str]]) -> tuple[set[str], set[str]]:
    """The most balanced publication-disjoint partition, as a secondary split.

    Exhaustive over all 2^n assignments of the n publications that appear in at
    least one pair, maximising min(development pairs, heldout pairs), breaking
    ties by total pairs retained and then by the sorted heldout PubMed ids. With
    15 publications that is 32,768 assignments, so exhaustive is cheap and there
    is no search heuristic to argue about.
    """
    edges: collections.Counter[tuple[str, str]] = collections.Counter()
    for x, y in pair_pubs:
        edges[tuple(sorted((x, y)))] += 1  # type: ignore[index]
    pubs = sorted({p for e in edges for p in e})
    best = None
    for mask in range(1 << len(pubs)):
        held = {pubs[i] for i in range(len(pubs)) if mask >> i & 1}
        d = h = 0
        for (x, y), n in edges.items():
            xi, yi = x in held, y in held
            if xi and yi:
                h += n
            elif not xi and not yi:
                d += n
        key = (-min(d, h), -(d + h), sorted(held))
        if best is None or key < best[0]:
            best = (key, held)
    held = best[1] if best else set()
    return {p for p in pubs if p not in held}, held


# ---------------------------------------------------------------------------
# The evaluation unit
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ReplicationPair:
    """One ordered evaluation unit: predict B's hits from A's measurements.

    ``pair_key`` is shared by the two directions of the same screen pair, so a
    paired test can group by it and not count one experiment twice.
    """

    unit_id: str
    pair_key: str
    query_screen: int          # A, the screen whose data the predictor sees
    target_screen: int         # B, whose hit calls are the label
    split: str
    cell_line: str
    cell_line_key: str
    query_publication: str     # PubMed id
    target_publication: str
    query_author: str
    target_author: str
    query_library: str
    target_library: str
    query_criteria: str        # B's is recorded too: it explains B's hit rate
    target_criteria: str
    query_score1_type: str
    query_score1_direction: str
    n_shared_genes: int
    n_query_hits: int
    n_target_hits: int
    n_both_hits: int
    n_shared_genes_non_essential: int
    n_query_hits_non_essential: int
    n_target_hits_non_essential: int
    n_both_hits_non_essential: int
    depmap_model: str | None
    rationale: str

    @property
    def target_hit_rate(self) -> float:
        """Marginal P(hit in B) over the shared gene space."""
        return self.n_target_hits / self.n_shared_genes

    @property
    def query_precision(self) -> float:
        """P(hit in B | hit in A): the fraction of A's hits that replicate."""
        return self.n_both_hits / self.n_query_hits

    @property
    def lift(self) -> float:
        """query_precision / target_hit_rate. What a method has to beat."""
        return self.query_precision / self.target_hit_rate


@dataclass(frozen=True)
class Benchmark:
    meta: dict
    all_units: tuple[ReplicationPair, ...]

    def units(self, split: str | None = None) -> tuple[ReplicationPair, ...]:
        if split is None:
            return self.all_units
        if split not in SPLITS:
            raise ValueError(f"unknown split {split!r}; choose from {SPLITS}")
        return tuple(u for u in self.all_units if u.split == split)

    def unit(self, unit_id: str) -> ReplicationPair:
        for u in self.all_units:
            if u.unit_id == unit_id:
                return u
        raise KeyError(unit_id)


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def build(path: str = ARTIFACT) -> dict:
    """Rebuild the benchmark artifact from ORCS and write it to ``path``."""
    idx = screen_index()
    eligible, e_funnel = eligible_screens()
    cands, p_funnel = _candidate_pairs(eligible)
    ov = _overlap(cands)

    o_funnel: dict[str, int] = collections.OrderedDict()

    def step(name: str) -> None:
        o_funnel[name] = o_funnel.get(name, 0) + 1

    kept: list[tuple[tuple[int, int], dict]] = []
    for key in cands:
        stats = ov.get(key)
        step("O0 candidate pairs")
        if stats is None:
            continue
        a, b = key
        na = _screen_counts()[a][0]
        nb = _screen_counts()[b][0]
        if stats["n_shared"] < MIN_SHARED_GENES:
            continue
        step(f"O1 >={MIN_SHARED_GENES} shared genes")
        if (stats["n_shared"] / na < MIN_SHARED_COVERAGE
                or stats["n_shared"] / nb < MIN_SHARED_COVERAGE):
            continue
        step(f"O2 shared space covers >={MIN_SHARED_COVERAGE:.0%} of each side")
        if min(stats["a_hits"], stats["b_hits"]) < MIN_SHARED_HITS:
            continue
        step(f"O3 >={MIN_SHARED_HITS} hits per side in shared space")
        # The same guard on the primary space, where the headline is computed.
        if min(stats["a_hits_nce"], stats["b_hits_nce"]) < MIN_SHARED_HITS:
            continue
        step(f"O4 >={MIN_SHARED_HITS} hits per side in {PRIMARY_SPACE} space")
        kept.append((key, stats))

    pair_pubs = [(idx[a]["SOURCE_ID"], idx[b]["SOURCE_ID"]) for (a, b), _ in kept]
    dev_pubs, held_pubs, rule = _split_publications(pair_pubs)
    bal_dev, bal_held = balanced_split(pair_pubs)

    units: list[ReplicationPair] = []
    dropped_cross = 0
    for (a, b), stats in kept:
        pa, pb = idx[a]["SOURCE_ID"], idx[b]["SOURCE_ID"]
        if pa in dev_pubs and pb in dev_pubs:
            split = "development"
        elif pa in held_pubs and pb in held_pubs:
            split = "heldout"
        else:
            dropped_cross += 1
            continue
        pair_key = f"S{a}-S{b}"
        for q, t, flip in ((a, b, False), (b, a, True)):
            mq, mt = idx[q], idx[t]
            s1t = mq["SCORE.1_TYPE"]
            units.append(ReplicationPair(
                unit_id=f"{pair_key}:{'B2A' if flip else 'A2B'}",
                pair_key=pair_key,
                query_screen=q,
                target_screen=t,
                split=split,
                cell_line=mq["CELL_LINE"],
                cell_line_key=cell_line_key(mq["CELL_LINE"]),
                query_publication=mq["SOURCE_ID"],
                target_publication=mt["SOURCE_ID"],
                query_author=mq["AUTHOR"],
                target_author=mt["AUTHOR"],
                query_library=mq["LIBRARY"],
                target_library=mt["LIBRARY"],
                query_criteria=mq["SIGNIFICANCE_CRITERIA"],
                target_criteria=mt["SIGNIFICANCE_CRITERIA"],
                query_score1_type=s1t,
                query_score1_direction=SCORE1_DIRECTION.get(s1t, "unknown"),
                n_shared_genes=stats["n_shared"],
                n_query_hits=stats["b_hits"] if flip else stats["a_hits"],
                n_target_hits=stats["a_hits"] if flip else stats["b_hits"],
                n_both_hits=stats["n_both"],
                n_shared_genes_non_essential=stats["n_shared_nce"],
                n_query_hits_non_essential=stats["b_hits_nce"] if flip else stats["a_hits_nce"],
                n_target_hits_non_essential=stats["a_hits_nce"] if flip else stats["b_hits_nce"],
                n_both_hits_non_essential=stats["n_both_nce"],
                depmap_model=_depmap_models().get(cell_line_key(mq["CELL_LINE"])),
                rationale=(
                    f"same cell line {mq['CELL_LINE']}, same unperturbed "
                    f"proliferation screen; different publications "
                    f"({mq['SOURCE_ID']} vs {mt['SOURCE_ID']}), different first "
                    f"authors ({mq['AUTHOR']} vs {mt['AUTHOR']}), different "
                    f"libraries ({mq['LIBRARY']} vs {mt['LIBRARY']})"
                ),
            ))

    doc = {
        "schema_version": SCHEMA_VERSION,
        "orcs_release": "2.0.18",
        "orcs_exclusion_policy": orcs_safe.POLICY,
        "n_safe_screens": len(idx),
        "deduplication": dedup_cost(),
        "eligibility_funnel": e_funnel,
        "pairing_funnel": p_funnel,
        "overlap_funnel": o_funnel,
        "n_unordered_pairs": len({u.pair_key for u in units}),
        "n_units": len(units),
        "n_pairs_dropped_crossing_split": dropped_cross,
        "split_rule": rule,
        "development_publications": sorted(dev_pubs),
        "heldout_publications": sorted(held_pubs),
        "balanced_split": {
            "development_publications": sorted(bal_dev),
            "heldout_publications": sorted(bal_held),
        },
        "thresholds": {
            "MIN_MEASURED_GENES": MIN_MEASURED_GENES,
            "MIN_HITS": MIN_HITS,
            "MAX_HIT_FRACTION": MAX_HIT_FRACTION,
            "MIN_SHARED_GENES": MIN_SHARED_GENES,
            "MIN_SHARED_COVERAGE": MIN_SHARED_COVERAGE,
            "MIN_SHARED_HITS": MIN_SHARED_HITS,
            "PHENOTYPE": PHENOTYPE,
            "EXPERIMENTAL_SETUP": EXPERIMENTAL_SETUP,
            "CONDITION_NAME": CONDITION_NAME,
            "SCREEN_TYPE": SCREEN_TYPE,
        },
        "excluded_phenotype_note": EXCLUDED_PHENOTYPE_NOTE,
        "units": [asdict(u) for u in units],
    }
    with open(path, "w") as fh:
        json.dump(doc, fh, indent=1, sort_keys=False)
    return doc


# ---------------------------------------------------------------------------
# Load
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def load(path: str = ARTIFACT) -> Benchmark:
    """Load the built benchmark. Cheap: metadata and counts only, no gene rows."""
    with open(path) as fh:
        doc = json.load(fh)
    if doc["schema_version"] != SCHEMA_VERSION:
        raise RuntimeError(
            f"artifact schema {doc['schema_version']} != expected {SCHEMA_VERSION}; rebuild"
        )
    units = tuple(ReplicationPair(**u) for u in doc["units"])
    meta = {k: v for k, v in doc.items() if k != "units"}
    return Benchmark(meta=meta, all_units=units)


def pairs(split: str | None = None) -> tuple[ReplicationPair, ...]:
    """Evaluation units, optionally restricted to one split."""
    return load().units(split)


def _assert_shared_space(df, unit: ReplicationPair, what: str) -> None:
    """Fail loudly if a read does not match the shared space recorded at build.

    A stale artifact against a rebuilt cache, or a regression in the
    deduplication, would otherwise show up as a quietly wrong denominator in
    every score. Better to refuse than to report a number nobody can reproduce.
    """
    n = len(df)
    if n != unit.n_shared_genes:
        raise RuntimeError(
            f"{unit.unit_id}: {what} returned {n} genes but the artifact records "
            f"{unit.n_shared_genes}. The parsed cache and _pairs_v1.json disagree; "
            f"rebuild with `python -m splicr.replication.dataset build`."
        )
    if df["gene"].duplicated().any():
        raise RuntimeError(f"{unit.unit_id}: {what} returned duplicate genes")


def load_pair_inputs(unit: ReplicationPair):
    """Everything a predictor may see for this unit, as a pandas DataFrame.

    Columns: ``gene``, ``a_hit``, ``a_score1``, ``is_common_essential``.
    Restricted to the shared gene space, which is the space the unit is scored
    over. ``gene`` is unique, so merging this against :func:`load_pair_labels`
    on ``gene`` is safe and the row count equals ``unit.n_shared_genes``.

    ``is_common_essential`` is supplied so a caller can restrict to
    :data:`PRIMARY_SPACE` without rebuilding the gene list. It is a gene-level,
    cell-line-independent public list and is not derived from either screen, so
    it is an input and not a label. See :data:`PRIMARY_SPACE` for why the
    restriction matters.

    The query reads rows for ``unit.query_screen`` and joins against the gene
    list of ``unit.target_screen`` to get the shared space. It selects no column
    of the target screen, so the returned frame cannot carry the label. The gene
    list itself is the library intersection, which is a property of the two
    libraries and is announced in ``n_shared_genes``.
    """
    orcs_safe.assert_safe([unit.query_screen, unit.target_screen])
    con = _duck()
    df = con.execute(
        f"""
        select a.gene as gene, a.hit as a_hit, a.score1 as a_score1
        from ({_rows_sql("where screen_id = ?")}) a
        join (select gene from ({_rows_sql("where screen_id = ?")})) b
          on b.gene = a.gene
        order by a.gene
        """,
        [unit.query_screen, unit.target_screen],
    ).fetchdf()
    _assert_shared_space(df, unit, "inputs")
    ce = common_essentials()
    df["is_common_essential"] = [g in ce for g in df["gene"]]
    return df


def load_pair_labels(unit: ReplicationPair, evaluating: bool = False):
    """The label for this unit: ``gene``, ``b_hit`` over the shared gene space.

    Refuses held-out units unless ``evaluating=True``. That is not a security
    boundary, it is a tripwire: a tuning loop that reaches for held-out labels
    raises instead of quietly succeeding, and any call that does pass
    ``evaluating=True`` is visible in a diff.
    """
    if unit.split == "heldout" and not evaluating:
        raise PermissionError(
            f"{unit.unit_id} is held out. Tune on split 'development'. If this really is "
            f"the final evaluation, pass evaluating=True and say so in the write-up."
        )
    orcs_safe.assert_safe([unit.query_screen, unit.target_screen])
    con = _duck()
    df = con.execute(
        f"""
        select b.gene as gene, b.hit as b_hit
        from ({_rows_sql("where screen_id = ?")}) b
        join (select gene from ({_rows_sql("where screen_id = ?")})) a
          on a.gene = b.gene
        order by b.gene
        """,
        [unit.target_screen, unit.query_screen],
    ).fetchdf()
    _assert_shared_space(df, unit, "labels")
    return df


def allowed_background_screens(unit: ReplicationPair) -> tuple[int, ...]:
    """ORCS screens that may be used to fit anything not specific to this unit.

    Removes, for the given unit:

    * both screens of the pair;
    * every screen from either publication, since a same-paper sibling screen is
      a technical replicate of the label;
    * every screen in the same cell line from any publication, since another
      lab's fitness screen of the same line is a third measurement of the same
      quantity and a prior fitted over it is a prior fitted on the label.

    A frequency prior, a co-essentiality graph or a kNN neighbour set built over
    the returned ids cannot contain B. Nothing enforces that a caller uses this
    function, but a caller that does not has to say why.
    """
    idx = screen_index()
    eligible, _ = eligible_screens()
    ban_pubs = {unit.query_publication, unit.target_publication}
    out = []
    for sid in eligible:
        meta = idx[sid]
        if sid in (unit.query_screen, unit.target_screen):
            continue
        if meta["SOURCE_ID"] in ban_pubs:
            continue
        if cell_line_key(meta["CELL_LINE"]) == unit.cell_line_key:
            continue
        out.append(sid)
    return tuple(out)


def forbidden_external(unit: ReplicationPair) -> dict:
    """External resources that would be reading the label for this unit.

    ``depmap_models``: DepMap CRISPRGeneEffect and CRISPRGeneDependency are the
    Broad Avana experiment. 130 of the 133 cell lines in this benchmark are
    DepMap models and 270 of the 276 units resolve to one, so for almost every
    unit DepMap holds a fitness measurement
    of the same cell line, and where the target screen is a Broad Avana screen
    (Meyers 2017, Aguirre 2016) it is a later release of that same screen. Any
    per-cell-line DepMap feature for this model is off limits.

    ``orcs_screens``: the complement of :func:`allowed_background_screens`.

    Cell-line-independent DepMap products such as the inferred common essentials
    list are not listed here, because they are a gene-level summary over about a
    thousand lines and do not identify this unit's label. That is a judgement,
    not a proof, and the spec records it as a residual concern.
    """
    idx = screen_index()
    eligible, _ = eligible_screens()
    allowed = set(allowed_background_screens(unit))
    return {
        "depmap_models": [m for m in [unit.depmap_model] if m],
        "cell_line_key": unit.cell_line_key,
        "orcs_screens": sorted(
            [s for s in eligible if s not in allowed]
            + [unit.query_screen, unit.target_screen]
        ),
        "publications": sorted({unit.query_publication, unit.target_publication}),
        "note": (
            "DepMap CRISPRGeneEffect is the Broad Avana experiment; for this unit's "
            "cell line it is a third measurement of the label, and where the target "
            "screen is Avana it is the label itself."
        ),
    }


# ---------------------------------------------------------------------------
# Base rates
# ---------------------------------------------------------------------------

def base_rates(split: str | None = None, units: Iterable[ReplicationPair] | None = None) -> dict:
    """Per-unit base rates, averaged. Computed from the stored counts, so free.

    ``marginal`` is P(hit in B) over the shared gene space. ``precision`` is
    P(hit in B | hit in A), which is the quantity a method is asked to resolve.
    ``lift`` is their ratio: if it were near 1 the benchmark would not be
    measuring anything.
    """
    us = list(units) if units is not None else list(pairs(split))
    if not us:
        return {}

    def agg(vals: list[float]) -> dict:
        vals = sorted(vals)
        n = len(vals)
        return {
            "n": n,
            "mean": round(sum(vals) / n, 4),
            "median": round(vals[n // 2], 4),
            "p10": round(vals[max(0, int(0.1 * n))], 4),
            "p90": round(vals[min(n - 1, int(0.9 * n))], 4),
        }

    def block(marg, prec, lift, npos):
        return {"marginal": agg(marg), "precision": agg(prec),
                "lift": agg(lift), "n_positives": agg(npos)}

    all_marg = [u.n_target_hits / u.n_shared_genes for u in us]
    all_prec = [u.n_both_hits / u.n_query_hits for u in us]
    nce = [u for u in us if u.n_query_hits_non_essential > 0]
    nce_marg = [u.n_target_hits_non_essential / u.n_shared_genes_non_essential for u in nce]
    nce_prec = [u.n_both_hits_non_essential / u.n_query_hits_non_essential for u in nce]
    return {
        "split": split,
        "n_units": len(us),
        "n_unordered_pairs": len({u.pair_key for u in us}),
        "all_genes": block(
            all_marg, all_prec,
            [p / m for p, m in zip(all_prec, all_marg)],
            [float(u.n_query_hits) for u in us],
        ),
        "non_common_essential_genes": block(
            nce_marg, nce_prec,
            [p / m for p, m in zip(nce_prec, nce_marg)],
            [float(u.n_query_hits_non_essential) for u in nce],
        ),
        "common_essential_share_of_query_hits": agg(
            [1 - u.n_query_hits_non_essential / u.n_query_hits for u in us]
        ),
        "common_essential_share_of_target_hits": agg(
            [1 - u.n_target_hits_non_essential / u.n_target_hits for u in us]
        ),
    }


def excluded_phenotype_audit() -> dict:
    """Re-derive the cost of the unperturbed-proliferation restriction.

    Applies the eligibility rules and the whole pairing rule but matches on
    PHENOTYPE alone, dropping the EXPERIMENTAL_SETUP, CONDITION_NAME and
    SCREEN_TYPE requirements. Returns the pairs that a looser phenotype rule
    would have admitted, grouped by phenotype, with each side's condition and
    NOTES so a reader can check for themselves that they are not comparable.

    This exists so :data:`EXCLUDED_PHENOTYPE_NOTE` is a claim anyone can check
    rather than a number in a comment.
    """
    idx = screen_index()
    counts = _screen_counts()
    base = []
    for sid, meta in sorted(idx.items()):
        n, h = counts.get(sid, (0, 0))
        if meta["THROUGHPUT"] != "High Throughput" or meta["SCREEN_FORMAT"] != "Pool":
            continue
        if meta["FULL_SIZE_AVAILABLE"] != "Yes" or n < MIN_MEASURED_GENES:
            continue
        if h < MIN_HITS or h / n > MAX_HIT_FRACTION:
            continue
        base.append(sid)

    by_phenotype: dict[str, list[dict]] = collections.defaultdict(list)
    for a, b in itertools.combinations(base, 2):
        ma, mb = idx[a], idx[b]
        if ma["PHENOTYPE"] != mb["PHENOTYPE"] or ma["PHENOTYPE"] == PHENOTYPE:
            continue
        if ma["SOURCE_ID"] == mb["SOURCE_ID"]:
            continue
        if first_author_key(ma["AUTHOR"]) == first_author_key(mb["AUTHOR"]):
            continue
        if ma["LIBRARY_TYPE"] != mb["LIBRARY_TYPE"] or ma["LIBRARY"] == mb["LIBRARY"]:
            continue
        if cell_line_key(ma["CELL_LINE"]) != cell_line_key(mb["CELL_LINE"]):
            continue
        by_phenotype[ma["PHENOTYPE"]].append({
            "screens": [a, b],
            "cell_line": ma["CELL_LINE"],
            "authors": [ma["AUTHOR"], mb["AUTHOR"]],
            "conditions": [ma["CONDITION_NAME"], mb["CONDITION_NAME"]],
            "notes": [(ma.get("NOTES") or "")[:200], (mb.get("NOTES") or "")[:200]],
        })
    return {
        "n_additional_pairs": sum(len(v) for v in by_phenotype.values()),
        "by_phenotype": {k: len(v) for k, v in sorted(
            by_phenotype.items(), key=lambda kv: -len(kv[1]))},
        "pairs": dict(by_phenotype),
    }


# ---------------------------------------------------------------------------
# The paired test every claim on this benchmark has to pass
# ---------------------------------------------------------------------------

def paired_test(
    scores_a: dict[str, float],
    scores_b: dict[str, float],
    n_boot: int = 10_000,
    seed: int = 0,
) -> dict:
    """Compare two methods over the same units, resampling by SCREEN PAIR.

    ``scores_a`` and ``scores_b`` map ``unit_id`` to that unit's score, higher
    being better. Both must cover the same units.

    The bootstrap resamples ``pair_key``, not ``unit_id``, because the two
    directions of one screen pair are the same experiment scored twice and are
    strongly dependent. Resampling units would roughly halve the interval and
    overstate significance. The Wilcoxon signed-rank test is likewise run on the
    per-pair mean of the two directions, so n is the number of screen pairs.

    Returns the mean difference, a percentile bootstrap CI, and the Wilcoxon p.
    A difference whose CI crosses zero is not an improvement.
    """
    import random as _random

    import numpy as np

    if set(scores_a) != set(scores_b):
        raise ValueError("the two methods must be scored on exactly the same units")
    by_pair = load()
    unit_pair = {u.unit_id: u.pair_key for u in by_pair.all_units}
    missing = sorted(set(scores_a) - set(unit_pair))
    if missing:
        raise KeyError(f"unknown unit ids: {missing[:5]}")

    grouped: dict[str, list[float]] = collections.defaultdict(list)
    for uid, va in scores_a.items():
        grouped[unit_pair[uid]].append(va - scores_b[uid])
    keys = sorted(grouped)
    per_pair = np.array([float(np.mean(grouped[k])) for k in keys])

    rng = _random.Random(seed)
    n = len(per_pair)
    boots = np.empty(n_boot)
    for i in range(n_boot):
        pick = [rng.randrange(n) for _ in range(n)]
        boots[i] = per_pair[pick].mean()
    lo, hi = float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))

    try:
        from scipy.stats import wilcoxon

        p = float(wilcoxon(per_pair).pvalue) if n > 0 and per_pair.any() else 1.0
    except Exception:
        p = float("nan")

    return {
        "n_screen_pairs": n,
        "n_units": len(scores_a),
        "mean_difference": float(per_pair.mean()),
        "ci95": [lo, hi],
        "wilcoxon_p": p,
        "significant": bool(lo > 0 or hi < 0),
        "resampling_unit": "pair_key",
    }


def average_precision(y_true, score) -> float:
    """Average precision of ``score`` against binary ``y_true``, higher better.

    Ties are broken by the order the caller supplies, which is gene-alphabetical
    as the loaders return it. A method that emits many tied scores is therefore
    scored on an arbitrary but fixed and method-independent tie order, rather
    than on a favourable one.
    """
    import numpy as np

    y = np.asarray(y_true, dtype=float)
    s = np.asarray(score, dtype=float)
    if y.shape != s.shape:
        raise ValueError(f"shape mismatch: labels {y.shape} vs scores {s.shape}")
    if y.sum() == 0:
        return float("nan")
    order = np.argsort(-s, kind="stable")
    y = y[order]
    prec = np.cumsum(y) / np.arange(1, len(y) + 1)
    return float((prec * y).sum() / y.sum())


def evaluate(
    unit: ReplicationPair,
    score,
    space: str = PRIMARY_SPACE,
    evaluating: bool = False,
) -> dict:
    """Score one unit's prediction, restricted to ``space``.

    ``score`` is one number per gene, in the gene order that
    :func:`load_pair_inputs` returned, higher meaning more likely to replicate.
    The restriction to ``space`` is applied here rather than by the caller, so
    the headline cannot drift back to the full gene space by accident.

    Returns the method's average precision alongside the two baselines any claim
    has to clear: a random ranking, and screen A's own binary hit call.
    """
    import numpy as np

    if space not in GENE_SPACES:
        raise ValueError(f"unknown space {space!r}; choose from {GENE_SPACES}")
    inputs = load_pair_inputs(unit)
    labels = load_pair_labels(unit, evaluating=evaluating)
    s = np.asarray(score, dtype=float)
    if len(s) != len(inputs):
        raise ValueError(
            f"{unit.unit_id}: got {len(s)} scores for {len(inputs)} genes; score must be "
            f"in the gene order load_pair_inputs returned"
        )
    merged = inputs.merge(labels, on="gene", validate="one_to_one")
    sel = np.ones(len(merged), bool) if space == "all" else ~merged["is_common_essential"].to_numpy()
    y = merged["b_hit"].to_numpy()[sel]
    return {
        "unit_id": unit.unit_id,
        "pair_key": unit.pair_key,
        "space": space,
        "n_genes": int(sel.sum()),
        "n_positives": int(y.sum()),
        "average_precision": average_precision(y, s[sel]),
        "baseline_random": float(y.mean()),
        "baseline_a_hit": average_precision(y, merged["a_hit"].to_numpy().astype(float)[sel]),
    }


def marginal_baseline(unit: ReplicationPair) -> float:
    """Average precision of a random ranking: the floor any method must clear.

    For a ranking with no information, expected average precision is the
    positive rate, which here is ``unit.target_hit_rate``.
    """
    return unit.target_hit_rate


def describe() -> str:
    """A human-readable audit of the built benchmark."""
    b = load()
    m = b.meta
    out = [
        f"replication benchmark v{m['schema_version']}  ORCS {m['orcs_release']}  "
        f"exclusion policy {m['orcs_exclusion_policy']}",
        f"  safe screens {m['n_safe_screens']}",
        "  eligibility funnel:",
    ]
    for k, v in m["eligibility_funnel"].items():
        out.append(f"    {v:>7}  {k}")
    out.append("  pairing funnel:")
    for k, v in m["pairing_funnel"].items():
        out.append(f"    {v:>7}  {k}")
    out.append("  overlap funnel:")
    for k, v in m["overlap_funnel"].items():
        out.append(f"    {v:>7}  {k}")
    out.append(
        f"  unordered pairs {m['n_unordered_pairs']}  units {m['n_units']}  "
        f"dropped crossing the split {m['n_pairs_dropped_crossing_split']}"
    )
    out.append(f"  split rule: {m['split_rule']}")
    for split in SPLITS:
        us = b.units(split)
        pubs = sorted({u.query_publication for u in us} | {u.target_publication for u in us})
        lines = sorted({u.cell_line for u in us})
        out.append(
            f"  {split:<12} units {len(us):>4}  pairs {len({u.pair_key for u in us}):>4}  "
            f"publications {len(pubs):>3}  cell lines {len(lines):>3}"
        )
        r = base_rates(split)
        for name in ("non_common_essential_genes", "all_genes"):
            blk = r[name]
            tag = name + (" [PRIMARY]" if name.startswith("non_common") else "")
            out.append(
                f"      {tag:<38} marginal {blk['marginal']['mean']:.4f}  "
                f"precision {blk['precision']['mean']:.4f}  lift {blk['lift']['mean']:.2f}  "
                f"positives {blk['n_positives']['mean']:.0f}"
            )
    d = m.get("deduplication")
    if d:
        out.append(
            f"  one row per (screen, gene): {d['n_screen_gene_groups']:,} genes from "
            f"{d['n_orcs_rows']:,} ORCS rows; {d['n_groups_with_repeats']:,} repeated, "
            f"{d['n_groups_contradicting_themselves']:,} dropped for contradicting themselves"
        )
    out.append(f"  primary gene space: {PRIMARY_SPACE}")
    return "\n".join(out)


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "build":
        doc = build()
        print(f"wrote {ARTIFACT}: {doc['n_unordered_pairs']} pairs, {doc['n_units']} units")
    print(describe())
