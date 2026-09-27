"""
Quality control.

Every metric here is implemented to the definition its source actually uses,
because several of them are widely quoted in a form that does not match the
reference implementation:

- Gini is computed on log(count+1), as MAGeCK does. A Gini on raw counts is
  much larger and is not comparable to the usual 0.1/0.3 thresholds.
- NNMD uses median and MAD, as Chronos and current DepMap do. The original
  2019 definition used mean and SD with a -1.0 cutoff.
- The 90th/10th percentile skew ratio with a limit of 10 comes from Joung
  et al. 2017, not from Broad GPP as is often claimed.
"""

from __future__ import annotations

import math
import statistics as st
from dataclasses import dataclass, field

from .config import SETTINGS, QcThresholds
from .count import CountMatrix
from .references import Library, essentials, nonessentials

Verdict = str  # "pass" | "warn" | "fail"


def worst(*verdicts: Verdict) -> Verdict:
    if "fail" in verdicts:
        return "fail"
    if "warn" in verdicts:
        return "warn"
    return "pass"


# ---------------------------------------------------------------------------
# Primitives
# ---------------------------------------------------------------------------

def gini(counts: list[int]) -> float:
    """
    Gini index of guide abundance, MAGeCK's definition.

        G = 1 - 2 * (n - sum(i * x_i) / sum(x)) / (n - 1)

    with x sorted ascending and 1-indexed, and x = log(count + 1).
    Zero-count guides contribute log(1) = 0.
    """
    if len(counts) < 2:
        return 0.0
    xs = sorted(math.log(c + 1.0) for c in counts)
    total = sum(xs)
    if total <= 0:
        return 0.0
    n = len(xs)
    weighted = sum((i + 1) * x for i, x in enumerate(xs))
    return 1.0 - 2.0 * (n - weighted / total) / (n - 1)


def percentile(values: list[float], q: float) -> float:
    """Linear-interpolated percentile, q in [0, 1]."""
    if not values:
        return 0.0
    xs = sorted(values)
    if len(xs) == 1:
        return xs[0]
    pos = q * (len(xs) - 1)
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(xs) - 1)
    frac = pos - lo
    return xs[lo] * (1 - frac) + xs[hi] * frac


def skew_ratio(counts: list[int]) -> float:
    """90th over 10th percentile of guide counts. Joung 2017 wants under 10."""
    p10 = percentile([float(c) for c in counts], 0.10)
    p90 = percentile([float(c) for c in counts], 0.90)
    if p10 <= 0:
        return float("inf")
    return p90 / p10


def median_abs_deviation(values: list[float]) -> float:
    if not values:
        return 0.0
    med = st.median(values)
    return st.median([abs(v - med) for v in values]) or 0.0


def pearson(a: list[float], b: list[float]) -> float:
    if len(a) != len(b) or len(a) < 2:
        return 0.0
    ma, mb = st.fmean(a), st.fmean(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    da = math.sqrt(sum((x - ma) ** 2 for x in a))
    db = math.sqrt(sum((y - mb) ** 2 for y in b))
    return num / (da * db) if da and db else 0.0


def log_counts(counts: list[int], pseudocount: float = 1.0) -> list[float]:
    return [math.log2(c + pseudocount) for c in counts]


def median_ratio_size_factors(matrix: CountMatrix) -> list[float]:
    """
    Median-ratio normalisation, the same idea MAGeCK and DESeq use.

    Each sample is scaled by the median ratio of its counts to the geometric
    mean across samples, computed over guides that are non-zero everywhere.
    Robust to a minority of guides dominating the library.
    """
    n_samples = len(matrix.samples)
    usable = [row for row in matrix.matrix if all(v > 0 for v in row)]
    if not usable:
        return [1.0] * n_samples

    geo = []
    for row in usable:
        geo.append(math.exp(st.fmean([math.log(v) for v in row])))

    factors: list[float] = []
    for j in range(n_samples):
        ratios = [row[j] / g for row, g in zip(usable, geo) if g > 0]
        factors.append(st.median(ratios) if ratios else 1.0)
    return [f if f > 0 else 1.0 for f in factors]


# ---------------------------------------------------------------------------
# Per-sample QC
# ---------------------------------------------------------------------------

@dataclass
class SampleQc:
    label: str
    role: str                      # plasmid | reference | control | treatment
    total_reads: int
    mapped_reads: int
    mapping_rate: float
    n_guides: int
    zero_guides: int
    zero_fraction: float
    gini: float
    skew_ratio: float
    mean_reads_per_guide: float
    n_represented: int = 0        # guides with reads somewhere in the screen
    represented_fraction: float = 1.0
    verdict: Verdict = "pass"
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "label": self.label,
            "role": self.role,
            "total_reads": self.total_reads,
            "mapped_reads": self.mapped_reads,
            "mapping_rate": round(self.mapping_rate, 4),
            "zero_guides": self.zero_guides,
            "zero_fraction": round(self.zero_fraction, 5),
            "represented_fraction": round(self.represented_fraction, 4),
            "gini": round(self.gini, 4),
            "skew_ratio": None if math.isinf(self.skew_ratio) else round(self.skew_ratio, 2),
            "mean_reads_per_guide": round(self.mean_reads_per_guide, 1),
            "verdict": self.verdict,
            "notes": self.notes,
        }


def sample_qc(
    matrix: CountMatrix,
    sample: str,
    role: str = "treatment",
    thresholds: QcThresholds = SETTINGS.qc,
) -> SampleQc:
    """
    Per-sample QC.

    Guides with no reads in ANY sample are excluded from the zero fraction,
    Gini and skew. Those guides were never in the experiment, which is a
    different thing from a guide that was present and dropped out. Counting
    them as dropout makes a focused screen analysed against a genome-wide
    library file look like a catastrophic failure.
    """
    counts = matrix.column(sample)
    present = [any(row) for row in matrix.matrix]
    n_represented = sum(present)

    # Restrict every abundance metric to guides the experiment actually used.
    counts = [c for c, p in zip(counts, present) if p] if n_represented else counts
    n = len(counts)
    zeros = sum(1 for c in counts if c == 0)
    total_mapped = sum(counts)

    source = next((s for s in matrix.per_sample if s.label == sample), None)
    total_reads = source.total_reads if source else total_mapped
    mapping_rate = source.mapping_rate if source else 1.0

    q = SampleQc(
        label=sample,
        role=role,
        total_reads=total_reads,
        mapped_reads=total_mapped,
        mapping_rate=mapping_rate,
        n_guides=n,
        zero_guides=zeros,
        zero_fraction=zeros / n if n else 0.0,
        n_represented=n_represented,
        represented_fraction=n_represented / len(matrix.matrix) if matrix.matrix else 1.0,
        gini=gini(counts),
        skew_ratio=skew_ratio(counts),
        mean_reads_per_guide=total_mapped / n if n else 0.0,
    )

    verdicts: list[Verdict] = []

    gini_limit = (thresholds.gini_plasmid_max if role in ("plasmid", "reference")
                  else thresholds.gini_endpoint_max)
    if q.gini > gini_limit:
        verdicts.append("warn")
        q.notes.append(
            f"Gini {q.gini:.2f} above {gini_limit:.2f} for a {role} sample: guide "
            "abundance is uneven, which points to a bottleneck or uneven synthesis."
        )

    if q.zero_fraction > thresholds.zero_fraction_warn:
        verdicts.append("fail")
        q.notes.append(
            f"{q.zero_fraction:.1%} of guides have no reads. Above "
            f"{thresholds.zero_fraction_warn:.0%} the library is bottlenecked and no "
            "downstream correction recovers the lost guides."
        )
    elif q.zero_fraction > thresholds.zero_fraction_max:
        verdicts.append("warn")
        q.notes.append(f"{q.zero_fraction:.1%} of guides have no reads.")

    if source is not None:
        if q.mapping_rate < thresholds.mapping_rate_min:
            verdicts.append("fail")
            q.notes.append(
                f"Only {q.mapping_rate:.1%} of reads mapped, below the {thresholds.mapping_rate_min:.0%} "
                "floor. Check the library call and the guide offset."
            )
        elif q.mapping_rate < thresholds.mapping_rate_warn:
            verdicts.append("warn")
            q.notes.append(f"{q.mapping_rate:.1%} of reads mapped.")

    if not math.isinf(q.skew_ratio) and q.skew_ratio > thresholds.skew_ratio_max:
        verdicts.append("warn")
        q.notes.append(
            f"Skew ratio {q.skew_ratio:.1f} above {thresholds.skew_ratio_max:.0f} "
            "(90th/10th percentile guide count)."
        )

    if q.mean_reads_per_guide < thresholds.mean_reads_per_guide_min:
        verdicts.append("warn")
        q.notes.append(
            f"{q.mean_reads_per_guide:.0f} mean reads per guide, below DepMap's "
            f"{thresholds.mean_reads_per_guide_min:.0f} floor."
        )

    q.verdict = worst(*verdicts) if verdicts else "pass"
    return q


# ---------------------------------------------------------------------------
# Screen-level QC
# ---------------------------------------------------------------------------

@dataclass
class ReplicatePair:
    a: str
    b: str
    r: float


@dataclass
class ScreenQc:
    samples: list[SampleQc]
    replicate_pairs: list[ReplicatePair]
    nnmd: float | None
    auroc: float | None
    n_essential_found: int
    n_nonessential_found: int
    bottlenecked: list[str]
    verdict: Verdict
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "verdict": self.verdict,
            "nnmd": None if self.nnmd is None else round(self.nnmd, 3),
            "auroc": None if self.auroc is None else round(self.auroc, 4),
            "n_essential_found": self.n_essential_found,
            "n_nonessential_found": self.n_nonessential_found,
            "bottlenecked": self.bottlenecked,
            "replicate_correlations": [
                {"a": p.a, "b": p.b, "r": round(p.r, 4)} for p in self.replicate_pairs
            ],
            "samples": [s.as_dict() for s in self.samples],
            "notes": self.notes,
        }


def gene_log_fold_changes(
    matrix: CountMatrix,
    treatment: list[str],
    control: list[str],
) -> dict[str, float]:
    """
    Median-normalised gene-level log2 fold change.

    Gene score is the median across its guides, which is less sensitive to a
    single extreme guide than the mean.

    Guides with no reads in ANY sample are excluded. They carry no
    information, and including them pins a large block of genes at exactly
    zero, which collapses the nonessential MAD that NNMD divides by. That
    happens whenever a library is only partly represented, for example a
    focused screen analysed against the full genome-wide library file.
    """
    factors = median_ratio_size_factors(matrix)
    idx = {s: i for i, s in enumerate(matrix.samples)}
    t_idx = [idx[s] for s in treatment if s in idx]
    c_idx = [idx[s] for s in control if s in idx]
    if not t_idx or not c_idx:
        return {}

    per_gene: dict[str, list[float]] = {}
    for i, gene in enumerate(matrix.genes):
        if not gene:
            continue
        row = matrix.matrix[i]
        if not any(row):
            continue
        t = st.fmean([row[j] / factors[j] for j in t_idx])
        c = st.fmean([row[j] / factors[j] for j in c_idx])
        per_gene.setdefault(gene, []).append(math.log2((t + 1.0) / (c + 1.0)))

    return {g: st.median(v) for g, v in per_gene.items()}


def auroc(positives: list[float], negatives: list[float]) -> float:
    """
    AUROC via the Mann-Whitney statistic, with ties counted as half.

    Here "positive" means essential, and essentials are expected to have the
    more negative fold change, so the caller passes negated values.
    """
    if not positives or not negatives:
        return 0.5
    merged = sorted([(v, 1) for v in positives] + [(v, 0) for v in negatives])
    rank_sum = 0.0
    i = 0
    rank = 1
    while i < len(merged):
        j = i
        while j + 1 < len(merged) and merged[j + 1][0] == merged[i][0]:
            j += 1
        avg_rank = (rank + (rank + (j - i))) / 2
        for k in range(i, j + 1):
            if merged[k][1] == 1:
                rank_sum += avg_rank
        rank += (j - i + 1)
        i = j + 1
    n1, n2 = len(positives), len(negatives)
    u = rank_sum - n1 * (n1 + 1) / 2
    return u / (n1 * n2)


def nnmd(lfc: dict[str, float], taxid: int = 9606) -> tuple[float | None, int, int, str | None]:
    """
    Null-normalised median difference.

        (median(essential) - median(nonessential)) / MAD(nonessential)

    DepMap passes a screen at <= -1.25. Returns (value, n_ess, n_non, reason),
    where reason explains a None rather than leaving the caller guessing.
    """
    ess, non = essentials(taxid), nonessentials(taxid)
    e = [v for g, v in lfc.items() if g in ess]
    n = [v for g, v in lfc.items() if g in non]
    if len(e) < 10 or len(n) < 10:
        return None, len(e), len(n), (
            f"only {len(e)} essential and {len(n)} nonessential reference genes were "
            "measured in this screen, too few to compute NNMD"
        )
    mad = median_abs_deviation(n)
    if mad == 0:
        return None, len(e), len(n), (
            "the nonessential fold changes have zero spread, so NNMD has no scale to "
            "divide by. This usually means most guides have no reads"
        )
    return (st.median(e) - st.median(n)) / mad, len(e), len(n), None


def screen_qc(
    matrix: CountMatrix,
    roles: dict[str, str],
    treatment: list[str],
    control: list[str],
    library: Library,
    thresholds: QcThresholds = SETTINGS.qc,
) -> ScreenQc:
    samples = [sample_qc(matrix, s, roles.get(s, "treatment"), thresholds) for s in matrix.samples]

    # Replicate agreement on log counts, for samples sharing a role.
    pairs: list[ReplicatePair] = []
    by_role: dict[str, list[str]] = {}
    for s in matrix.samples:
        by_role.setdefault(roles.get(s, "treatment"), []).append(s)
    for role, group in by_role.items():
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                pairs.append(
                    ReplicatePair(
                        group[i], group[j],
                        pearson(log_counts(matrix.column(group[i])),
                                log_counts(matrix.column(group[j]))),
                    )
                )

    lfc = gene_log_fold_changes(matrix, treatment, control)
    value, n_ess, n_non, nnmd_reason = nnmd(lfc, library.taxid)

    area = None
    if lfc:
        ess, non = essentials(library.taxid), nonessentials(library.taxid)
        pos = [-v for g, v in lfc.items() if g in ess]
        neg = [-v for g, v in lfc.items() if g in non]
        if pos and neg:
            area = auroc(pos, neg)

    # Bottleneck: a sample losing far more guides than its peers.
    median_zero = st.median([s.zero_fraction for s in samples]) if samples else 0.0
    bottlenecked = [
        s.label for s in samples
        if s.zero_fraction - median_zero > thresholds.bottleneck_guide_loss
    ]

    notes: list[str] = []
    verdicts: list[Verdict] = [s.verdict for s in samples]

    represented = samples[0].represented_fraction if samples else 1.0
    if represented < 0.5:
        notes.append(
            f"Only {represented:.0%} of the library has reads in any sample. That is "
            "expected for a focused screen scored against a genome-wide library file, "
            "and the abundance metrics below are computed over the represented guides "
            "only. If this was meant to be genome-wide, the library call is wrong."
        )

    if value is None:
        notes.append(f"NNMD could not be computed: {nnmd_reason}.")
        verdicts.append("warn")
    elif value > thresholds.nnmd_max:
        verdicts.append("fail")
        notes.append(
            f"NNMD {value:.2f} is worse than DepMap's {thresholds.nnmd_max} threshold: "
            "known essential genes are not separating from nonessentials, so hit calls "
            "from this screen are not trustworthy."
        )
    else:
        notes.append(f"NNMD {value:.2f} passes (threshold {thresholds.nnmd_max}).")

    for p in pairs:
        if p.r < thresholds.replicate_r_min:
            verdicts.append("warn")
            notes.append(f"Replicates {p.a} and {p.b} correlate at r={p.r:.2f}.")

    for label in bottlenecked:
        verdicts.append("warn")
        notes.append(
            f"{label} lost markedly more guides than its peers and is treated as "
            "bottlenecked; its contribution is down-weighted."
        )

    return ScreenQc(
        samples=samples,
        replicate_pairs=pairs,
        nnmd=value,
        auroc=area,
        n_essential_found=n_ess,
        n_nonessential_found=n_non,
        bottlenecked=bottlenecked,
        verdict=worst(*verdicts) if verdicts else "pass",
        notes=notes,
    )
