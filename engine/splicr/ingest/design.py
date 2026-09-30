"""
Design inference: from run metadata to a StudyPlan the pipeline can run unattended.

    plan_study(candidate, runs) -> StudyPlan

For every run: which role its sample plays (plasmid pool, T0 reference,
vehicle/unsorted control, treated/sorted/late endpoint, or not part of the
screen at all), with a confidence and the words that decided it. From the
roles: the contrasts (dropout, drug modifier, positive selection, sorting),
each validated by splicr.design.build_design exactly as the pipeline will
validate it. Plus modality, phenotype, library hint, and the cell line and
compound hard-mapped through splicr.harmonize.

THE ONE RULE: A WRONG PLAN MARKED READY IS THE EXPENSIVE ERROR.

A needs_review plan costs a person a minute. A confidently wrong one costs a
download, a pipeline run and a published gene list with the contrast upside
down, and nobody is asked. So every inference here is allowed to say "I don't
know": a run whose role is not stated in its name or GEO characteristics gets
role "exclude" with confidence 0 and blocks readiness; ambiguity anywhere
(two cell lines, two modalities, an agent that is neither a ChEMBL compound
nor a known selection) becomes a plain-language issue, and any issue means
needs_review. "ready" requires every run placed with confidence >= 0.8, at
least one valid contrast, a known modality, verifiable FASTQs, and a cell
line mapped to Cellosaurus.

Vocabulary is read off real deposits (GSE145743's "GeCKO-A input control, Day
0", "GeCKO-A_DMSO-1, Day 14", "GeCKO-A plasmid library"; the Broad GPP naming
of pDNA and early time points; sort-screen "high/low/unsorted" bins). Patterns
are narrow on purpose, like splicr.design's: an absent match asks a question,
a wrong match changes the answer.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any

from .. import design as screen_design
from .models import Contrast, RunRecord, SampleRole, StudyCandidate, StudyPlan

READY_CONFIDENCE = 0.8
SUPPORTED_TAXA = {9606, 10090}
SYNTHETIC = 32630

# ---------------------------------------------------------------------------
# Vocabulary
# ---------------------------------------------------------------------------

_S = r"(?<![a-z0-9])"   # "_" and "-" are separators in sample names; \b disagrees
_E = r"(?![a-z0-9])"


def _rx(p: str) -> re.Pattern:
    return re.compile(p, re.I)


PLASMID = _rx(_S + r"(plasmids?|pdna|plasmid[ _-]?(library|pool|dna)|library[ _-]?(plasmid|pool|dna|representation)|"
              r"sgrna[ _-]?virus|lib(rary)?[ _-]?(pool|plasmid))" + _E)
BASELINE = _rx(_S + r"(t0|d0|tp0|day[ _-]?0|days?[ _-]?0|time[ _-]?(point[ _-]?)?0|0[ _-]?d(ays?)?|input|baseline|"
               r"initial|pre[ _-]?selection|pre[ _-]?treatment|before[ _-]?(selection|treatment|infection)|"
               r"pre[ _-]?infection|pre[ _-]?kill|early[ _-]?time[ _-]?point|starting[ _-]?population|"
               r"transduced[ _-]?(cell[ _-]?)?population|reference)" + _E)
UNSORTED = _rx(_S + r"(unsorted|un[ _-]sorted|pre[ _-]?sort|presorted|bulk|unselected)" + _E)
VEHICLE = _rx(_S + r"(dmso|vehicle|veh|untreated|un[ _-]treated|mock|pbs|etoh|ethanol|no[ _-]?(drug|treatment)|"
              r"uninfected|unstimulated|nostim|non[ _-]?treated|ctrl|control|water|h2o|saline|0[ _-]?(nm|um|µm))" + _E)
SORT_HIGH = _rx(_S + r"(high|hi|top|bright|positive|pos|upper)" + _E + r"|\+")
SORT_LOW = _rx(_S + r"(low|lo|bottom|dim|negative|neg|lower)" + _E)
SORTED = _rx(_S + r"(sorted|facs|sort|bin[ _-]?\d)" + _E)
SELECTION = _rx(_S + r"(infected|infection|virus|viral|survivors?|surv|surviv\w+|resistant|selected|selection|"
                r"round[ _-]?\d|rd[ _-]?\d|toxin|irradiat\w*|ir|radiation|nk|t[ _-]?cells?|co[ _-]?culture|"
                r"ifn\w*|tnf\w*|stim\w*|sars[ _-]?cov[ _-]?2?|influenza|iav|hiv|zika|dengue|ebv|kshv|yfv|wnv|"
                r"moi[ _-]?[\d.]+)" + _E)
# Sequencing / sample-sheet noise that is never a condition.
NOISE = _rx(_S + r"(s\d{1,3}|l00\d|r[12]_00\d|r[12]|00\d|fastq|gz|seq|sequencing|sgrna|grna|guide|crispr|cas9|"
            r"screen|screening|sample|samples|cells?|cell[ _-]?line|population|harvest(ed)?|treated|treatment|"
            r"with|and|of|the|for|in|at|library|lib|gdna|dna|genomic|amplicon|pcr|ko|knockout|genome|wide|"
            r"genomewide|replicate|rep|biological|biol|technical|tech|condition|group|arm|timepoint|time|point|day|days|"
            r"week|weeks|hour|hours|h|d|t|p|passage|lane|sgrnas|grnas|post|pre|run|sequenced|dup|dupl|duplicate)" + _E)
OMICS_RUN = _rx(_S + r"(rna[ _-]?seq|chip[ _-]?seq|chip|atac[ _-]?seq|atac|cut[ _&-]?(and[ _-]?)?(run|tag)|"
                r"scrna[ _-]?seq|scrna|10x|single[ _-]?cell|hi[ _-]?c|ribo[ _-]?seq|rpf|wes|wgs|"
                r"input[ _-]?dna|h3k\d+\w*|igg|bisulfite|methylation)" + _E)
OMICS_STRATEGIES = {"RNA-SEQ", "CHIP-SEQ", "ATAC-SEQ", "BISULFITE-SEQ", "HI-C", "MIRNA-SEQ", "NCRNA-SEQ",
                    "RIP-SEQ", "SSRNA-SEQ", "MNASE-SEQ", "DNASE-HYPERSENSITIVITY", "MEDIP-SEQ", "CHIA-PET",
                    "FAIRE-SEQ", "WXS", "TN-SEQ", "EST", "FL-CDNA", "SNRNA-SEQ", "SCRNA-SEQ"}
SCREEN_STRATEGIES = {"AMPLICON", "OTHER", "WGS", "TARGETED-CAPTURE", "CRISPR SCREEN", "SYNTHETIC-LONG-READ"}

PART = _rx(r"(?:" + _S + r"(?:gecko(?:v2)?|lib(?:rary)?|set|half|sub[ _-]?library|pool|library[ _-]?set)"
           r"|(?:calabrese|dolcetto)[ _-]?set)[ _-]?([ab])" + _E)
DOSE = _rx(r"\d+(\.\d+)?[ _-]?(nm|um|µm|μm|mm|ug/ml|µg/ml|ng/ml|mg/kg|gy|%)")
# Ordered: "day 14" beats "14 d", so "GSC-0131_Day_0" is day 0 and not day 131.
TIMEPOINT_FORMS = (
    ("d", 1.0, _rx(_S + r"(?:day|days)[ _-]?(\d+)" + _E)),
    ("d", 1.0, _rx(_S + r"d[ _-]?(\d+)" + _E)),
    ("w", 7.0, _rx(_S + r"(?:week|wk)[ _-]?(\d+)" + _E)),
    ("d", 1.0, _rx(_S + r"(\d{1,2})[ _-]?(?:days?|d)" + _E)),
    ("w", 7.0, _rx(_S + r"(\d{1,2})[ _-]?(?:weeks?|wks?)" + _E)),
    ("h", 1 / 24, _rx(_S + r"(\d{1,3})[ _-]?(?:h|hr|hrs|hours?)" + _E)),
    ("t", None, _rx(_S + r"(?:t|tp)[ _-]?(\d+)" + _E)),
    ("p", None, _rx(_S + r"(?:passage|p)[ _-]?(\d+)" + _E)),
)
TIMEPOINT = re.compile("|".join(f"(?:{rx.pattern})" for _, _, rx in TIMEPOINT_FORMS), re.I)
# GEO titles often end in a bracketed submitter id ("DMSO day 14 [S2DMSOA9]").
BRACKET_ID = re.compile(r"\s*[\[(][^\])]*[\])]\s*$")
SORT_MARKER = _rx(r"([a-z0-9]+(?:[-][a-z0-9]+)?)[ _-]?(?:high|low|hi|lo|pos|neg|positive|negative|bright|dim)" + _E)
REPLICATE = _rx(_S + r"(?:(?:bio(?:logical)?|tech(?:nical)?)?[ _-]?(?:replicate|rep|r|br)[ _.#-]?(\d+|[a-d])|#(\d+))" + _E)
TRAILING_REP = _rx(r"[ _.#-](\d{1,2}|[a-d])\s*$")

MODALITY_RULES = (
    ("base_edit", _rx(r"base[ -]?edit\w*|\bbe3\b|\bbe4\w*|\babe\d*\w*\b|\bcbe\b|cytosine base|adenine base|ancbe")),
    ("crispri", _rx(r"crispri\b|crispr interference|dcas9[- ]?krab|\bkrab\b|dolcetto|crispr-?i\b")),
    ("crispra", _rx(r"crispra\b|crispr activation|dcas9[- ]?vp64|\bvp64\b|\bvpr\b|synergistic activation mediator|"
                    r"\bsam\b library|calabrese|crispr-?a\b|suntag")),
    ("knockout_cas12a", _rx(r"cas12a|cpf1|humagne")),
    ("knockout", _rx(r"knock-?out|\bko\b|gecko|brunello|tkov3|avana|\bbrie\b|yusa|kosuke|lenticrispr|"
                     r"loss[- ]of[- ]function|minlibcas9|cas9|crispr/cas9|crispr-cas9")),
)
LIBRARY_HINTS = (
    ("brunello", r"brunello"), ("brie", r"\bbrie\b"), ("geckov2", r"gecko\s*v?2|gecko"),
    ("tkov3", r"tko\s*v?3|toronto knockout"), ("avana", r"avana"), ("dolcetto", r"dolcetto"),
    ("calabrese", r"calabrese"), ("gattinara", r"gattinara"), ("gouda", r"gouda"),
    ("yusa", r"yusa|kosuke"), ("minlibcas9", r"minlibcas9"), ("h1_library", r"\bh1 library"),
    ("sam", r"\bsam\b library"), ("epigenetic_library", r"epigenetic library"),
)
PRIMARY = _rx(r"\bprimary\b|\bdonor\b|\bpbmc|patient[- ]derived|\bpdx\b|organoid|in vivo|xenograft|"
              r"\bmice\b|\bmouse (tumou?r|model)|bone marrow|\bbmdm|\bhspc|cd34\+|\bcd[48]\+? t cells")
# "n/a" resolves to a real Cellosaurus line (NA, a neuroblastoma), so
# placeholder values are dropped before anything is looked up.
_PLACEHOLDER = _rx(r"n/?a|none|not applicable|unknown|missing|-+|\.|plasmid.*|library.*|none provided")
CELL_KEYS = ("cell line", "cell_line", "cellline", "cell line name", "cell", "cell type", "cell_type",
             "source_name")
ROLE_KEYS = ("treatment", "agent", "drug", "compound", "condition", "time", "time point", "timepoint",
             "sort", "facs", "population", "fraction", "selection", "infection", "virus", "stimulation",
             "sample type", "phenotype", "day", "library", "sublibrary", "sub-library", "library set",
             "screen", "group", "arm", "dose", "passage")


# ---------------------------------------------------------------------------
# Per-run features
# ---------------------------------------------------------------------------

@dataclass
class _Run:
    rec: RunRecord
    text: str                        # title + role-relevant characteristics, lowercased
    title: str
    part: str | None = None
    tp: str | None = None
    tp_days: float | None = None
    rep: str | None = None
    marker: str | None = None
    kind: str = "unknown"           # plasmid|baseline|unsorted|vehicle|sort_high|sort_low|sorted|agent|selection|late|omics|unknown
    agent: str | None = None
    compound: tuple[str, str] | None = None     # (raw, CHEMBL id)
    context: str = ""
    evidence: list[str] = field(default_factory=list)
    conf: float = 0.0
    label: str = ""


import contextvars

_SORTING_STUDY: contextvars.ContextVar[bool] = contextvars.ContextVar("sorting_study", default=True)
SORT_STUDY = _rx(r"\b(facs|flow[ -]?cytometr\w*|sort(ed|ing)?|gated?|bins?|mfi|reporter)\b")
# Submitter ids ("IH24", "S2DMSOA9", "AB9355"): letters and digits run together.
_ID_LIKE = re.compile(r"(?=.*[a-z])(?=.*\d)[a-z0-9]{3,}")


def _role_text(r: RunRecord) -> str:
    parts = [r.sample_title]
    for k, v in r.characteristics.items():
        if k.startswith("ena_"):
            continue
        if any(k == rk or k.startswith(rk) for rk in ROLE_KEYS):
            parts.append(f"{k}: {v}")
    return " | ".join(parts)


def _timepoint(text: str) -> tuple[str | None, float | None]:
    for unit, scale, rx in TIMEPOINT_FORMS:
        m = rx.search(text)
        if m:
            n = int(m[1])
            if unit == "h":
                return f"h{n}", n * scale
            return f"{unit}{n}", (n * scale if scale else None)
    return None, None


def _part(r: RunRecord, text: str) -> str | None:
    for k in ("library", "sublibrary", "sub-library", "library set", "half-library"):
        v = (r.characteristics.get(k) or "").strip()
        m = re.fullmatch(r"(?:set|library|lib|half)?[ _-]?([ab])", v, re.I)
        if m:
            return m[1].upper()
    m = PART.search(text)
    return m[1].upper() if m else None


def _replicate(title: str) -> str | None:
    t = DOSE.sub(" ", TIMEPOINT.sub(" ", PART.sub(" ", BRACKET_ID.sub("", title))))
    m = REPLICATE.search(t)
    if m:
        return (m[1] or m[2]).upper()
    m = TRAILING_REP.search(re.sub(r"[\s,;:()\[\]]+$", "", t))
    return m[1].upper() if m else None


def _residual_tokens(title: str) -> list[str]:
    """Title tokens left after removing parts, times, doses, replicates and role/noise words."""
    sorting = _SORTING_STUDY.get()
    t = BRACKET_ID.sub(" ", title.lower())
    if sorting:
        t = SORT_MARKER.sub(" ", t)
    for rx in (PART, DOSE, TIMEPOINT, REPLICATE, PLASMID, BASELINE, UNSORTED, VEHICLE, SORTED):
        t = rx.sub(" ", t)
    t = TRAILING_REP.sub(" ", re.sub(r"[\s,;:()\[\]]+$", "", t))
    toks = []
    for tok in re.split(r"[^a-z0-9+]+", t):
        tok = tok.strip("+")
        if not tok or NOISE.fullmatch(tok) or re.fullmatch(r"\d{1,2}", tok) or len(tok) == 1:
            continue
        if sorting and (SORT_HIGH.fullmatch(tok) or SORT_LOW.fullmatch(tok)):
            continue
        toks.append(tok)
    return toks


def _compound(token: str) -> tuple[str, str] | None:
    if len(token) < 4 or re.fullmatch(r"[\d.]+", token):
        return None
    try:
        from .. import harmonize
        res = harmonize.compounds().resolve(token)
    except Exception:  # noqa: BLE001 - reference data missing: no compound mapping, not a crash
        return None
    return (token, res.id) if res.ok and res.id else None


def _features(r: RunRecord) -> _Run:
    text = _role_text(r)
    low = text.lower()
    f = _Run(rec=r, text=low, title=r.sample_title or r.run)
    f.part = _part(r, low)
    f.tp, f.tp_days = _timepoint(low)
    f.rep = _replicate(f.title)

    # Explicit role words, most specific first. Conflicts are recorded, not
    # silently resolved, and lower the confidence below the ready bar.
    hits = []
    if PLASMID.search(low):
        hits.append("plasmid")
    if BASELINE.search(low) or (f.tp_days == 0.0):
        hits.append("baseline")
    if UNSORTED.search(low):
        hits.append("unsorted")
    bare = BRACKET_ID.sub("", f.title.lower())
    hi, lo = bool(SORT_HIGH.search(bare)), bool(SORT_LOW.search(bare))
    # "High"/"Low" is a sort bin only in a study that sorts; in an NK-cell
    # screen it is the effector:target ratio. `sorting_study` is set by the caller.
    if not _SORTING_STUDY.get():
        hi = lo = False
    m = SORT_MARKER.search(bare)
    f.marker = m[1] if m and (hi or lo) else None
    if SORTED.search(low) or hi or lo:
        hits.append("sort_high" if hi and not lo else "sort_low" if lo and not hi else "sorted")
    if VEHICLE.search(low):
        hits.append("vehicle")
    if SELECTION.search(low):
        hits.append("selection")

    residual = _residual_tokens(f.title)
    # Agents declared in characteristics outrank title tokens.
    declared = None
    for k in ("treatment", "agent", "drug", "compound", "selection", "infection", "virus"):
        v = r.characteristics.get(k)
        if v and not VEHICLE.search(v) and not BASELINE.search(v) and not PLASMID.search(v):
            declared = v.strip()
            break
    for tok in ([declared] if declared else []) + residual:
        c = _compound(re.sub(r"[^a-z0-9-]", "", tok.lower()))
        if c:
            f.compound, f.agent = c, tok
            break
    if f.compound:
        hits.append("agent")
    elif declared and "vehicle" not in hits:
        f.agent = declared
        hits.append("declared_agent")

    # What is left of the title once the agent is removed is the context
    # (cell line, genotype, reporter): runs are only compared within one.
    ctx = [t for t in residual if not (f.agent and t in f.agent.lower()) and not SELECTION.fullmatch(t)]
    if f.tp:
        # "A549sgNegTSGT1": the time point glued onto the sample token would
        # make T0 and T1 of one arm two different contexts.
        ctx = [t[: -len(f.tp)] if t.endswith(f.tp) and len(t) > len(f.tp) + 2 else t for t in ctx]
    f.context = "_".join(sorted(set(ctx)))
    f.evidence = hits
    return f


def _refine_contexts(feats: list[_Run]) -> None:
    """
    Two corrections that need the whole study in view.

    A token that looks like a submitter id and occurs in one run only
    ("IH24_S37_R1_001") is a sample name, not a condition, so it leaves the
    context; otherwise every run is its own stratum and nothing pairs.
    A sort marker ("IFNG" in "Donor1_IFNG_high") goes back into the context
    when other runs name it too ("Donor1_IFNG_unsorted"): then it
    distinguishes two sorts in one study rather than labelling one.
    """
    counts = Counter(t for f in feats for t in set(f.context.split("_")) if t)
    other_tokens = Counter(t for f in feats if not f.marker for t in set(f.context.split("_")) if t)
    for f in feats:
        toks = [t for t in f.context.split("_") if t and not (counts[t] == 1 and _ID_LIKE.fullmatch(t))]
        if f.marker and other_tokens.get(f.marker):
            toks.append(f.marker)
        f.context = "_".join(sorted(set(toks)))


def _assign(f: _Run, study: dict[str, Any]) -> None:
    """Role kind and confidence for one run, given study-wide facts."""
    h = f.evidence
    ev = []
    if "plasmid" in h:
        f.kind, f.conf = "plasmid", 0.95 if len(set(h) - {"plasmid", "vehicle"}) == 0 else 0.5
        ev.append("name says plasmid / library pool")
    elif "baseline" in h:
        conflicting = set(h) & {"agent", "sort_high", "sort_low", "sorted"}
        f.kind, f.conf = "baseline", 0.5 if conflicting else 0.9
        ev.append("name says day 0 / T0 / input / pre-selection")
        if conflicting:
            ev.append(f"but also names {sorted(conflicting)}; not sure which")
    elif "unsorted" in h:
        f.kind, f.conf = "unsorted", 0.9
        ev.append("name says unsorted / pre-sort")
    elif set(h) & {"sort_high", "sort_low", "sorted"}:
        k = next(x for x in ("sort_high", "sort_low", "sorted") if x in h)
        f.kind, f.conf = k, 0.85
        ev.append({"sort_high": "sorted high bin", "sort_low": "sorted low bin", "sorted": "sorted population"}[k])
    elif "agent" in h and "vehicle" not in h:
        f.kind, f.conf = "agent", 0.9
        ev.append(f"treated with {f.agent} (ChEMBL {f.compound[1]})")
    elif "vehicle" in h and "agent" not in h:
        f.kind, f.conf = "vehicle", 0.9
        ev.append("name says vehicle / DMSO / untreated / control")
    elif "selection" in h and "vehicle" not in h:
        f.kind, f.conf = "selection", 0.85
        ev.append("name says infected / selected / survivors / stimulated")
    elif "declared_agent" in h:
        f.kind, f.conf = "agent", 0.6
        ev.append(f"treatment '{f.agent}' is declared but is not a ChEMBL compound or a known selection")
    elif "agent" in h and "vehicle" in h:
        f.kind, f.conf = "agent", 0.6
        ev.append(f"names both {f.agent} and a vehicle/control word")
    elif ((f.tp_days and f.tp_days > 0) or (f.tp and f.tp.startswith("t") and f.tp != "t0")) \
            and study["has_reference"] and not study["has_arms"]:
        # A plain dropout screen: plasmid/T0 plus later time points, nothing else.
        f.kind, f.conf = "late", 0.85
        ev.append(f"later time point ({f.tp}) in a plain dropout design")
    else:
        f.kind, f.conf = "unknown", 0.0
        ev.append("role not stated in the sample name or GEO characteristics")
    if f.tp:
        ev.append(f"time point {f.tp}")
    if f.part:
        ev.append(f"half-library {f.part}")
    f.evidence = ev


_ROLE_OF = {"plasmid": "plasmid", "baseline": "reference", "unsorted": "control", "vehicle": "control",
            "agent": "treatment", "selection": "treatment", "sort_high": "treatment",
            "sort_low": "treatment", "sorted": "treatment", "late": "treatment",
            "omics": "exclude", "unknown": "exclude", "nofastq": "exclude"}


def _safe_label(s: str) -> str:
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", s.strip()).strip("._-")
    s = re.sub(r"_+", "_", s)
    return s[:80] or "sample"


# ---------------------------------------------------------------------------
# Study-level inference
# ---------------------------------------------------------------------------

def _study_text(c: StudyCandidate, series: dict[str, Any] | None) -> str:
    s = series or {}
    return "\n".join([c.title or "", c.summary or "", s.get("summary", ""), s.get("overall_design", "")])


def _modality(text: str) -> tuple[str | None, list[str]]:
    found = [name for name, rx in MODALITY_RULES if rx.search(text)]
    if "base_edit" in found:
        return "base_edit", []
    ia = [m for m in found if m in ("crispri", "crispra")]
    if len(ia) == 2:
        return None, ["the study describes both CRISPRi and CRISPRa screens; runs must be split by "
                      "modality before analysis"]
    if ia:
        return ia[0], []
    if "knockout_cas12a" in found:
        return "knockout_cas12a", []
    if "knockout" in found:
        return "knockout", []
    return None, ["the modality (knockout / CRISPRi / CRISPRa / base editing) is not stated"]


def _library_hint(text: str) -> str | None:
    hits = [name for name, p in LIBRARY_HINTS if re.search(p, text, re.I)]
    return ", ".join(dict.fromkeys(hits)) or None


def _cell_line(c: StudyCandidate, runs: list[_Run], text: str) -> tuple[str | None, str | None, list[str]]:
    values = Counter()
    for f in runs:
        if f.kind == "plasmid":
            continue  # the plasmid pool never saw a cell; its "cell line: n/a" is not a vote
        for k in CELL_KEYS:
            v = f.rec.characteristics.get(k)
            if v and not _PLACEHOLDER.fullmatch(v.strip()):
                values[re.sub(r"\s+cells?$", "", v.strip(), flags=re.I)] += 1
                break
    issues: list[str] = []
    candidates = [v for v, _ in values.most_common()]
    distinct = {re.sub(r"[^a-z0-9]", "", v.lower()) for v in candidates}
    if len(distinct) > 1:
        # Checked before any lookup: an unresolvable second line ("iMAC") must
        # not vanish and leave the other line's RRID on the whole plan.
        return "; ".join(candidates), None, [f"several cell lines in one study ({'; '.join(candidates)}); "
                                             "the plan needs one per cell line"]
    if not candidates:
        m = re.findall(r"\b(?:in|of|using|with|from)\s+([A-Z0-9][A-Za-z0-9.-]{1,14})\s+(?:cells|cell line)", text)
        candidates = list(dict.fromkeys(m))
    if PRIMARY.search(text + " " + " ".join(candidates)):
        return (candidates[0] if candidates else None), None, ["no RRID: primary cells"]
    if not candidates:
        return None, None, ["the cell line is not stated in the GEO characteristics or the summary"]
    try:
        from .. import harmonize
        resolver = harmonize.cell_lines()
    except Exception as e:  # noqa: BLE001
        return candidates[0], None, [f"cell line '{candidates[0]}' could not be resolved: {e}"]
    resolved = {}
    for v in candidates:
        res = resolver.resolve(v)
        if not res.ok and res.status != "ambiguous":
            # "HCT116 colon cancer cell line", "HeLa cells": try the name alone.
            short = re.sub(r"\s+(cells?|cell line|[a-z ]*cell line|derived.*|expressing.*|stably.*)$", "", v, flags=re.I)
            first = short.split()[0] if short.split() else short
            for alt in dict.fromkeys([short, first]):
                if alt and alt != v and (re.search(r"\d", alt) or len(alt) >= 4):
                    r2 = resolver.resolve(alt)
                    if r2.ok:
                        res = r2
                        break
        if res.ok:
            resolved[v] = res.id
        elif res.status == "ambiguous":
            issues.append(f"cell line '{v}' is ambiguous in Cellosaurus ({', '.join(res.candidates[:5])})")
    ids = set(resolved.values())
    if len(ids) > 1:
        return "; ".join(resolved), None, [f"several cell lines in one study ({'; '.join(resolved)}); "
                                           "the plan needs one per cell line"]
    if len(ids) == 1:
        raw = next(iter(resolved))
        return raw, next(iter(ids)), []
    return candidates[0], None, issues or [f"cell line '{candidates[0]}' is not in Cellosaurus"]


def plan_study(c: StudyCandidate, runs: list[RunRecord], series: dict[str, Any] | None = None) -> StudyPlan:
    """
    Infer the full design. Never raises on odd metadata; it returns a plan whose
    status and issues say what is wrong.

    `series` is GEO's series-level text (metadata.series_info). When omitted for a
    GSE it is fetched, so the overall design and supplementary files are used.
    """
    from . import classify as _classify

    if series is None and c.accession.startswith("GSE"):
        try:
            from .metadata import series_info
            series = series_info(c.accession)
        except Exception:  # noqa: BLE001 - offline: plan from what we have
            series = {}
    series = series or {}
    text = _study_text(c, series)
    plan = StudyPlan(accession=c.accession, taxid=c.taxid, runs=list(runs))
    plan.library_hint = _library_hint(text + " " + " ".join(r.sample_title for r in runs))
    if series.get("supplementary"):
        from .metadata import _COUNT_TABLE
        plan.supplementary_count_tables = [u for u in series["supplementary"]
                                           if _COUNT_TABLE.search(u.rsplit("/", 1)[-1])]
        if plan.supplementary_count_tables:
            plan.notes.append("GEO has depositor count table(s) to cross-check against: "
                              + ", ".join(u.rsplit("/", 1)[-1] for u in plan.supplementary_count_tables))

    # --- hard stops -----------------------------------------------------------
    if not runs:
        plan.status = "unsupported"
        plan.issues.append("no raw reads: ENA has no runs for this study (processed data only, a GEO "
                           "SuperSeries, or not yet mirrored)")
        return plan
    all_text = text + "\n" + "\n".join(_role_text(r) for r in runs)
    if _classify.SINGLE_CELL.search(all_text) or any(
            (r.characteristics.get("ena_experiment_title") or "").lower().count("single cell") for r in runs):
        plan.status = "unsupported"
        plan.issues.append("single-cell readout (Perturb-seq / CROP-seq class); the bulk count "
                           "pipeline cannot analyse it")
        return plan
    taxa = Counter(int(r.characteristics["ena_tax_id"]) for r in runs
                   if str(r.characteristics.get("ena_tax_id", "")).isdigit())
    real = {t: n for t, n in taxa.items() if t != SYNTHETIC}
    if real:
        plan.taxid = max(real, key=real.get)
    if plan.taxid is not None and plan.taxid not in SUPPORTED_TAXA:
        plan.status = "unsupported"
        names = {r.characteristics.get("ena_scientific_name") for r in runs} - {None}
        plan.issues.append(f"unsupported organism: {', '.join(sorted(names)) or plan.taxid} "
                           "(libraries exist for human and mouse only)")
        return plan
    if plan.taxid is None:
        plan.issues.append("organism unknown: the runs are filed as synthetic construct and the study "
                           "names no organism")

    # --- per-run features --------------------------------------------------------
    sorting = bool(SORT_STUDY.search(text) or any(
        SORT_STUDY.search(" ".join(f"{k} {v}" for k, v in r.characteristics.items() if not k.startswith("ena_"))
                          + " " + r.sample_title) for r in runs))
    token = _SORTING_STUDY.set(sorting)
    try:
        feats = [_features(r) for r in runs]
    finally:
        _SORTING_STUDY.reset(token)
    _refine_contexts(feats)
    strategies = {(r.library_strategy or "").upper() for r in runs}
    mixed = bool(strategies & OMICS_STRATEGIES) and bool(strategies & SCREEN_STRATEGIES)
    for f in feats:
        strat = (f.rec.library_strategy or "").upper()
        molecule = (f.rec.characteristics.get("molecule") or "").lower()
        if not f.rec.fastq_urls:
            f.kind, f.conf, f.evidence = "nofastq", 0.95, ["ENA lists no FASTQ for this run"]
        elif (mixed and strat in OMICS_STRATEGIES) or (
                OMICS_RUN.search(f.title) and not PLASMID.search(f.title)
                and (mixed or "rna" in molecule)):
            f.kind, f.conf = "omics", 0.95
            f.evidence = [f"not part of the screen: library strategy {f.rec.library_strategy}, "
                          f"sample '{f.title}'"]
    screen_feats = [f for f in feats if f.kind not in ("omics", "nofastq")]
    if not screen_feats:
        plan.status = "unsupported"
        plan.issues.append("no screen runs: every run is RNA-seq / ChIP / ATAC or lacks FASTQ files")
        _finish_roles(plan, feats)
        return plan
    if strategies and strategies <= OMICS_STRATEGIES:
        plan.issues.append(f"every run is filed as {sorted(strategies)}; guide amplicons are sometimes "
                           "mislabelled so, but check the reads before trusting this plan")

    pre = {"has_reference": any(f.evidence and set(f.evidence) & {"plasmid", "baseline"} for f in screen_feats),
           "has_arms": any(set(f.evidence) & {"agent", "declared_agent", "vehicle", "selection", "unsorted",
                                               "sort_high", "sort_low", "sorted"} for f in screen_feats)}
    for f in screen_feats:
        _assign(f, pre)

    parts = {f.part for f in screen_feats}
    if len(parts) > 1 and None in parts:
        plan.issues.append("some runs name a half-library (A/B) and some do not; cannot tell which "
                           "reference each run belongs to")

    # --- labels ------------------------------------------------------------------
    # Several runs of one GEO/BioSample sample are technical runs of one
    # library (lanes, resequencing). They share one label, and analyze.py counts
    # each run and sums the counts per label, so MAGeCK sees one sample rather
    # than pseudo-replicates. Runs of one sample always share a title, so the
    # label is chosen per sample, not per run.
    def sample_key(f):
        return f.rec.geo_sample or f.rec.sample or f.rec.run

    by_key: dict[str, list] = defaultdict(list)
    for f in feats:
        by_key[sample_key(f)].append(f)
    seen: Counter = Counter()
    for members in by_key.values():
        seen[_safe_label(members[0].title)] += 1
    used: set[str] = set()
    for key, members in by_key.items():
        base = _safe_label(members[0].title)
        label = base if seen[base] == 1 else _safe_label(f"{base}_{key}")
        while label in used:
            label = _safe_label(f"{label}_{members[0].rec.run}")
        used.add(label)
        for f in members:
            f.label = label

    multi = {k: [f.rec.run for f in m] for k, m in by_key.items()
             if len(m) > 1 and any(f in screen_feats for f in m)}
    if multi:
        ex = next(iter(multi.items()))
        plan.notes.append(f"{len(multi)} sample(s) were sequenced over several runs (e.g. {ex[0]}: "
                          f"{', '.join(ex[1])}); their runs are counted separately and summed per sample")

    lanes = [f for f in screen_feats if re.search(r"(?<![a-z0-9])(lane[ _-]?\d|l00\d)(?![0-9])", f.title, re.I)]
    if len(lanes) >= 2:
        plan.issues.append(f"{len(lanes)} samples are named by sequencing lane (e.g. '{lanes[0].title}'); lanes of "
                           "one library are technical, not biological, replicates and must be merged first")

    # --- FASTQ sanity --------------------------------------------------------------
    for f in screen_feats:
        r = f.rec
        if r.library_layout == "SINGLE" and len(r.fastq_urls) > 1:
            plan.issues.append(f"{r.run} is single-end but has {len(r.fastq_urls)} FASTQ files; "
                               "one may be an index or barcode read, so which holds the spacer is unknown")
        if any(not m for m in r.fastq_md5):
            plan.issues.append(f"{r.run} has no MD5 for its FASTQ, so the download cannot be verified")
    if any(f.rec.library_layout == "PAIRED" for f in screen_feats):
        plan.notes.append("paired-end runs: only read 1 is listed and counted (the spacer is in read 1 in "
                          "standard amplicon protocols); if counting maps few reads, try read 2")

    # --- contrasts --------------------------------------------------------------------
    contrasts, c_issues = _contrasts(screen_feats)
    plan.issues += c_issues

    # --- entities ------------------------------------------------------------------------
    plan.modality, m_issues = _modality(text + "\n" + plan.library_hint if plan.library_hint else text)
    plan.issues += m_issues
    plan.cell_line_raw, plan.cell_line_rrid, cl_issues = _cell_line(c, screen_feats, text)
    plan.issues += cl_issues
    compounds = {f.compound for f in screen_feats if f.compound and f.kind == "agent"}
    if compounds:
        plan.compound_raw = "; ".join(sorted({raw for raw, _ in compounds}))
        ids = {cid for _, cid in compounds}
        plan.compound_chembl = next(iter(ids)) if len(ids) == 1 else None
        if len(ids) > 1:
            plan.notes.append("several compounds in one study; each drug_modifier contrast is named after "
                              "its compound")
    plan.phenotype = _phenotype(contrasts, screen_feats, text)

    # --- validate every contrast exactly as the pipeline will ------------------------------
    _finish_roles(plan, feats)
    for con in plan.contrasts:          # runs merged into one sample appear once
        con.treatment = list(dict.fromkeys(con.treatment))
        con.control = list(dict.fromkeys(con.control))
    labels = list(dict.fromkeys(r.label for r in plan.roles if r.role != "exclude"))
    conflicting = sorted({r.label for r in plan.roles for o in plan.roles
                          if r.label == o.label and r.role != o.role})
    if conflicting:
        plan.issues.append(f"runs merged into one sample disagree on its role ({', '.join(conflicting[:3])}); "
                           "a sample cannot be two arms of the screen")
    roles = {r.label: r.role for r in plan.roles if r.role != "exclude"}
    for con in contrasts:
        try:
            screen_design.build_design(labels, roles, con.treatment, con.control)
        except screen_design.DesignError as e:
            plan.issues.append(f"contrast {con.name} failed design validation: {e}")
            continue
        plan.contrasts.append(con)
    if not plan.contrasts:
        plan.issues.append("no valid contrast could be built from the inferred roles")

    if len({f.part for f in screen_feats} - {None}) > 1:
        plan.notes.append("split half-libraries (A/B): each part is counted against its own reference and "
                          "has its own contrasts; merge gene-level results after, not counts before")
    low = [r for r in plan.roles if r.confidence < READY_CONFIDENCE]
    if low:
        plan.issues.append(f"{len(low)} run(s) have no confident role, e.g. "
                           + "; ".join(f"{r.run} '{r.label}': {r.evidence[0]}" for r in low[:3]))
    confs = [r.confidence for r in plan.roles] or [0.0]
    plan.confidence = round(min(confs) * (1.0 if plan.contrasts else 0.5) * (1.0 if not plan.issues else 0.6), 3)
    plan.status = "ready" if not plan.issues and plan.contrasts else "needs_review"
    return plan


def _finish_roles(plan: StudyPlan, feats: list[_Run]) -> None:
    if not plan.roles:
        for f in feats:
            if not f.label:
                f.label = _safe_label(f"{f.title}_{f.rec.run}")
            cond = None if f.kind in ("omics", "nofastq", "unknown") else "_".join(
                x for x in [f.part, f.context or None, f.agent if f.kind == "agent" else f.kind, f.tp] if x)
            plan.roles.append(SampleRole(
                run=f.rec.run, label=f.label, role=_ROLE_OF.get(f.kind, "exclude"),
                condition=_safe_label(cond) if cond else None, timepoint=f.tp, replicate=f.rep,
                confidence=round(f.conf, 3), evidence=f.evidence, library_part=f.part))


def _contrasts(feats: list[_Run]) -> tuple[list[Contrast], list[str]]:
    """Build contrasts within each (half-library, context) stratum."""
    issues: list[str] = []
    out: list[Contrast] = []
    strata: dict[tuple, list[_Run]] = defaultdict(list)
    for f in feats:
        if f.kind in ("plasmid", "baseline"):
            continue
        strata[(f.part, f.context)].append(f)
    refs_by_part: dict[tuple, list[_Run]] = defaultdict(list)
    for f in feats:
        if f.kind in ("plasmid", "baseline"):
            refs_by_part[(f.part, f.context)].append(f)
            refs_by_part[(f.part, "*")].append(f)

    contexts = {k[1] for k in strata}
    if len(contexts) > 3:
        issues.append(f"{len(contexts)} distinct sample contexts ({', '.join(sorted(c or '-' for c in contexts)[:5])}...); "
                      "too many to pair arms confidently")

    def refs_for(part, ctx) -> list[_Run]:
        own = refs_by_part.get((part, ctx), [])
        if not own and any(k[0] == part and k[1] not in ("", "*") for k in refs_by_part):
            # References exist for specific contexts but not this one: which
            # one belongs to this arm is exactly the guess not to make.
            issues.append(f"stratum {name(part, ctx) or 'all'}: no reference of its own, and the study's "
                          "references belong to other sample groups; the pairing is ambiguous")
            return []
        if not own:
            # A reference without a context of its own (the plasmid pool, "T0")
            # serves every context of its half-library, but only if there is
            # exactly one such context-free reference group.
            own = refs_by_part.get((part, ""), [])
            if not own and len(contexts) == 1:
                own = refs_by_part.get((part, "*"), [])
        base = [f for f in own if f.kind == "baseline"]
        return base or [f for f in own if f.kind == "plasmid"]

    def name(*xs) -> str:
        return _safe_label("_".join(x for x in xs if x))

    for (part, ctx), fs in sorted(strata.items(), key=lambda kv: (str(kv[0][0]), kv[0][1])):
        by_kind: dict[str, list[_Run]] = defaultdict(list)
        for f in fs:
            by_kind[f.kind].append(f)
        refs = refs_for(part, ctx)
        ref_label = "T0" if refs and refs[0].kind == "baseline" else "plasmid"

        # Dropout: vehicle (or plain late) endpoints against the reference, per time point.
        endpoints = by_kind.get("vehicle") or by_kind.get("late") or []
        if not by_kind.get("vehicle") and not by_kind.get("late") and not (
                by_kind.get("agent") or by_kind.get("selection") or by_kind.get("unsorted")
                or any(k.startswith("sort") for k in by_kind)):
            issues.append(f"stratum {name(part, ctx) or 'all'}: no endpoint arm recognised")
        if refs:
            for tp, grp in _by_tp(endpoints).items():
                out.append(Contrast(name=name(part, ctx, tp, "vs", ref_label), kind="dropout",
                                    treatment=[f.label for f in grp], control=[f.label for f in refs]))

        # Drug modifier / positive selection: treated vs vehicle at the same time point.
        treated = by_kind.get("agent", []) + by_kind.get("selection", [])
        vehicle_tp = _by_tp(by_kind.get("vehicle", []))
        for (agent, tp), grp in _by_agent_tp(treated).items():
            kind = "drug_modifier" if grp[0].compound else "positive_selection"
            ctrl = vehicle_tp.get(tp)
            if ctrl is None and len(vehicle_tp) == 1 and tp is None:
                ctrl = next(iter(vehicle_tp.values()))
            if ctrl is None and not vehicle_tp and by_kind.get("unsorted"):
                ctrl = by_kind["unsorted"]
            if ctrl:
                out.append(Contrast(name=name(part, ctx, agent, tp, "vs", "control"), kind=kind,
                                    treatment=[f.label for f in grp], control=[f.label for f in ctrl]))
            elif refs and not vehicle_tp:
                out.append(Contrast(name=name(part, ctx, agent, tp, "vs", ref_label), kind="positive_selection",
                                    treatment=[f.label for f in grp], control=[f.label for f in refs]))
            else:
                issues.append(f"{agent} at {tp or 'unstated time'}: no vehicle arm at the same time point")

        # Sorting: high vs low, else sorted vs unsorted.
        for tp in sorted({f.tp for f in fs if f.kind.startswith("sort")}, key=str):
            hi = [f for f in by_kind.get("sort_high", []) if f.tp == tp]
            lo = [f for f in by_kind.get("sort_low", []) if f.tp == tp]
            sorted_ = [f for f in by_kind.get("sorted", []) if f.tp == tp]
            unsorted = [f for f in by_kind.get("unsorted", [])]
            if hi and lo:
                out.append(Contrast(name=name(part, ctx, tp, "high_vs_low"), kind="sorting",
                                    treatment=[f.label for f in hi], control=[f.label for f in lo]))
            for grp, tag in ((hi, "high"), (lo, "low"), (sorted_, "sorted")):
                if grp and unsorted:
                    out.append(Contrast(name=name(part, ctx, tp, tag, "vs_unsorted"), kind="sorting",
                                        treatment=[f.label for f in grp], control=[f.label for f in unsorted]))
            vehicle = [f for f in by_kind.get("vehicle", []) if f.tp in (tp, None)]
            if not (hi and lo) and not unsorted and vehicle:
                for grp, tag in ((hi, "high"), (lo, "low"), (sorted_, "sorted")):
                    if grp:
                        out.append(Contrast(name=name(part, ctx, tp, tag, "vs_control"), kind="positive_selection",
                                            treatment=[f.label for f in grp], control=[f.label for f in vehicle]))
            elif not (hi and lo) and not unsorted:
                issues.append(f"sorted runs at {tp or 'unstated time'} have neither an opposite bin nor an "
                              "unsorted control")
    # Drop exact duplicates (a vehicle arm can be both dropout endpoint and control).
    seen, uniq = set(), []
    for con in out:
        key = (tuple(sorted(con.treatment)), tuple(sorted(con.control)))
        if key not in seen and con.treatment and con.control:
            seen.add(key)
            uniq.append(con)
    return uniq, issues


def _by_tp(fs: list[_Run]) -> dict[str | None, list[_Run]]:
    out: dict[str | None, list[_Run]] = defaultdict(list)
    for f in fs:
        out[f.tp].append(f)
    return dict(out)


def _by_agent_tp(fs: list[_Run]) -> dict[tuple, list[_Run]]:
    out: dict[tuple, list[_Run]] = defaultdict(list)
    for f in fs:
        agent = (f.compound[0] if f.compound else (f.agent or f.context or f.kind)).lower()
        out[(_safe_label(agent), f.tp)].append(f)
    return dict(out)


def _phenotype(contrasts: list[Contrast], feats: list[_Run], text: str) -> str | None:
    kinds = {c.kind for c in contrasts}
    if "sorting" in kinds:
        markers = sorted({f.marker.upper() for f in feats if f.marker and f.kind.startswith("sort")})
        return f"FACS: {', '.join(markers)}" if markers else "FACS sort"
    if "drug_modifier" in kinds:
        agents = sorted({f.compound[0] for f in feats if f.compound})
        return f"drug response: {', '.join(agents)}"
    if "positive_selection" in kinds:
        agents = sorted({f.agent or f.kind for f in feats if f.kind in ("agent", "selection")})
        return f"selection: {', '.join(a for a in agents if a)}" if agents else "positive selection"
    if kinds == {"dropout"}:
        return "proliferation"
    return None
