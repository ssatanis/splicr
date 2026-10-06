"""
Hit calling.

MAGeCK RRA and MLE, BAGEL2 Bayes factors and DrugZ are run as subprocesses and
merged into one table with each method in its own columns. Nothing is
collapsed into a single statistic: when two methods disagree, that
disagreement is information the report should show, not hide.

Operational note that costs an afternoon if missed: MAGeCK shells out to the
RRA binary by bare name, so the tool environment must be on PATH. Invoking
the mageck binary by absolute path leaves RRA unresolvable and MAGeCK fails
deep inside its own log while exiting on a missing output file.
"""

from __future__ import annotations

import typing
import math
import statistics as st
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from .config import BAGEL_DIR, DRUGZ_DIR, SETTINGS, HitThresholds, tool_env
from .count import CountMatrix
from .references import Library, essentials


class ToolError(RuntimeError):
    pass


class InvertedContrastError(ValueError):
    """
    The contrast was run upside down: the library reference on the numerator.

    Raised after the callers have run, from the results themselves, because it
    is detectable there with no metadata at all. Every core essential gene
    comes out ENRICHED, which is a publication-shaped answer that happens to be
    exactly backwards, and shipping it is worse than stopping.
    """


def _run(cmd: list[str], cwd: Path, what: str) -> subprocess.CompletedProcess:
    try:
        proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=tool_env())
    except OSError as exc:
        raise ToolError(f"{what} could not start: {exc}") from exc
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "")[-2000:]
        raise ToolError(f"{what} exited {proc.returncode}\n{tail}")
    return proc


@dataclass
class GeneResult:
    """One gene, every method side by side. Missing values stay None."""

    gene: str
    n_guides: int = 0
    n_good_guides: int | None = None      # MAGeCK goodsgrna
    lfc: float | None = None
    rra_score: float | None = None
    p_value: float | None = None
    fdr: float | None = None
    rank: int | None = None
    direction: str = "depleted"
    mle_beta: float | None = None
    mle_fdr: float | None = None
    bayes_factor: float | None = None
    norm_z: float | None = None
    drugz_fdr: float | None = None
    guide_lfcs: list[float] = field(default_factory=list)
    # Preserve tool-native directional statistics separately. fdr/p_value
    # below concern a gene changing in either direction, not a selected tail.
    depleted_p_value: float | None = None
    enriched_p_value: float | None = None
    depleted_fdr: float | None = None
    enriched_fdr: float | None = None

    @property
    def max_guide_share(self) -> float | None:
        """
        Fraction of the absolute gene-level signal carried by its largest
        guide. Near 1.0 means one guide is doing all the work.
        """
        if len(self.guide_lfcs) < 2:
            return None
        mags = [abs(v) for v in self.guide_lfcs]
        total = sum(mags)
        return max(mags) / total if total > 0 else None

    @property
    def guide_agreement(self) -> float | None:
        """Share of guides pointing the same way as the gene-level effect."""
        if not self.guide_lfcs or self.lfc is None:
            return None
        want = -1 if self.lfc < 0 else 1
        same = sum(1 for v in self.guide_lfcs if (v < 0 and want < 0) or (v > 0 and want > 0))
        return same / len(self.guide_lfcs)


@dataclass
class DirectionCheck:
    """
    Which way the known-essential genes moved.

    Measured, not assumed: n_essential is how many CEGv2 core essential genes
    reached significance at all, and enriched is how many of those came out on
    the enriched side. Both None-free; when n_essential is too small to mean
    anything, `powered` is False and nothing is concluded from it.
    """

    n_essential: int
    enriched: int
    depleted: int
    powered: bool
    inverted: bool
    suspicious: bool
    examples: list[str] = field(default_factory=list)

    @property
    def enriched_share(self) -> float | None:
        return self.enriched / self.n_essential if self.n_essential else None

    def as_dict(self) -> dict:
        share = self.enriched_share
        return {"n_essential_significant": self.n_essential,
                "enriched": self.enriched, "depleted": self.depleted,
                "enriched_share": None if share is None else round(share, 4),
                "powered": self.powered, "inverted": self.inverted,
                "suspicious": self.suspicious, "examples": self.examples}


def essential_direction(
    genes: dict[str, GeneResult],
    taxid: int = 9606,
    fdr: float = 0.1,
    thresholds: HitThresholds = SETTINGS.hits,
) -> DirectionCheck:
    """
    Sign test on the core essential genes that reached significance.

    A correctly oriented screen depletes them or leaves them alone. Only an
    inverted contrast enriches them as a class, because the reference pool
    contains every guide and the endpoint has lost the ones that mattered.
    """
    ess = essentials(taxid)
    hit = [g for g in genes.values()
           if g.gene in ess and g.fdr is not None and g.fdr < fdr]
    enriched = [g for g in hit if g.direction == "enriched"]
    depleted = [g for g in hit if g.direction != "enriched"]
    n = len(hit)
    powered = n >= thresholds.min_essentials_for_direction
    share = (len(enriched) / n) if n else 0.0
    return DirectionCheck(
        n_essential=n,
        enriched=len(enriched),
        depleted=len(depleted),
        powered=powered,
        inverted=powered and share >= thresholds.inverted_enriched_share,
        suspicious=powered and thresholds.suspicious_enriched_share <= share
                   < thresholds.inverted_enriched_share,
        # Named so the message is checkable rather than just assertive.
        examples=[g.gene for g in sorted(
            enriched, key=lambda g: (g.fdr if g.fdr is not None else 1.0))[:8]],
    )


@dataclass(frozen=True)
class GuideEffect:
    """
    One guide's own measurement, still attached to the guide that produced it.

    GeneResult.guide_lfcs holds the same fold changes as a bare list, which is
    all the single-guide artifact check needs. It is not enough to say which
    guide depleted: MAGeCK's sgRNA summary is not ordered by the library file,
    guides with no reads never appear in it, and a library can carry more guides
    for a gene than the comparison scored. Recovering the pairing by position
    attributes measurements to the wrong reagents, so the key travels with the
    number from the moment it is parsed.
    """

    guide_key: str
    gene: str
    lfc: float | None = None
    #: MAGeCK's two-sided sgRNA p-value. Per-guide and not multiplicity
    #: corrected across a gene's guides; it is not a gene-level p-value and
    #: must never be combined into one.
    p_value: float | None = None
    fdr: float | None = None
    control_mean: float | None = None
    treatment_mean: float | None = None


def read_guide_effects(workdir: Path, prefix: str = "mageck") -> list[GuideEffect]:
    """
    MAGeCK's per-guide rows, keyed by the guide id MAGeCK printed.

    Returns an empty list when the summary is absent, which happens when MAGeCK
    was not the caller for this comparison. An absent file is not an error here:
    the gene-level results stand on their own and the per-guide view is simply
    unavailable.
    """
    path = workdir / f"{prefix}.sgrna_summary.txt"
    if not path.exists():
        return []
    out: list[GuideEffect] = []
    for row in _tsv_rows(path):
        key, gene = row.get("sgrna"), row.get("Gene")
        if not key or not gene:
            continue
        out.append(GuideEffect(
            guide_key=key, gene=gene,
            lfc=_num(row, "LFC"),
            p_value=_probability(row, "p.twosided"),
            fdr=_probability(row, "FDR"),
            control_mean=_num(row, "control_mean"),
            treatment_mean=_num(row, "treat_mean"),
        ))
    return out


@dataclass
class HitTable:
    genes: dict[str, GeneResult]
    methods: list[str]
    comparison: str
    treatment: list[str]
    control: list[str]
    warnings: list[str] = field(default_factory=list)
    direction: DirectionCheck | None = None
    #: Per-guide rows, when a caller produced them. Empty means unavailable.
    guide_effects: list[GuideEffect] = field(default_factory=list)

    def ranked(self, by: str = "fdr", limit: int | None = None) -> list[GeneResult]:
        def key(g: GeneResult):
            if by == "fdr":
                return (g.fdr if g.fdr is not None else 1.0,
                        g.p_value if g.p_value is not None else 1.0)
            if by == "bayes_factor":
                return -(g.bayes_factor if g.bayes_factor is not None else -1e9)
            if by == "lfc":
                return g.lfc if g.lfc is not None else 0.0
            return g.gene
        out = sorted(self.genes.values(), key=key)
        return out[:limit] if limit else out

    def significant(self, fdr: float = 0.1) -> list[GeneResult]:
        return [g for g in self.genes.values() if g.fdr is not None and g.fdr < fdr]


# ---------------------------------------------------------------------------
# MAGeCK
# ---------------------------------------------------------------------------

def _tsv_rows(path: Path) -> list[dict[str, str]]:
    text = path.read_text().replace("\r\n", "\n").replace("\r", "\n")
    lines = [l for l in text.split("\n") if l.strip()]
    if not lines:
        return []
    header = lines[0].split("\t")
    return [dict(zip(header, l.split("\t"))) for l in lines[1:]]


def _num(row: dict[str, str], key: str) -> float | None:
    v = row.get(key)
    if v is None or v == "" or v.lower() in ("na", "nan", "inf", "-inf"):
        return None
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    except (ValueError, TypeError):
        return None


def _probability(row: dict[str, str], key: str) -> float | None:
    value = _num(row, key)
    if value is not None and not 0 <= value <= 1:
        raise ToolError(f"Tool returned {key} outside [0, 1]: {value}")
    return value


def run_mageck_rra(
    counts: Path,
    treatment: list[str],
    control: list[str],
    workdir: Path,
    prefix: str = "mageck",
    norm_method: str = "median",
    control_sgrna: Path | None = None,
) -> tuple[dict[str, GeneResult], list[str]]:
    """
    MAGeCK RRA.

    Preserve MAGeCK's separate directional families, and allocate half the
    requested FDR to each. The union of discoveries then has FDR at most the
    sum of the two directional FDR bounds, subject to MAGeCK's assumptions.
    Native directional p-values and q-values remain available on every gene.
    """
    workdir.mkdir(parents=True, exist_ok=True)
    cmd = [
        "mageck", "test",
        "-k", str(counts.resolve()),
        "-t", ",".join(treatment),
        "-c", ",".join(control),
        "-n", prefix,
        "--norm-method", norm_method,
    ]
    if control_sgrna is not None:
        cmd += ["--control-sgrna", str(control_sgrna)]
    _run(cmd, workdir, "mageck test")

    gene_file = workdir / f"{prefix}.gene_summary.txt"
    if not gene_file.exists():
        raise ToolError(
            "MAGeCK produced no gene_summary. The usual cause is RRA not being on "
            "PATH: MAGeCK invokes it by bare name."
        )

    # Guide-level fold changes, for the single-guide artifact check.
    guide_lfcs: dict[str, list[float]] = {}
    sg = workdir / f"{prefix}.sgrna_summary.txt"
    if sg.exists():
        for row in _tsv_rows(sg):
            gene = row.get("Gene")
            lfc = _num(row, "LFC")
            if gene and lfc is not None:
                guide_lfcs.setdefault(gene, []).append(lfc)

    results: dict[str, GeneResult] = {}
    warnings: list[str] = []
    for row in _tsv_rows(gene_file):
        gene = row.get("id")
        if not gene or gene.upper() in ("NA", "CONTROL"):
            continue
        neg_fdr, pos_fdr = _probability(row, "neg|fdr"), _probability(row, "pos|fdr")
        neg_p = _probability(row, "neg|p-value")
        pos_p = _probability(row, "pos|p-value")
        depleted = (neg_fdr if neg_fdr is not None else 1.0) <= (pos_fdr if pos_fdr is not None else 1.0)
        side = "neg" if depleted else "pos"
        results[gene] = GeneResult(
            gene=gene,
            n_guides=int(_num(row, "num") or 0),
            n_good_guides=int(_num(row, f"{side}|goodsgrna") or 0),
            lfc=_num(row, f"{side}|lfc"),
            rra_score=_num(row, f"{side}|score"),
            # Bonferroni omnibus p-value and union-FDR bound are distinct.
            # Do not refit BH to the pooled tails: that changes the upstream
            # directional family, borrowing power across opposite directions.
            p_value=min(1.0, 2 * min(neg_p, pos_p))
                    if neg_p is not None and pos_p is not None else None,
            fdr=min(1.0, 2 * min(neg_fdr, pos_fdr))
                if neg_fdr is not None and pos_fdr is not None else None,
            depleted_p_value=neg_p, enriched_p_value=pos_p,
            depleted_fdr=neg_fdr, enriched_fdr=pos_fdr,
            rank=int(_num(row, f"{side}|rank") or 0) or None,
            direction="depleted" if depleted else "enriched",
            guide_lfcs=guide_lfcs.get(gene, []),
        )
    if any(g.p_value is None or g.fdr is None for g in results.values()):
        warnings.append("Some MAGeCK rows lack both directional statistics; the "
                        "corresponding omnibus p-value or union FDR is unavailable.")
    if not results:
        raise ToolError("MAGeCK returned no gene rows; no hit analysis is available")
    return results, warnings


def run_mageck_mle(
    counts: Path,
    design_matrix: Path,
    workdir: Path,
    prefix: str = "mageck_mle",
    permutation_round: int = 10,
    coefficient: str | None = None,
    norm_method: str = "median",
    control_sgrna: Path | None = None,
    random_seed: int = 0,
) -> dict[str, tuple[float | None, float | None]]:
    """
    MAGeCK MLE.

    permutation_round defaults to 10 rather than MAGeCK's own default of 2,
    which its documentation describes as too low for publication-grade
    p-values.
    """
    workdir.mkdir(parents=True, exist_ok=True)
    if isinstance(random_seed, bool) or not isinstance(random_seed, int) or not 0 <= random_seed <= 2**32 - 1:
        raise ValueError("MLE random seed must be an unsigned 32-bit integer")
    # MAGeCK has no seed flag. Seed both upstream RNGs before its unchanged
    # entry point runs, keeping this process isolated from the analysis worker.
    launcher = "import random,runpy,sys,numpy as np;seed=int(sys.argv.pop(1));random.seed(seed);np.random.seed(seed);sys.argv=sys.argv[1:];runpy.run_path(sys.argv[0],run_name='__main__')"
    command = [str(SETTINGS.tool_bin / "python"), "-c", launcher, str(random_seed), str(SETTINGS.tool_bin / "mageck"), "mle", "-k", str(counts.resolve()), "-d", str(design_matrix.resolve()),
               "-n", prefix, "--permutation-round", str(permutation_round), "--norm-method", norm_method]
    if control_sgrna is not None:
        command.extend(["--control-sgrna", str(control_sgrna.resolve())])
    _run(command, workdir, "mageck mle")
    gene_file = workdir / f"{prefix}.gene_summary.txt"
    if not gene_file.exists():
        raise ToolError("MAGeCK MLE produced no gene_summary.")

    out: dict[str, tuple[float | None, float | None]] = {}
    rows = _tsv_rows(gene_file)
    if not rows:
        return out
    coefficients = [c[:-5] for c in rows[0] if c.endswith("|beta") and c != "baseline|beta"]
    if coefficient is None:
        if len(coefficients) != 1:
            raise ToolError(f"MLE output has coefficients {coefficients}; select one explicitly")
        coefficient = coefficients[0]
    if coefficient not in coefficients:
        raise ToolError(f"MLE coefficient {coefficient!r} is absent from {coefficients}")
    beta_col, fdr_col = f"{coefficient}|beta", f"{coefficient}|fdr"
    for row in rows:
        gene = row.get("Gene") or row.get("id")
        if gene:
            out[gene] = (_num(row, beta_col) if beta_col else None,
                         _num(row, fdr_col) if fdr_col else None)
    return out


# ---------------------------------------------------------------------------
# BAGEL2
# ---------------------------------------------------------------------------

def run_bagel2(
    counts: Path,
    workdir: Path,
    all_samples: list[str],
    control_samples: list[str],
    treatment_samples: list[str],
    prefix: str = "bagel",
    taxid: int = 9606,
) -> dict[str, float]:
    """
    BAGEL2 fold change then Bayes factors.

    The two steps use DIFFERENT column numbering, which is the easiest thing
    to get wrong here:

      fc -c  indexes the sample columns of the COUNT table (1-based, after
             the sgRNA and Gene columns).
      bf -c  indexes the columns of the FOLDCHANGE file, which contains only
             the non-control samples. Passing count-table indices to bf
             either scores the wrong samples or fails outright.

    Gene BF is a SUM over its guides, so one extreme guide can carry a gene.
    Read it alongside the single-guide artifact flag.
    """
    if not (BAGEL_DIR / "BAGEL.py").exists():
        raise ToolError(f"BAGEL2 not found at {BAGEL_DIR}. Run engine/setup.sh.")
    workdir.mkdir(parents=True, exist_ok=True)
    python = str(SETTINGS.tool_bin / "python")

    control_cols = [all_samples.index(s) + 1 for s in control_samples if s in all_samples]
    if not control_cols:
        raise ToolError("No control sample matched the count table columns.")

    _run([python, str(BAGEL_DIR / "BAGEL.py"), "fc",
          "-i", str(counts), "-o", prefix,
          "-c", ",".join(str(c) for c in control_cols)],
         workdir, "BAGEL2 fc")

    fc = workdir / f"{prefix}.foldchange"
    if not fc.exists():
        raise ToolError("BAGEL2 fc produced no foldchange file.")

    # Re-index the treatments against the foldchange file's own header.
    fc_header = fc.read_text().split("\n")[0].split("\t")
    fc_samples = [h.strip() for h in fc_header[2:] if h.strip()]
    cols = [fc_samples.index(s) + 1 for s in treatment_samples if s in fc_samples]
    if not cols:
        raise ToolError(
            f"No treatment sample appears in the foldchange file. "
            f"Wanted {treatment_samples}, found {fc_samples}."
        )

    ess = BAGEL_DIR / ("CEGv2.txt" if taxid == 9606 else "CEG_mouse.txt")
    non = BAGEL_DIR / ("NEGv1.txt" if taxid == 9606 else "NEG_mouse.txt")

    # Long flags only: BAGEL2 registers -s twice (--use-small-sample and --seed).
    _run([python, str(BAGEL_DIR / "BAGEL.py"), "bf",
          "-i", str(fc), "-o", f"{prefix}.bf",
          "-e", str(ess), "-n", str(non),
          "-c", ",".join(str(c) for c in cols)],
         workdir, "BAGEL2 bf")

    bf_file = workdir / f"{prefix}.bf"
    out: dict[str, float] = {}
    for row in _tsv_rows(bf_file):
        gene = row.get("GENE")
        val = _num(row, "BF")
        if gene and val is not None:
            out[gene] = val
    return out


# ---------------------------------------------------------------------------
# DrugZ
# ---------------------------------------------------------------------------

def run_drugz(
    counts: Path,
    treatment: list[str],
    control: list[str],
    workdir: Path,
    prefix: str = "drugz",
    paired: bool = False,
    pseudocount: float = 5,
    half_window_size: int = 500,
) -> dict[str, tuple[float | None, float | None]]:
    """
    DrugZ normZ, for chemogenetic (drug modifier) designs.

    Returns gene -> (normZ, directional fdr). An unavailable installation or
    missing result raises ToolError, which call_hits records as a warning.
    Pairing must be explicitly declared; list order alone is not pair metadata.
    """
    script = DRUGZ_DIR / "drugz.py"
    if not script.exists():
        raise ToolError(f"DrugZ not found at {script}. Run engine/setup.sh.")
    if paired and len(treatment) != len(control):
        raise ToolError("Paired DrugZ requires one matched control per treatment sample")
    if not math.isfinite(pseudocount) or not float(pseudocount).is_integer() or not 0 < pseudocount <= 1000 or not isinstance(half_window_size, int) or not 2 <= half_window_size <= 10000:
        raise ToolError("Invalid DrugZ pseudocount or smoothing window")
    workdir = workdir.resolve()
    workdir.mkdir(parents=True, exist_ok=True)
    out_file = workdir / f"{prefix}.txt"
    cmd = [str(SETTINGS.tool_bin / "python"), str(script),
           "-i", str(counts.resolve()), "-c", ",".join(control), "-x", ",".join(treatment),
           "-o", str(out_file), "-p", str(int(pseudocount)), "--half_window_size", str(half_window_size)]
    if not paired:
        cmd.append("-unpaired")
    _run(cmd, workdir, "drugz")
    if not out_file.exists():
        raise ToolError("DrugZ produced no output table")
    out: dict[str, tuple[float | None, float | None]] = {}
    for row in _tsv_rows(out_file):
        gene = row.get("GENE") or row.get("Gene")
        if not gene:
            continue
        z = _num(row, "normZ")
        # Negative z = synthetic/sensitizing, positive z = suppressor/resistance.
        # Direction-specific FDR is not an omnibus gene-level FDR.
        fdr = (_probability(row, "fdr_synth" if z < 0 else "fdr_supp")
               if z is not None and z != 0 else None)
        out[gene] = (z, fdr)
    return out


# ---------------------------------------------------------------------------
# Consensus
# ---------------------------------------------------------------------------

def call_hits(
    matrix: CountMatrix,
    library: Library,
    treatment: list[str],
    control: list[str],
    workdir: Path,
    comparison: str = "treatment_vs_control",
    run_mle: bool = False,
    run_bagel: bool = True,
    run_drug: bool = False,
    allow_inverted: bool = False,
    essentiality_contrast: bool = False,
    mle_design_matrix: Path | None = None,
    mle_coefficient: str | None = None,
    mle_permutation_round: int = 10,
    mle_random_seed: int = 0,
    drugz_paired: bool = False,
    drugz_pseudocount: float = 5,
    drugz_half_window_size: int = 500,
    norm_method: str = "median",
    control_sgrna: Path | None = None,
    progress_fn: typing.Callable[[str], None] | None = None,
) -> HitTable:
    """
    Run every applicable caller and merge.

    A caller that fails does not abort the run: its failure is recorded as a
    warning and the remaining methods still produce a table. Losing BAGEL2 is
    much better than losing the whole screen.

    The known-essential inversion guard runs only when essentiality_contrast
    explicitly declares a loss-of-function fitness endpoint against a library
    reference. Enrichment in drug comparisons or reporter assays is not proof
    of inversion. An apparent inversion raises unless allow_inverted is set.
    """
    def report(msg: str) -> None:
        if progress_fn:
            progress_fn(msg)
    if not treatment:
        raise ValueError(
            "call_hits was given no treatment sample. MAGeCK is handed '-t ' with "
            "nothing after it and exits 255 with a log tail that names MAGeCK rather "
            "than the empty contrast."
        )
    if not control:
        raise ValueError("call_hits was given no control sample.")
    if len(set(treatment)) != len(treatment) or len(set(control)) != len(control):
        raise ValueError("contrast sample lists contain duplicate labels")
    if set(treatment) & set(control):
        raise ValueError("treatment and control samples must be disjoint")
    if run_mle and mle_design_matrix is None:
        raise ValueError("run_mle=True requires an explicit mle_design_matrix and, "
                         "for multiple coefficients, mle_coefficient")
    missing = [s for s in list(treatment) + list(control) if s not in matrix.samples]
    if missing:
        raise ValueError(
            f"contrast names sample(s) {missing}, which are not columns of the count "
            f"matrix. Its samples are {matrix.samples}."
        )
    workdir = workdir.resolve()
    workdir.mkdir(parents=True, exist_ok=True)
    counts_file = matrix.to_mageck_tsv(workdir / "counts.txt")

    methods: list[str] = []
    warnings: list[str] = []

    report("Running MAGeCK RRA...")
    genes, warn = run_mageck_rra(counts_file, treatment, control, workdir, norm_method=norm_method, control_sgrna=control_sgrna)
    methods.append("mageck_rra")
    warnings.extend(warn)
    guide_effects = read_guide_effects(workdir)

    if run_mle:
        report("Running MAGeCK MLE...")
        try:
            mle = run_mageck_mle(counts_file, mle_design_matrix, workdir,
                                 coefficient=mle_coefficient, permutation_round=mle_permutation_round, norm_method=norm_method, control_sgrna=control_sgrna, random_seed=mle_random_seed)
            for gene, (beta, fdr) in mle.items():
                if gene in genes:
                    genes[gene].mle_beta, genes[gene].mle_fdr = beta, fdr
            methods.append("mageck_mle")
        except (ToolError, ValueError) as exc:
            warnings.append(f"MAGeCK MLE did not run: {exc}")

    if run_bagel:
        report("Running BAGEL2...")
        try:
            bf = run_bagel2(counts_file, workdir,
                            all_samples=matrix.samples,
                            control_samples=control,
                            treatment_samples=treatment,
                            taxid=library.taxid)
            for gene, value in bf.items():
                if gene in genes:
                    genes[gene].bayes_factor = value
                else:
                    genes[gene] = GeneResult(gene=gene, bayes_factor=value)
            methods.append("bagel2")
        except (ToolError, ValueError) as exc:
            warnings.append(f"BAGEL2 did not run: {exc}")

    if run_drug:
        report("Running DrugZ...")
        try:
            dz = run_drugz(counts_file, treatment, control, workdir, paired=drugz_paired,
                           pseudocount=drugz_pseudocount, half_window_size=drugz_half_window_size)
            for gene, (z, fdr) in dz.items():
                if gene in genes:
                    genes[gene].norm_z, genes[gene].drugz_fdr = z, fdr
            if dz:
                methods.append("drugz")
        except ToolError as exc:
            warnings.append(f"DrugZ did not run: {exc}")

    direction = essential_direction(genes, library.taxid) if essentiality_contrast else None
    if direction is not None and direction.inverted and not allow_inverted:
        raise InvertedContrastError(
            f"the contrast looks inverted: {direction.enriched} of "
            f"{direction.n_essential} significant CEGv2 core essential genes came out "
            f"ENRICHED, only {direction.depleted} depleted "
            f"(e.g. {', '.join(direction.examples[:6])}). In an explicitly declared "
            "loss-of-function fitness contrast against a library reference this is "
            f"evidence of a possible orientation problem. Requested -t {','.join(treatment)} "
            f"-c {','.join(control)}; try it the other way round. Pass "
            "allow_inverted=True to score it as stated anyway."
        )
    if direction is not None and direction.suspicious:
        warnings.append(
            f"{direction.enriched} of {direction.n_essential} significant core essential "
            "genes came out enriched, more than a correctly oriented screen produces. "
            "Check that --treatment and --control are the way round you meant."
        )

    return HitTable(
        genes=genes,
        methods=methods,
        comparison=comparison,
        treatment=treatment,
        control=control,
        warnings=warnings,
        direction=direction,
        guide_effects=guide_effects,
    )
