"""
The Atlas: what every other published screen says about a gene.

A hit list on its own does not say whether a gene is interesting. PSMB2 comes
out of almost every proliferation screen ever run, so finding it says the
screen worked, not that the condition matters. The Atlas is the reference
that lets the pipeline tell those apart, built from BioGRID ORCS: 1,952 human
screens with the original authors' own gene-level hit calls.

Three numbers come out of it for each gene, and the distinction between them
is the whole point:

  hit_rate_unrelated   How often the gene hits in screens that are NOT like
                       this one. This is the frequent-hitter signal. The
                       threshold in config.ArtifactThresholds is written as
                       "unrelated Atlas screens" and it has to be: a gene
                       that hits in every olaparib screen is not a frequent
                       hitter, it is a PARP inhibitor gene, and computing the
                       rate over everything would flag exactly the genes the
                       screen exists to find.
  hit_rate_comparable  How often it hits in the screens that ARE like this
                       one. This is corroboration, the opposite reading.
  hit_rate_all         Both together, for the record.

Every rate is exact, not estimated. Per gene the store keeps two bitmaps over
the background screen set, one for "this screen measured the gene" and one
for "this screen called it a hit", so any subset of screens can be counted
with two popcounts. That matters because the denominators genuinely differ:
sub-pool libraries measure 7,000 genes, not 20,000, and dividing by the
wrong denominator is how a gene measured in 40 screens and hit in 10 gets
reported as hitting in 0.5% of the Atlas.

What is deliberately NOT here:

  * No cross-screen score aggregation. ORCS SCORE.1 means a different thing
    in every screen (SCORE.1_TYPE spans log10 corrected p-value, CERES
    score, Bayes factor, plain L2FC), so a median over screens would be a
    number with no unit. atlas.gene_stats.median_lfc stays NULL for ORCS
    rows and the ingestion says so rather than filling it.
  * No statistics from hit-list-only deposits. 141 human screens contain
    only the genes the authors called, so every row in them is a hit.
    Counting them would put a 100% hit rate screen into the denominator of
    every rate. They stay queryable but they are not background.

Honest degradation is a requirement, not a nicety. If the Atlas has not been
ingested, gene_context returns an AtlasResult with available=False and the
reason, and the frequent_hitter flag falls back to DepMap pan-essentials
alone. It never returns a rate of 0.0 for "we do not know".

LEAKAGE. AssayBench is derived from ORCS and ORCS ships the answer key for
those screens, so reading the wrong screen voids every benchmark number this
repo produces. See splicr.orcs_safe. The guard here is ON by default
(policy "publication") and has to be turned off explicitly, because the
failure mode of forgetting is silent and unrecoverable.
"""

from __future__ import annotations

import json
import os
import statistics as st
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Sequence

from .config import ORCS_DIR, SETTINGS, ArtifactThresholds
from .orcs import OrcsScreen, normalise_cell_line

#: Where the ingestion writes the Atlas and where the pipeline reads it.
#: Overridable so a run can point at a copy pulled down from R2.
ATLAS_DIR = Path(os.environ.get("SPLICR_ATLAS_DIR", ORCS_DIR / "atlas"))

MANIFEST_NAME = "manifest.json"
SCREENS_NAME = "screens.parquet"
GENE_STATS_NAME = "gene_stats.parquet"
ALIASES_NAME = "gene_aliases.parquet"
ROWS_DIR = "gene_hits"

#: Leakage policy used when nothing says otherwise. "off" disables the guard
#: and is only correct for a product run that will never be compared against
#: an AssayBench number.
DEFAULT_LEAKAGE_POLICY = os.environ.get("SPLICR_ATLAS_LEAKAGE_POLICY", "publication")

#: Weights for judging how comparable two screens are. There is no published
#: scheme for this, so these are ours and the reasoning is the record:
#: the cell line dominates because a screen's essentialome is mostly a
#: property of the line; the condition and the phenotype come next because
#: they define what the screen is asking; modality and setup are coarse
#: filters; the library barely matters once the gene is measured at all.
COMPARABILITY_WEIGHTS = {
    "cell_line": 3.0,
    "condition": 2.5,
    "phenotype": 2.0,
    "modality": 1.0,
    "experimental_setup": 1.0,
    "library": 0.5,
}

#: A screen at or above this share of the achievable comparability score
#: counts as related, and is therefore excluded from hit_rate_unrelated. Our
#: threshold. Set at half because the achievable score is dominated by the
#: cell line and the condition: half means a screen matched roughly one of
#: the two big features plus something, which is the point at which calling
#: it "unrelated" stops being defensible.
RELATED_SCORE_MIN = 0.5

#: Genes to report Atlas context for in one call. A genome-wide screen has
#: ~20,000, and the bitmap arithmetic is per gene, so this is a guard against
#: a caller accidentally asking for the whole store row by row.
MAX_CONTEXT_GENES = 60_000

#: Unrelated background screens a gene must have been measured in before the
#: Atlas is allowed to call it a frequent hitter. Our threshold, and it was
#: found by running the store rather than reasoned about in advance: without
#: it the top of the frequent-hitter list was genes measured in one screen and
#: hit in it, rate 1.0. Those are Excel-mangled symbols ("41882" is a date
#: serial), control guides deposited as genes ("Control_20") and
#: semicolon-joined paralog groups from one unusual deposit, none of which is
#: evidence about anything. Ten is the point where a rate above the 0.25
#: threshold needs at least three independent screens to agree. Genes labs
#: care about are far above it: a protein-coding gene is measured in about
#: 1,400 of the 1,413 background screens.
MIN_SCREENS_FOR_FREQUENT_HITTER = 10


# ---------------------------------------------------------------------------
# Bitmaps
#
# A gene's membership across the background screen set, one bit per screen in
# the order recorded in the manifest. Stored as raw bytes in parquet: 1,413
# background screens is 177 bytes per gene per mask, so both masks for all
# 87,540 symbols are about 31 MB before compression. Python's int is the
# fastest available popcount here, hence from_bytes rather than a bitarray
# dependency.
# ---------------------------------------------------------------------------

def wilson_lower_95(hits: int, n: int) -> float | None:
    """
    Lower bound of the 95% Wilson score interval on a hit rate.

    Reported alongside the rate so a report can say how much the rate is
    worth: 3 of 10 screens and 420 of 1,400 are both 30%, and only one of
    them is evidence. Wilson rather than Wald because Wald's interval is
    useless at the small n and extreme p that are common here (it gives a
    zero-width interval at p = 1).

    Agresti and Coull, The American Statistician 1998, section 2; z = 1.96 for
    a two-sided 95% interval. NOT used to decide the frequent-hitter flag,
    which is a plain threshold on the rate as config.ArtifactThresholds
    defines it. This is extra information, not a second rule.
    """
    if n <= 0:
        return None
    z = 1.959963984540054
    p = hits / n
    denom = 1.0 + z * z / n
    centre = p + z * z / (2 * n)
    spread = z * ((p * (1 - p) / n) + z * z / (4 * n * n)) ** 0.5
    return max(0.0, (centre - spread) / denom)


def mask_from_positions(positions: Iterable[int], n_bits: int) -> bytes:
    acc = 0
    for p in positions:
        acc |= 1 << p
    return acc.to_bytes((n_bits + 7) // 8, "little")


def mask_to_int(raw: bytes | None) -> int:
    return int.from_bytes(raw, "little") if raw else 0


def popcount(value: int) -> int:
    return value.bit_count()


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Comparable:
    """One Atlas screen judged against the screen being analysed."""

    screen_id: int
    score: float                       # 0..1, share of the achievable weight
    matched: tuple[str, ...]           # which features matched
    cell_line: str | None
    phenotype: str | None
    condition: str | None
    modality: str | None
    library: str | None
    author: str | None
    pmid: str | None
    n_genes: int | None
    n_hits: int | None

    @property
    def related(self) -> bool:
        return self.score >= RELATED_SCORE_MIN

    def describe(self) -> str:
        bits = [f"ORCS {self.screen_id}", f"{self.score:.2f}"]
        for v in (self.cell_line, self.condition, self.phenotype, self.author):
            if v:
                bits.append(v)
        return " | ".join(bits)


@dataclass(frozen=True)
class GeneContext:
    """
    What the Atlas knows about one gene.

    Every count is over background screens that measured the gene, so
    n_screens_* are real denominators and not the size of the Atlas. A rate
    is None when its denominator is zero, never 0.0: a gene no background
    screen measured has an unknown hit rate, not a zero one.
    """

    symbol: str
    resolved_symbol: str | None            # the Atlas symbol an alias resolved to
    n_screens_tested: int
    n_hits: int
    n_screens_unrelated: int
    n_hits_unrelated: int
    n_screens_comparable: int
    n_hits_comparable: int
    n_phenotypes: int
    n_cell_lines: int
    n_conditions: int
    phenotypes: tuple[str, ...]

    @staticmethod
    def _rate(num: int, den: int) -> float | None:
        return (num / den) if den > 0 else None

    @property
    def hit_rate(self) -> float | None:
        return self._rate(self.n_hits, self.n_screens_tested)

    @property
    def hit_rate_unrelated(self) -> float | None:
        return self._rate(self.n_hits_unrelated, self.n_screens_unrelated)

    @property
    def hit_rate_comparable(self) -> float | None:
        return self._rate(self.n_hits_comparable, self.n_screens_comparable)

    @property
    def hit_rate_unrelated_lower_95(self) -> float | None:
        """The unrelated rate's 95% Wilson lower bound. How much the rate is worth."""
        if self.n_screens_unrelated <= 0:
            return None
        return wilson_lower_95(self.n_hits_unrelated, self.n_screens_unrelated)

    @property
    def enough_screens_to_judge(self) -> bool:
        return self.n_screens_unrelated >= MIN_SCREENS_FOR_FREQUENT_HITTER

    def is_frequent_hitter(
        self, thresholds: ArtifactThresholds = SETTINGS.artifacts
    ) -> bool | None:
        """
        True, False, or None when the Atlas cannot say.

        None rather than False in two cases, because in both of them a
        boolean would merge opposite facts:

        * No unrelated background screen measured the gene. "Never measured
          anywhere else" is not "measured widely and rarely hits".
        * Fewer than MIN_SCREENS_FOR_FREQUENT_HITTER did. One screen that hit
          gives a rate of 1.0, which is not a frequent hitter, it is one
          observation.

        The decision itself is the plain rate against the threshold, exactly
        as config.ArtifactThresholds.frequent_hitter_rate defines it, so that
        artifacts.check_frequent_hitter and this method cannot disagree.
        """
        rate = self.hit_rate_unrelated
        if rate is None or not self.enough_screens_to_judge:
            return None
        return rate > thresholds.frequent_hitter_rate

    def as_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "resolved_symbol": self.resolved_symbol,
            "n_screens_tested": self.n_screens_tested,
            "n_hits": self.n_hits,
            "hit_rate": self.hit_rate,
            "n_screens_unrelated": self.n_screens_unrelated,
            "n_hits_unrelated": self.n_hits_unrelated,
            "hit_rate_unrelated": self.hit_rate_unrelated,
            "hit_rate_unrelated_lower_95": self.hit_rate_unrelated_lower_95,
            "n_screens_comparable": self.n_screens_comparable,
            "n_hits_comparable": self.n_hits_comparable,
            "hit_rate_comparable": self.hit_rate_comparable,
            "n_phenotypes": self.n_phenotypes,
            "n_cell_lines": self.n_cell_lines,
            "n_conditions": self.n_conditions,
            "phenotypes": list(self.phenotypes),
            "is_frequent_hitter": self.is_frequent_hitter(),
        }


@dataclass
class AtlasResult:
    """
    The atlas stage's output, whether or not the Atlas had anything to say.

    available=False is a first-class outcome with a reason attached. Callers
    must branch on it: there is no version of this object that quietly
    reports zeros for an Atlas that was never built.
    """

    available: bool
    reason: str = ""
    release: str | None = None
    leakage_policy: str | None = None
    n_screens: int = 0
    n_background_screens: int = 0
    n_screens_excluded_for_leakage: int = 0
    comparable: list[Comparable] = field(default_factory=list)
    contexts: dict[str, GeneContext] = field(default_factory=dict)
    n_genes_resolved_by_alias: int = 0
    n_genes_not_in_atlas: int = 0

    @property
    def hit_rates(self) -> dict[str, float]:
        """
        {gene: unrelated hit rate} for artifacts.flag_artifacts.

        Only genes the Atlas is entitled to judge appear: a real denominator
        and at least MIN_SCREENS_FOR_FREQUENT_HITTER unrelated screens. A gene
        missing from this dict has no usable Atlas evidence, which is exactly
        what check_frequent_hitter's atlas_hit_rate=None branch is for. The
        filter lives here rather than in artifacts.py so that a caller which
        only has the plain rate to work with still reaches the same verdict as
        GeneContext.is_frequent_hitter.
        """
        out: dict[str, float] = {}
        for sym, ctx in self.contexts.items():
            rate = ctx.hit_rate_unrelated
            if rate is not None and ctx.enough_screens_to_judge:
                out[sym] = rate
        return out

    @property
    def frequent_hitters(self) -> list[str]:
        t = SETTINGS.artifacts
        return sorted(s for s, c in self.contexts.items() if c.is_frequent_hitter(t))

    @property
    def n_genes_unjudgeable(self) -> int:
        """Genes in the Atlas that too few unrelated screens measured to judge."""
        return sum(1 for c in self.contexts.values() if c.is_frequent_hitter() is None)

    def describe(self) -> str:
        if not self.available:
            return self.reason
        related = [c for c in self.comparable if c.related]
        bits = [
            f"{self.n_background_screens:,} background screens of {self.n_screens:,}",
            f"{len(related)} comparable" if related else "no comparable screen",
            f"context for {len(self.contexts):,} genes",
            f"{len(self.frequent_hitters):,} frequent hitters",
        ]
        if self.n_screens_excluded_for_leakage:
            bits.append(f"{self.n_screens_excluded_for_leakage} held out "
                        f"(leakage policy {self.leakage_policy})")
        if self.n_genes_resolved_by_alias:
            bits.append(f"{self.n_genes_resolved_by_alias:,} resolved via an alias")
        if self.n_genes_not_in_atlas:
            bits.append(f"{self.n_genes_not_in_atlas:,} absent from the Atlas")
        unjudged = self.n_genes_unjudgeable
        if unjudged:
            bits.append(f"{unjudged:,} measured in under "
                        f"{MIN_SCREENS_FOR_FREQUENT_HITTER} unrelated screens")
        return "; ".join(bits)

    def metrics(self) -> dict:
        """Compact enough for a stage row in Postgres."""
        related = [c for c in self.comparable if c.related]
        return {
            "available": self.available,
            "reason": self.reason or None,
            "release": self.release,
            "leakage_policy": self.leakage_policy,
            "n_screens": self.n_screens,
            "n_background_screens": self.n_background_screens,
            "n_screens_excluded_for_leakage": self.n_screens_excluded_for_leakage,
            "n_comparable": len(related),
            "comparable_screen_ids": [c.screen_id for c in related[:25]],
            "n_genes_with_context": len(self.contexts),
            "n_genes_resolved_by_alias": self.n_genes_resolved_by_alias,
            "n_genes_not_in_atlas": self.n_genes_not_in_atlas,
            "n_genes_too_few_screens_to_judge": self.n_genes_unjudgeable,
            "n_frequent_hitters": len(self.frequent_hitters),
            "min_screens_to_judge": MIN_SCREENS_FOR_FREQUENT_HITTER,
        }


# ---------------------------------------------------------------------------
# Comparability
# ---------------------------------------------------------------------------

def _norm(value: str | None) -> str | None:
    if not value:
        return None
    v = " ".join(value.strip().lower().split())
    return v or None


def _condition_match(query: str | None, candidate: str | None) -> bool:
    """
    Do two condition strings describe the same treatment?

    Exact after normalisation, or one contained in the other. Containment is
    needed because ORCS CONDITION_NAME ranges from "Olaparib" to
    "Olaparib (AZD2281)" to "olaparib + ATR inhibitor", and a lab typing
    "olaparib" should still find the first two. It is deliberately not fuzzy:
    substring matching on short strings would make "AZD" match everything,
    so a candidate shorter than four characters must match exactly.
    """
    q, c = _norm(query), _norm(candidate)
    if not q or not c:
        return False
    if q == c:
        return True
    if len(q) < 4 or len(c) < 4:
        return False
    return q in c or c in q


def comparability(
    screen: OrcsScreen,
    cell_line: str | None = None,
    phenotype: str | None = None,
    condition: str | None = None,
    modality: str | None = None,
    experimental_setup: str | None = None,
    library: str | None = None,
) -> tuple[float, tuple[str, ...]]:
    """
    How comparable one Atlas screen is to the screen being analysed.

    Returns (score in 0..1, the features that matched). The denominator is
    the weight of the features the CALLER supplied, not the full weight, so a
    query that only knows its cell line is not capped at 3/10. A query that
    supplies nothing scores 0 and matches nothing, which is why the caller
    has to check whether any comparable screen was found rather than
    assuming one.
    """
    achievable = 0.0
    earned = 0.0
    matched: list[str] = []

    def consider(feature: str, wanted: str | None, got: str | None, hit: bool) -> None:
        nonlocal achievable, earned
        if not wanted:
            return
        weight = COMPARABILITY_WEIGHTS[feature]
        achievable += weight
        if got and hit:
            earned += weight
            matched.append(feature)

    consider("cell_line", cell_line, screen.cell_line,
             normalise_cell_line(cell_line) == screen.cell_line_key)
    consider("condition", condition, screen.condition_name,
             _condition_match(condition, screen.condition_name))
    consider("phenotype", phenotype, screen.phenotype,
             _norm(phenotype) == _norm(screen.phenotype))
    consider("modality", modality, screen.modality,
             _norm(modality) == _norm(screen.modality))
    consider("experimental_setup", experimental_setup, screen.experimental_setup,
             _norm(experimental_setup) == _norm(screen.experimental_setup))
    consider("library", library, screen.library,
             _condition_match(library, screen.library))

    if achievable <= 0:
        return 0.0, ()
    return earned / achievable, tuple(matched)


# ---------------------------------------------------------------------------
# The store
# ---------------------------------------------------------------------------

@dataclass
class _GeneStat:
    """One row of gene_stats.parquet, as held in memory."""

    symbol: str
    entrez_id: int | None
    tested_mask: int
    hit_mask: int
    n_screens_tested: int
    n_hits: int
    n_phenotypes: int
    n_cell_lines: int
    n_conditions: int
    phenotypes: tuple[str, ...]


class AtlasStore:
    """
    Read access to an ingested Atlas.

    Everything is loaded lazily and cached on the instance, so constructing
    one is free and a pipeline run that never reaches the atlas stage pays
    nothing. Nothing here writes; scripts/data/ingest-orcs.py owns writing.
    """

    def __init__(
        self,
        directory: Path | str | None = None,
        leakage_policy: str | None = DEFAULT_LEAKAGE_POLICY,
    ) -> None:
        self.dir = Path(directory) if directory else ATLAS_DIR
        # "off", "", and None all mean no guard. Anything else is handed to
        # orcs_safe, which raises on an unknown policy rather than silently
        # passing everything through.
        self.leakage_policy = None if (leakage_policy or "off") == "off" else leakage_policy
        self._manifest: dict | None = None
        self._screens: dict[int, OrcsScreen] | None = None
        self._stats: dict[str, _GeneStat] | None = None
        self._aliases: dict[str, str] | None = None
        self._bit_position: dict[int, int] | None = None
        self._excluded: frozenset[int] = frozenset()

    # --- readiness --------------------------------------------------------

    @property
    def manifest_path(self) -> Path:
        return self.dir / MANIFEST_NAME

    def unavailable_reason(self) -> str | None:
        """None when the store is usable, otherwise why it is not."""
        if not self.dir.exists():
            return (f"the Atlas has not been built: {self.dir} does not exist. "
                    f"Run scripts/data/ingest-orcs.py")
        if not self.manifest_path.exists():
            return (f"the Atlas is incomplete: {self.manifest_path.name} is missing, so "
                    f"the ingestion did not finish. Re-run scripts/data/ingest-orcs.py "
                    f"(it resumes)")
        for name in (SCREENS_NAME, GENE_STATS_NAME):
            if not (self.dir / name).exists():
                return (f"the Atlas is incomplete: {name} is missing. Re-run "
                        f"scripts/data/ingest-orcs.py --stats")
        try:
            manifest = self.manifest()
        except Exception as exc:
            return f"the Atlas manifest could not be read: {type(exc).__name__}: {exc}"
        if not manifest.get("background_screen_ids"):
            return ("the Atlas manifest records no background screens, so every hit "
                    "rate would have a zero denominator")
        return None

    @property
    def available(self) -> bool:
        return self.unavailable_reason() is None

    # --- loading ----------------------------------------------------------

    def manifest(self) -> dict:
        if self._manifest is None:
            self._manifest = json.loads(self.manifest_path.read_text())
        return self._manifest

    def screens(self) -> dict[int, OrcsScreen]:
        """
        Every ingested screen, keyed by ORCS screen id.

        Rebuilt into orcs.OrcsScreen objects rather than read as plain
        columns, so the derived properties (modality, cell_line_key,
        usable_background) are computed by exactly one piece of code instead
        of being duplicated between the parquet columns and here. The parquet
        file does store them, for a SQL or pandas consumer, but this reader
        ignores those columns and recomputes.
        """
        if self._screens is None:
            import dataclasses

            import pyarrow.parquet as pq

            table = pq.read_table(self.dir / SCREENS_NAME)
            cols = {name: table.column(name).to_pylist() for name in table.column_names}
            # Columns are matched to dataclass fields by name rather than
            # listed out, so adding a field to OrcsScreen does not silently
            # leave it unread here. The derived columns the ingestion also
            # writes (pmid, modality, usable_background, score_1_type, ...) are
            # not fields, so they fall out of this filter and get recomputed.
            names = {f.name for f in dataclasses.fields(OrcsScreen)} - {"score_types"}
            present = [n for n in table.column_names if n in names]
            missing = sorted(names - set(present) - {"screen_id"})
            score_cols = [f"score_{k}_type" for k in range(1, 6)]

            out: dict[int, OrcsScreen] = {}
            for i in range(table.num_rows):
                kwargs = {name: cols[name][i] for name in present}
                kwargs["screen_id"] = int(kwargs["screen_id"])
                kwargs["release"] = kwargs.get("release") or ""
                kwargs["score_types"] = tuple(
                    cols[c][i] if c in cols else None for c in score_cols
                )
                out[kwargs["screen_id"]] = OrcsScreen(**kwargs)
            if missing:
                # Not fatal: an older store simply has fewer columns and those
                # fields stay at their defaults. Worth saying so once, because
                # a missing cell_line column would silently make every
                # comparability score zero.
                print(f"      atlas: {SCREENS_NAME} has no column for "
                      f"{', '.join(missing)}; those fields are unset. Re-run "
                      f"scripts/data/ingest-orcs.py --stats-only to rewrite it.")
            self._screens = out
        return self._screens

    def _leakage_excluded(self) -> frozenset[int]:
        """Screen ids the guard refuses, computed once."""
        if self.leakage_policy is None:
            return frozenset()
        from .orcs_safe import safe_ids

        safe = safe_ids(self.leakage_policy)
        return frozenset(sid for sid in self.screens() if sid not in safe)

    def background_screen_ids(self) -> list[int]:
        """
        The ordered background set. Bit i of a gene mask is this list's item i.

        The order comes from the manifest and must not be re-derived: the
        masks were written against it, so sorting or filtering it here would
        silently reassign every bit.
        """
        return [int(s) for s in self.manifest()["background_screen_ids"]]

    def bit_position(self) -> dict[int, int]:
        if self._bit_position is None:
            self._bit_position = {sid: i for i, sid in enumerate(self.background_screen_ids())}
        return self._bit_position

    def gene_stats(self) -> dict[str, _GeneStat]:
        if self._stats is None:
            import pyarrow.parquet as pq

            table = pq.read_table(self.dir / GENE_STATS_NAME)
            cols = {name: table.column(name).to_pylist() for name in table.column_names}
            out: dict[str, _GeneStat] = {}
            for i in range(table.num_rows):
                sym = cols["symbol"][i]
                out[sym] = _GeneStat(
                    symbol=sym,
                    entrez_id=cols["entrez_id"][i],
                    tested_mask=mask_to_int(cols["tested_mask"][i]),
                    hit_mask=mask_to_int(cols["hit_mask"][i]),
                    n_screens_tested=int(cols["n_screens_tested"][i]),
                    n_hits=int(cols["n_hits"][i]),
                    n_phenotypes=int(cols["n_phenotypes"][i]),
                    n_cell_lines=int(cols["n_cell_lines"][i]),
                    n_conditions=int(cols["n_conditions"][i]),
                    phenotypes=tuple(cols["phenotypes"][i] or ()),
                )
            self._stats = out
        return self._stats

    def aliases(self) -> dict[str, str]:
        """
        {alias: official symbol}, for aliases that resolve to exactly one.

        ORCS carries the authors' own symbol, which for older papers is a
        retired one (HN1, C11orf48) or, for 71 symbols in the human release,
        a date Excel produced from a gene name: "2-Mar" is MARCHF2. Without
        this map a screen naming the current symbol finds no Atlas context
        for genes whose name changed, which is the opposite of the failure
        being loud.
        """
        if self._aliases is None:
            path = self.dir / ALIASES_NAME
            if not path.exists():
                self._aliases = {}
            else:
                import pyarrow.parquet as pq

                table = pq.read_table(path)
                alias = table.column("alias").to_pylist()
                symbol = table.column("symbol").to_pylist()
                self._aliases = dict(zip(alias, symbol))
        return self._aliases

    def screen_rows_path(self, screen_id: int) -> Path:
        return self.dir / ROWS_DIR / f"screen_id={int(screen_id)}" / "rows.parquet"

    def measured_symbols(self, screen_id: int) -> set[str] | None:
        """
        The symbols one screen measured, or None if its rows were not written.

        Read straight off that screen's own parquet file. The layout is one
        directory per screen for exactly this reason: a comparable-screen
        lookup opens 25 files of ~14,000 rows instead of scanning 26 million.
        """
        path = self.screen_rows_path(screen_id)
        if not path.exists():
            return None
        import pyarrow.parquet as pq

        return set(pq.read_table(path, columns=["gene_symbol"]).column("gene_symbol").to_pylist())

    # --- queries ----------------------------------------------------------

    def comparable_screens(
        self,
        cell_line: str | None = None,
        phenotype: str | None = None,
        condition: str | None = None,
        modality: str | None = None,
        experimental_setup: str | None = None,
        library: str | None = None,
        limit: int = 25,
        background_only: bool = True,
    ) -> list[Comparable]:
        """
        Atlas screens ranked by how much they look like the query.

        Only screens scoring above zero are returned, and by default only
        background screens: a hit-list-only deposit is a fine thing to cite
        in a report but it cannot contribute to a rate, and returning it here
        would put it into the related set and therefore into the unrelated
        denominators.
        """
        screens = self.screens()
        excluded = self._leakage_excluded()
        out: list[Comparable] = []
        for sid, screen in screens.items():
            if sid in excluded:
                continue
            if background_only and not screen.usable_background:
                continue
            score, matched = comparability(
                screen, cell_line=cell_line, phenotype=phenotype, condition=condition,
                modality=modality, experimental_setup=experimental_setup, library=library,
            )
            if score <= 0:
                continue
            out.append(Comparable(
                screen_id=sid, score=score, matched=matched,
                cell_line=screen.cell_line, phenotype=screen.phenotype,
                condition=screen.condition_name, modality=screen.modality,
                library=screen.library, author=screen.author, pmid=screen.pmid,
                n_genes=screen.scores_size, n_hits=screen.number_of_hits,
            ))
        # Sort by score, then by the larger screen, then by id so the order is
        # deterministic across runs and machines.
        out.sort(key=lambda c: (-c.score, -(c.n_genes or 0), c.screen_id))
        return out[:limit]

    def gene_context(
        self,
        genes: Sequence[str],
        comparable: Sequence[Comparable] | None = None,
    ) -> AtlasResult:
        """
        Per-gene Atlas context for the genes in one screen.

        comparable comes from comparable_screens. The screens in it whose
        score clears RELATED_SCORE_MIN are taken out of the unrelated
        denominator, and counted separately as corroboration. Passing None
        or an empty list makes every background screen unrelated, which is
        the right behaviour for a screen whose metadata says nothing: there
        is then no basis for calling anything related.
        """
        reason = self.unavailable_reason()
        if reason:
            return AtlasResult(available=False, reason=reason,
                               leakage_policy=self.leakage_policy)
        if len(genes) > MAX_CONTEXT_GENES:
            raise ValueError(
                f"asked for Atlas context on {len(genes):,} genes, over the "
                f"{MAX_CONTEXT_GENES:,} guard. Batch the call."
            )

        manifest = self.manifest()
        stats = self.gene_stats()
        aliases = self.aliases()
        positions = self.bit_position()
        n_bits = len(positions)
        excluded = self._leakage_excluded()

        # Start from every background screen, then remove the ones the guard
        # refuses. Doing it as a mask means the leakage policy costs one AND
        # per gene instead of a per-screen loop.
        allowed_mask = (1 << n_bits) - 1
        for sid in excluded:
            pos = positions.get(sid)
            if pos is not None:
                allowed_mask &= ~(1 << pos)

        related = [c for c in (comparable or []) if c.related]
        related_positions = [positions[c.screen_id] for c in related
                             if c.screen_id in positions and c.screen_id not in excluded]
        related_mask = mask_from_positions(related_positions, n_bits)
        related_mask = mask_to_int(related_mask) & allowed_mask
        unrelated_mask = allowed_mask & ~related_mask

        contexts: dict[str, GeneContext] = {}
        n_alias = 0
        n_missing = 0
        for raw in genes:
            symbol = (raw or "").strip()
            if not symbol:
                continue
            stat = stats.get(symbol)
            resolved: str | None = None
            if stat is None:
                target = aliases.get(symbol) or aliases.get(symbol.upper())
                if target:
                    stat = stats.get(target)
                    if stat is not None:
                        resolved = target
                        n_alias += 1
            if stat is None:
                n_missing += 1
                continue

            tested = stat.tested_mask & allowed_mask
            hit = stat.hit_mask & allowed_mask
            contexts[symbol] = GeneContext(
                symbol=symbol,
                resolved_symbol=resolved,
                n_screens_tested=popcount(tested),
                n_hits=popcount(hit),
                n_screens_unrelated=popcount(tested & unrelated_mask),
                n_hits_unrelated=popcount(hit & unrelated_mask),
                n_screens_comparable=popcount(tested & related_mask),
                n_hits_comparable=popcount(hit & related_mask),
                n_phenotypes=stat.n_phenotypes,
                n_cell_lines=stat.n_cell_lines,
                n_conditions=stat.n_conditions,
                phenotypes=stat.phenotypes,
            )

        return AtlasResult(
            available=True,
            release=manifest.get("release"),
            leakage_policy=self.leakage_policy,
            n_screens=len(self.screens()),
            n_background_screens=popcount(allowed_mask),
            n_screens_excluded_for_leakage=len(excluded),
            comparable=list(comparable or []),
            contexts=contexts,
            n_genes_resolved_by_alias=n_alias,
            n_genes_not_in_atlas=n_missing,
        )


# ---------------------------------------------------------------------------
# The pipeline's entry point
# ---------------------------------------------------------------------------

def atlas_context(
    genes: Sequence[str],
    cell_line: str | None = None,
    phenotype: str | None = None,
    condition: str | None = None,
    modality: str | None = None,
    experimental_setup: str | None = None,
    library: str | None = None,
    store: AtlasStore | None = None,
    limit: int = 25,
) -> AtlasResult:
    """
    Retrieve comparable Atlas screens and compute per-gene context. Never raises.

    The pipeline calls this and must keep going whatever happens, so every
    failure comes back as available=False with the reason in it rather than
    as an exception. A missing Atlas, a half-written one, a corrupt parquet
    file and a leakage policy that excludes everything all arrive the same
    way, and the stage reports the reason verbatim.
    """
    st_ = store or AtlasStore()
    try:
        reason = st_.unavailable_reason()
        if reason:
            return AtlasResult(available=False, reason=reason,
                               leakage_policy=st_.leakage_policy)
        comparable = st_.comparable_screens(
            cell_line=cell_line, phenotype=phenotype, condition=condition,
            modality=modality, experimental_setup=experimental_setup,
            library=library, limit=limit,
        )
        return st_.gene_context(genes, comparable)
    except Exception as exc:  # pragma: no cover - defensive, see docstring
        return AtlasResult(
            available=False,
            reason=f"the Atlas could not be read: {type(exc).__name__}: {exc}",
            leakage_policy=st_.leakage_policy,
        )


# ---------------------------------------------------------------------------
# Building: the arithmetic the ingestion needs, kept here so it is tested
# alongside the readers that consume it.
# ---------------------------------------------------------------------------

@dataclass
class GeneAccumulator:
    """
    Accumulates one gene's Atlas statistics across a streaming ingestion.

    Kept as bit positions rather than screen ids so the ingestion never holds
    26 million integers: the masks are the memory bound and they are
    177 bytes per gene per mask.
    """

    symbol: str
    entrez_id: int | None = None
    tested: int = 0                       # bitmask over background screens
    hit: int = 0
    n_screens_all: int = 0                # including non-background screens
    n_hits_all: int = 0
    phenotypes: set[str] = field(default_factory=set)
    cell_lines: set[str] = field(default_factory=set)
    conditions: set[str] = field(default_factory=set)
    aliases: set[str] = field(default_factory=set)

    def observe(
        self,
        screen: OrcsScreen,
        is_hit: bool,
        entrez_id: int | None,
        bit: int | None,
        aliases: Iterable[str] = (),
    ) -> None:
        self.n_screens_all += 1
        if is_hit:
            self.n_hits_all += 1
        if self.entrez_id is None and entrez_id is not None:
            self.entrez_id = entrez_id
        for a in aliases:
            self.aliases.add(a)
        if bit is None:
            # Not a background screen. Counted in the *_all totals so the
            # record is complete, but never in a rate.
            return
        self.tested |= 1 << bit
        if is_hit:
            self.hit |= 1 << bit
            # Only hit screens contribute to the breadth counts. "Hits in 9
            # phenotypes" is the claim being made; counting phenotypes the
            # gene was merely measured in would make every gene look broad.
            if screen.phenotype:
                self.phenotypes.add(screen.phenotype)
            if screen.cell_line_key:
                self.cell_lines.add(screen.cell_line_key)
            if screen.condition_name:
                self.conditions.add(screen.condition_name)

    def row(self, n_bits: int, max_phenotypes: int = 12) -> dict:
        n_tested = popcount(self.tested)
        n_hits = popcount(self.hit)
        return {
            "symbol": self.symbol,
            "entrez_id": self.entrez_id,
            "n_screens_tested": n_tested,
            "n_hits": n_hits,
            # hit_rate is stored so a SQL consumer does not have to divide,
            # and is None rather than 0.0 when nothing measured the gene.
            "hit_rate": (n_hits / n_tested) if n_tested else None,
            "n_screens_all": self.n_screens_all,
            "n_hits_all": self.n_hits_all,
            "n_phenotypes": len(self.phenotypes),
            "n_cell_lines": len(self.cell_lines),
            "n_conditions": len(self.conditions),
            "phenotypes": sorted(self.phenotypes)[:max_phenotypes],
            "tested_mask": self.tested.to_bytes((n_bits + 7) // 8, "little"),
            "hit_mask": self.hit.to_bytes((n_bits + 7) // 8, "little"),
        }


def invert_aliases(alias_sets: dict[str, set[str]]) -> dict[str, str]:
    """
    {alias: symbol} keeping only aliases that mean exactly one gene.

    An alias claimed by two symbols is dropped rather than resolved
    arbitrarily: resolving it would attach one gene's Atlas history to
    another, and there is no evidence here for choosing between them. Aliases
    that are themselves official symbols are dropped too, because the direct
    lookup already answers them and the alias edge would shadow it.
    """
    claims: dict[str, set[str]] = {}
    for symbol, aliases in alias_sets.items():
        for a in aliases:
            key = a.strip()
            if not key or key == symbol:
                continue
            claims.setdefault(key, set()).add(symbol)
    official = set(alias_sets)
    return {a: next(iter(s)) for a, s in claims.items()
            if len(s) == 1 and a not in official}


def _inspect(argv: Sequence[str]) -> int:
    """
    python -m splicr.atlas [GENE ...] [--cell-line X] [--condition Y] [--phenotype Z]

    Kept small and inside this module rather than added to splicr.cli, so
    inspecting the Atlas needs no change to a shared file.
    """
    import argparse

    ap = argparse.ArgumentParser(prog="python -m splicr.atlas")
    ap.add_argument("genes", nargs="*", default=[])
    ap.add_argument("--dir")
    ap.add_argument("--cell-line")
    ap.add_argument("--condition")
    ap.add_argument("--phenotype")
    ap.add_argument("--modality")
    ap.add_argument("--leakage-policy", default=DEFAULT_LEAKAGE_POLICY)
    ap.add_argument("--limit", type=int, default=12)
    args = ap.parse_args(list(argv))

    store = AtlasStore(args.dir, leakage_policy=args.leakage_policy)
    reason = store.unavailable_reason()
    print(f"store {store.dir}")
    if reason:
        print(f"  NOT AVAILABLE: {reason}")
        return 1
    m = store.manifest()
    print(f"  release {m['release']} generated {m['generated_utc']}")
    print(f"  {m['n_screens']:,} screens, {m['n_background_screens']:,} background, "
          f"{m['n_gene_rows']:,} gene rows, {m['n_hit_rows']:,} hits, "
          f"{m['n_symbols']:,} symbols")
    print(f"  leakage policy {store.leakage_policy or 'off'}: "
          f"{len(store._leakage_excluded()):,} screens held out")

    comparable = store.comparable_screens(
        cell_line=args.cell_line, phenotype=args.phenotype, condition=args.condition,
        modality=args.modality, limit=args.limit,
    )
    print(f"\ncomparable screens: {len(comparable)}")
    for c in comparable:
        print(f"  {'*' if c.related else ' '} {c.describe()}  {','.join(c.matched)}")

    if args.genes:
        result = store.gene_context(args.genes, comparable)
        print(f"\n{result.describe()}")
        for gene in args.genes:
            ctx = result.contexts.get(gene)
            if ctx is None:
                print(f"  {gene:<14} not in the Atlas")
                continue
            d = ctx.as_dict()
            rate = d["hit_rate_unrelated"]
            print(f"  {gene:<14} unrelated {ctx.n_hits_unrelated:>4}/"
                  f"{ctx.n_screens_unrelated:<5} "
                  f"{('%.1f%%' % (100 * rate)) if rate is not None else 'n/a':>7}  "
                  f"comparable {ctx.n_hits_comparable}/{ctx.n_screens_comparable}  "
                  f"{ctx.n_phenotypes} phenotypes, {ctx.n_cell_lines} lines  "
                  f"frequent_hitter={ctx.is_frequent_hitter()}")
    return 0


def summarise_gene_stats(rows: Iterable[dict]) -> dict:
    """Ingestion summary. Medians, so one enormous screen cannot set the tone."""
    tested, rates = [], []
    for r in rows:
        tested.append(r["n_screens_tested"])
        if r["hit_rate"] is not None:
            rates.append(r["hit_rate"])
    return {
        "n_genes": len(tested),
        "median_screens_per_gene": st.median(tested) if tested else None,
        "median_hit_rate": st.median(rates) if rates else None,
        "n_genes_never_measured_in_background": sum(1 for t in tested if t == 0),
    }


if __name__ == "__main__":
    import sys

    raise SystemExit(_inspect(sys.argv[1:]))
