"""
Is this deposited study a pooled CRISPR screen the bulk pipeline can process?

Transparent weighted evidence, not a black box. Every rule that fires adds a
fixed weight and a plain-language reason, the weights are summed with a bias
and squashed to [0, 1], and the reasons are stored with the score, so anyone
reading ingest.studies can see exactly why a study was taken or left.

    score >= SCREEN_AT        verdict "screen"
    score >= MAYBE_AT         verdict "maybe"
    otherwise                 verdict "not_screen"

Three overrides sit on top of the score, because they are facts about the
study rather than evidence about it:

  * A GEO SuperSeries holds no reads of its own. Its screen SubSeries is a
    candidate in its own right, so the SuperSeries is not_screen.
  * A single-cell readout (Perturb-seq, CROP-seq, ECCITE-seq ...) is a real
    screen but a different assay; the bulk count pipeline cannot process it.
    It is capped at "maybe" with that reason, never "screen".
  * Organisms other than human and mouse are recorded but not_screen: there
    are no libraries or reference gene sets for them in the engine.

Weights were set by hand, then adjusted on the training split of the labelled
set in research/artifacts/ingest (never on its test split). See
research/artifacts/ingest/classifier_eval.json for measured precision/recall.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

from .models import StudyCandidate

SCREEN_AT = 0.70
MAYBE_AT = 0.40
BIAS = -2.0
SUPPORTED_TAXA = {9606: "human", 10090: "mouse"}

# Named pooled libraries. A study naming one is very likely a screen (or a
# follow-up that reuses the name, which the negative rules then catch).
LIBRARIES = (
    "brunello", "brie", "gecko", "geckov2", "tkov3", "toronto knockout", "tko v3", "avana",
    "dolcetto", "calabrese", "gattinara", "gouda", "yusa", "kosuke", "minlibcas9",
    "h1 library", "sam library", "saturn", "sabatini", "moffat", "hgLibA", "mouse gecko",
)
_LIB_RE = re.compile(r"\b(" + "|".join(re.escape(x) for x in LIBRARIES) + r")\b", re.I)


@dataclass(frozen=True)
class Rule:
    name: str
    weight: float
    pattern: re.Pattern
    reason: str
    where: str = "text"        # text | samples


def _r(p: str) -> re.Pattern:
    return re.compile(p, re.I)


# Sample names use "_" and "-" as separators, which \b treats as word
# characters ("T0_3" has no \b after the 0). These look-arounds treat anything
# that is not a letter or digit as a boundary.
_S = r"(?<![a-z0-9])"
_E = r"(?![a-z0-9])"


RULES: tuple[Rule, ...] = (
    # --- positive, from the series text --------------------------------------
    Rule("screen_phrase", 2.5,
         _r(r"\b(crispr\w*|cas9|cas12a|cpf1|sgrna|grna|guide rna|knock-?out|loss[- ]of[- ]function|"
            r"gain[- ]of[- ]function|crispri|crispra|activation|interference|dropout|genetic|"
            r"genome[- ]?wide|genome[- ]scale|whole[- ]genome|chemogenomic|chemical[- ]genetic|"
            r"reporter|genetic[- ]interaction|in vivo|kinome[- ]wide|pooled)"
            r"[\w\s/()-]{0,40}\bscreen(s|ing)?\b"),
         "describes a CRISPR / genetic screen"),
    Rule("genome_wide", 1.0, _r(r"\b(genome[- ]?wide|genome[- ]scale|whole[- ]genome|kinome[- ]wide|"
                                r"druggable[- ]genome|sub-?library|focused library)\b"),
         "genome-wide or focused library scale"),
    Rule("pooled", 1.0, _r(r"\bpooled\b"), "pooled format"),
    Rule("sgrna_library", 1.5,
         _r(r"\b(sg|g|guide )rna[s]?[- ](library|libraries|pool)\b|\bcrispr[\w/-]*\s+(knock-?out\s+|"
            r"activation\s+|activating\s+)?(library|libraries)\b|\blentiviral (sgrna )?library\b"),
         "sgRNA / CRISPR library"),
    Rule("named_library", 2.0, _LIB_RE, "names a pooled CRISPR library"),
    Rule("analysis_tool", 1.5, _r(r"\b(mageck|bagel2?|crisprcleanr|drugz|castle|jacks|"
                                  r"sgrna counts?|guide counts?|read counts? (of|per) (sg|guide))"),
         "names screen analysis (MAGeCK/BAGEL/guide counts)"),
    Rule("selection_words", 1.0,
         _r(r"\b(sgrna|guide|grna)s? (representation|abundance|enrichment|depletion|sequencing)|"
            r"\b(negative|positive) selection\b|\bdepleted sgrnas?\b|\benriched sgrnas?\b|"
            r"\bsgrna (enrichment|depletion)"),
         "talks about sgRNA enrichment / depletion / sequencing"),
    # --- the series title: GEO SubSeries are tagged with their assay ----------
    Rule("title_screen_tag", 2.0,
         _r(r"[\[(]\s*(crispr[^\])]*|[^\])]*screen[^\])]*|dna-?seq|sgrna[^\])]*|guide[^\])]*|amplicon[^\])]*)[\])]"),
         "series title is tagged as the screen / DNA-seq subseries", where="title"),
    Rule("title_omics_tag", -3.0,
         _r(r"[\[(]\s*(bulk )?(rna-?seq|chip-?seq|atac-?seq|cut ?& ?run|cut ?& ?tag|sc-?rna-?seq|single[- ]cell[^\])]*|"
            r"wes|wgs|hi-?c|hichip|capture-?c|micro-?c|ribo\w*|4su-?seq|3'?utr-?seq|iclip\w*|clip-?seq|"
            r"spatial|st|methylation|bisulfite|proteomics|microarray|expression)[^\])]*[\])]"),
         "series title is tagged as an RNA-seq / ChIP / ATAC / other omics subseries", where="title"),
    Rule("title_rnaseq", -1.5,
         _r(r"\b(rna-?seq\w*|transcriptom\w*|gene expression|expression profil\w*|chip-?seq|atac-?seq|"
            r"differentially expressed|single[- ]cell rna)"),
         "series title is about expression / chromatin profiling", where="title"),
    # --- the sample names: what this series actually holds --------------------
    Rule("sample_plasmid", 1.5, _r(_S + r"(plasmid|pdna|library (pool|dna|representation)|sgrna virus|"
                                    r"lib(rary)?[ _-]?(pool|rep))"),
         "a sample is the plasmid / library pool", where="samples"),
    Rule("sample_baseline", 0.8, _r(_S + r"(t0|d0|day ?0|time ?0|tp0|input|pre-?sort|unsorted|baseline|initial|"
                                    r"pre-?selection|pre-?infection|pre-?kill|early time ?point)" + _E),
         "samples include a baseline / unsorted / input arm", where="samples"),
    Rule("sample_screen_words", 1.2, _r(r"(screen|sgrna[ _-]?seq\w*|grna library|crispr|gdna|amplicon)"),
         "sample names mention screen / CRISPR / gDNA / amplicon", where="samples"),
    Rule("sample_sort", 0.8, _r(_S + r"(sorted|sort|high|low|hi|lo|top|bottom|bin ?\d)" + _E),
         "samples are sort bins (high / low / sorted)", where="samples"),
    Rule("sample_rounds", 0.8, _r(r"(round ?\d|(first|second|third|final) round|" + _S + r"rd ?\d|survivor|"
                                  r"surviv\w+|resistant population|selection" + _E + r")"),
         "samples are selection rounds / survivors", where="samples"),
    Rule("sample_timecourse", 0.4, _r(_S + r"(day ?\d+|d\d+|t\d+|week ?\d|p\d+|passage)" + _E),
         "samples are a time course", where="samples"),
    # --- negative -------------------------------------------------------------
    Rule("superseries", -8.0, _r(r"this superseries is composed of"), "GEO SuperSeries (container, no reads)"),
    Rule("rna_seq", -1.0, _r(r"\b(rna-?seq\w*|transcriptom\w*|gene expression profil\w*|"
                             r"differentially expressed|expression array)"),
         "text is about RNA-seq / expression profiling"),
    Rule("chromatin", -1.0, _r(r"\b(chip-?seq|atac-?seq|cut&(run|tag)|cut ?and ?(run|tag)|hi-?c\b|"
                               r"hichip|capture-?c|bisulfite|methylation profil\w*|dnase-?seq|"
                               r"ribosome profiling|ribo-?seq|clip-?seq|meRIP|rip-?seq|4su)"),
         "text is about chromatin / RNA-binding / translation profiling"),
    Rule("off_target", -2.0, _r(r"\b(off-?target (cleavage|editing|sites?|detection|effects? of)|guide-?seq|"
                                r"circle-?seq|digenome|change-?seq|chromosomal translocations?)\b"),
         "editing off-target / translocation assay"),
    Rule("single_ko", -1.0,
         _r(r"\b(knock-?out|ko|deficient|depleted|null|-/-)\s+(cells?|clones?|mice|lines?)\b|"
            r"\bcrispr(/cas9)?[- ](mediated|generated|engineered|edited)\b|"
            r"\b(generated|created|established) (by|using|with) crispr"),
         "reads like a single engineered knockout, not a screen"),
    Rule("knockdown", -0.8, _r(r"\b(shrna|sirna|knock-?down)\b"), "RNAi knockdown study"),
    Rule("lineage", -1.0, _r(r"\b(lineage tracing|lineage recording|barcod(e|ing) lineage)\b"),
         "CRISPR lineage tracing, not a screen"),
    Rule("sample_omics", -1.5, _r(r"(rna-?seq|chip|atac|input dna|h3k\d+|cut&?run|cut&?tag|scrna|10x|"
                                  r"\brpf\b|ribosome profiling|hi-?c\b)"),
         "sample names are RNA-seq / ChIP / ATAC / scRNA libraries", where="samples"),
)

# Sample-level rules that show THIS series holds guide-count reads. The series
# summary is shared by every SubSeries of a paper, so a summary that says
# "we performed a CRISPR screen" is equally present on the paper's RNA-seq and
# ATAC SubSeries. Without one of these the verdict is capped at "maybe".
CORROBORATING = frozenset({"sample_plasmid", "sample_baseline", "sample_screen_words", "sample_sort",
                           "sample_rounds", "title_screen_tag", "amplicon"})

# Most samples named after one targeted gene each (sgTP53, shMYC, siCTRL) is
# the shape of an arrayed knockout / knockdown RNA-seq, not a pooled screen.
_PER_GENE_SAMPLE = re.compile(r"(^|[\s_\-(\[,])(sg|sh|si)(?!rna\b)[A-Za-z0-9]{2,}|\b[A-Z0-9]{2,}[- ]?(KO|KD)\b")


# Single-cell readouts: a screen, but not one the bulk pipeline can process.
SINGLE_CELL = _r(r"\b(perturb-?seq|perturbsci\w*|sci-?plex|crop-?seq|eccite-?seq|mosaic-?seq|tap-?seq|spear-?atac|"
                 r"single[- ]cell crispr|single-cell (crispr )?screen\w*|crispr-?sciATAC|"
                 r"direct capture perturb|optical pooled screen\w*|in situ perturb|x-?atlas|scperturb)")


NON_MAMMALIAN = _r(r"\b(e\. ?coli|escherichia|mycobacteri\w*|m\. ?(tuberculosis|smegmatis)|proteobacteria|"
                   r"bacteri(a|um|al)|salmonella|pseudomonas|bacillus|staphylococc\w*|streptococc\w*|"
                   r"vibrio|listeria|yeast|saccharomyces|candida|yarrowia|arabidopsis|drosophila|"
                   r"zebrafish|danio|c\. ?elegans|caenorhabditis|plasmodium|toxoplasma|trypanosom\w*|"
                   r"synechocystis|cyanobacteri\w*|bacteroides|\bbt\b)\b")
_CRISPR = _r(r"crispr|sgrna|grna|guide rna|cas9|cas12a|perturb")


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def evidence(c: StudyCandidate) -> list[tuple[str, float, str]]:
    """(rule name, weight, reason) for every rule that fires. Each rule fires at most once."""
    sources = {
        "text": f"{c.title}\n{c.summary}",
        "title": c.title or "",
        "samples": "\n".join(c.sample_titles[:400]),
    }
    hits = []
    for rule in RULES:
        src = sources[rule.where]
        if src and rule.pattern.search(src):
            hits.append((rule.name, rule.weight, rule.reason))
    titles = [t for t in c.sample_titles[:400] if t]
    if len(titles) >= 3:
        per_gene = sum(1 for t in titles if _PER_GENE_SAMPLE.search(t)) / len(titles)
        if per_gene >= 0.5:
            hits.append(("sample_per_gene", -1.5,
                         f"{per_gene:.0%} of samples are named after one targeted gene (arrayed KO/KD shape)"))
    # Sequencing strategy, when discovery saw the SRA records.
    strategies = {s.upper() for s in c.library_strategies}
    if "AMPLICON" in strategies:
        hits.append(("amplicon", 1.0, "SRA library strategy AMPLICON"))
    if strategies and strategies <= {"RNA-SEQ", "CHIP-SEQ", "ATAC-SEQ", "BISULFITE-SEQ", "HI-C",
                                     "MIRNA-SEQ", "WGS", "WXS", "RIP-SEQ", "SSRNA-SEQ"}:
        hits.append(("omics_strategy", -1.5, f"SRA strategies are only {sorted(strategies)}"))
    return hits


def classify(c: StudyCandidate) -> StudyCandidate:
    """Set score, verdict and reasons on `c` (in place) and return it."""
    hits = evidence(c)
    names = {h[0] for h in hits}
    score = _sigmoid(BIAS + sum(w for _, w, _ in hits))
    reasons = [f"{'+' if w >= 0 else ''}{w:.1f} {r}" for _, w, r in hits]
    verdict = "screen" if score >= SCREEN_AT else "maybe" if score >= MAYBE_AT else "not_screen"

    corroborated = names & CORROBORATING
    if "sample_omics" in names:
        # "Input" and "high/low" are ChIP and RNA-seq vocabulary too; next to
        # omics sample names they say nothing about guide counts.
        corroborated -= {"sample_baseline", "sample_sort"}
    if verdict == "screen" and not corroborated:
        verdict = "maybe"
        score = min(score, SCREEN_AT - 0.01)
        reasons.append("capped at maybe: the text describes a screen, but no sample name, title tag or "
                       "sequencing strategy shows that THIS series holds the guide-count reads")

    text = f"{c.title}\n{c.summary}\n" + "\n".join(c.sample_titles[:400])
    if "superseries" in names:
        verdict = "not_screen"
        score = min(score, 0.1)
        reasons.append("GEO SuperSeries: holds no runs of its own; its SubSeries are separate candidates")
    elif SINGLE_CELL.search(text) and _CRISPR.search(text):
        # A CRISPR screen with a single-cell readout is recorded as "maybe" whatever
        # its score, so it is seen, and never "screen", so it is never analysed.
        verdict = "maybe"
        score = min(max(score, MAYBE_AT), SCREEN_AT - 0.01)
        reasons.append("single-cell readout (Perturb-seq / CROP-seq class): a screen, but the bulk "
                       "count pipeline cannot process it")

    if c.taxid is not None and c.taxid not in SUPPORTED_TAXA:
        verdict = "not_screen"
        reasons.append(f"unsupported organism: {c.organism or c.taxid} (engine has human and mouse libraries only)")
    elif c.taxid is None and c.organism and c.organism.lower() not in ("homo sapiens", "mus musculus",
                                                                        "synthetic construct"):
        verdict = "not_screen"
        reasons.append(f"unsupported organism: {c.organism}")
    elif c.taxid is None and (m := NON_MAMMALIAN.search(f"{c.title}\n{c.summary}")):
        # No taxonomy on the record (common for ENA umbrella / not-yet-public
        # runs), but the text names the organism, and it is not one we can analyse.
        verdict = "not_screen"
        reasons.append(f"unsupported organism named in the text: {m[0]} (no taxonomy on the record)")
    elif c.taxid is None:
        reasons.append("organism not stated in the record")

    c.score = round(min(1.0, max(0.0, score)), 4)
    c.verdict = verdict
    c.reasons = reasons
    return c


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

def _split(accession: str, test_fraction: float = 0.3) -> str:
    """Deterministic train/test split by accession hash, so reruns never leak."""
    import hashlib

    h = int(hashlib.sha256(accession.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    return "test" if h < test_fraction else "train"


def _prf(pairs: list[tuple[bool, bool]]) -> dict:
    tp = sum(1 for p, t in pairs if p and t)
    fp = sum(1 for p, t in pairs if p and not t)
    fn = sum(1 for p, t in pairs if not p and t)
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return {"n": len(pairs), "tp": tp, "fp": fp, "fn": fn,
            "precision": round(prec, 3), "recall": round(rec, 3), "f1": round(f1, 3)}


def evaluate(labels_csv: str, inputs_json_gz: str) -> dict:
    """
    Score the classifier against the hand-labelled set.

    Two questions, reported separately for the train and test splits:
      screen      verdict == "screen"            vs label == "screen"
      screen|maybe verdict in (screen, maybe)     vs label in (screen, single_cell)
    Labels are per GEO series: "screen" means the series itself holds pooled
    guide-count reads; SuperSeries and RNA-seq/ChIP subseries of screen papers
    are "not_screen"; single-cell CRISPR readouts are "single_cell".
    """
    import csv
    import gzip
    import json

    from .discover import candidate_from_gds

    labels = {r["accession"]: r for r in csv.DictReader(open(labels_csv))}
    docs = {d["accession"]: d for d in json.load(gzip.open(inputs_json_gz, "rt"))}
    rows = []
    for acc, lab in sorted(labels.items()):
        c = classify(candidate_from_gds(docs[acc]))
        rows.append({"accession": acc, "split": _split(acc), "label": lab["label"],
                     "label_confidence": lab["label_confidence"], "source_set": lab["source_set"],
                     "verdict": c.verdict, "score": c.score, "reasons": c.reasons,
                     "title": c.title[:160]})

    def metrics(subset: list[dict]) -> dict:
        return {
            "screen": _prf([(r["verdict"] == "screen", r["label"] == "screen") for r in subset]),
            "screen_or_maybe": _prf([(r["verdict"] in ("screen", "maybe"),
                                      r["label"] in ("screen", "single_cell")) for r in subset]),
            "single_cell_marked_screen": sum(1 for r in subset
                                             if r["label"] == "single_cell" and r["verdict"] == "screen"),
        }

    out = {"n": len(rows), "thresholds": {"screen": SCREEN_AT, "maybe": MAYBE_AT}}
    for split in ("train", "test"):
        sub = [r for r in rows if r["split"] == split]
        out[split] = metrics(sub)
        out[split]["high_or_medium_label_confidence"] = metrics(
            [r for r in sub if r["label_confidence"] != "low"])
        out[split]["by_source_set"] = {s: metrics([r for r in sub if r["source_set"] == s])
                                       for s in sorted({r["source_set"] for r in sub})}
    out["errors_test"] = [
        {k: r[k] for k in ("accession", "label", "verdict", "score", "title", "reasons")}
        for r in rows if r["split"] == "test"
        and ((r["verdict"] == "screen") != (r["label"] == "screen"))]
    out["rows"] = rows
    return out
