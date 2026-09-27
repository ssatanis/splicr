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

import math
import statistics as st
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from .config import BAGEL_DIR, DRUGZ_DIR, SETTINGS, tool_env
from .count import CountMatrix
from .references import Library


class ToolError(RuntimeError):
    pass


def _run(cmd: list[str], cwd: Path, what: str) -> subprocess.CompletedProcess:
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=tool_env())
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
class HitTable:
    genes: dict[str, GeneResult]
    methods: list[str]
    comparison: str
    treatment: list[str]
    control: list[str]
    warnings: list[str] = field(default_factory=list)

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

    Genes are ranked by the negative (depleted) direction by default; the
    positive columns are read too so enrichment screens work from the same
    call.
    """
    workdir.mkdir(parents=True, exist_ok=True)
    cmd = [
        "mageck", "test",
        "-k", str(counts),
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
        neg_fdr, pos_fdr = _num(row, "neg|fdr"), _num(row, "pos|fdr")
        depleted = (neg_fdr if neg_fdr is not None else 1.0) <= (pos_fdr if pos_fdr is not None else 1.0)
        side = "neg" if depleted else "pos"
        results[gene] = GeneResult(
            gene=gene,
            n_guides=int(_num(row, "num") or 0),
            n_good_guides=int(_num(row, f"{side}|goodsgrna") or 0),
            lfc=_num(row, f"{side}|lfc"),
            rra_score=_num(row, f"{side}|score"),
            p_value=_num(row, f"{side}|p-value"),
            fdr=_num(row, f"{side}|fdr"),
            rank=int(_num(row, f"{side}|rank") or 0) or None,
            direction="depleted" if depleted else "enriched",
            guide_lfcs=guide_lfcs.get(gene, []),
        )
    if not results:
        warnings.append("MAGeCK returned no gene rows.")
    return results, warnings


def run_mageck_mle(
    counts: Path,
    design_matrix: Path,
    workdir: Path,
    prefix: str = "mageck_mle",
    permutation_round: int = 10,
) -> dict[str, tuple[float | None, float | None]]:
    """
    MAGeCK MLE.

    permutation_round defaults to 10 rather than MAGeCK's own default of 2,
    which its documentation describes as too low for publication-grade
    p-values.
    """
    workdir.mkdir(parents=True, exist_ok=True)
    _run(
        ["mageck", "mle", "-k", str(counts), "-d", str(design_matrix),
         "-n", prefix, "--permutation-round", str(permutation_round)],
        workdir, "mageck mle",
    )
    gene_file = workdir / f"{prefix}.gene_summary.txt"
    if not gene_file.exists():
        raise ToolError("MAGeCK MLE produced no gene_summary.")

    out: dict[str, tuple[float | None, float | None]] = {}
    rows = _tsv_rows(gene_file)
    if not rows:
        return out
    beta_col = next((c for c in rows[0] if c.endswith("|beta") and "baseline" not in c), None)
    fdr_col = next((c for c in rows[0] if c.endswith("|fdr") and "wald" not in c), None)
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
) -> dict[str, tuple[float | None, float | None]]:
    """
    DrugZ normZ, for chemogenetic (drug modifier) designs.

    Returns gene -> (normZ, fdr). Empty when DrugZ is not installed, so the
    consensus simply proceeds without it.
    """
    script = DRUGZ_DIR / "drugz.py"
    if not script.exists():
        return {}
    workdir.mkdir(parents=True, exist_ok=True)
    out_file = workdir / f"{prefix}.txt"
    _run([str(SETTINGS.tool_bin / "python"), str(script),
          "-i", str(counts), "-c", ",".join(control), "-x", ",".join(treatment),
          "-o", str(out_file)],
         workdir, "drugz")
    if not out_file.exists():
        return {}
    out: dict[str, tuple[float | None, float | None]] = {}
    for row in _tsv_rows(out_file):
        gene = row.get("GENE") or row.get("Gene")
        if not gene:
            continue
        z = _num(row, "normZ")
        fdr = _num(row, "fdr_supp") or _num(row, "fdr_synth")
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
) -> HitTable:
    """
    Run every applicable caller and merge.

    A caller that fails does not abort the run: its failure is recorded as a
    warning and the remaining methods still produce a table. Losing BAGEL2 is
    much better than losing the whole screen.
    """
    workdir.mkdir(parents=True, exist_ok=True)
    counts_file = matrix.to_mageck_tsv(workdir / "counts.txt")

    methods: list[str] = []
    warnings: list[str] = []

    genes, warn = run_mageck_rra(counts_file, treatment, control, workdir)
    methods.append("mageck_rra")
    warnings.extend(warn)

    if run_bagel:
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
        try:
            dz = run_drugz(counts_file, treatment, control, workdir)
            for gene, (z, fdr) in dz.items():
                if gene in genes:
                    genes[gene].norm_z, genes[gene].drugz_fdr = z, fdr
            if dz:
                methods.append("drugz")
        except ToolError as exc:
            warnings.append(f"DrugZ did not run: {exc}")

    return HitTable(
        genes=genes,
        methods=methods,
        comparison=comparison,
        treatment=treatment,
        control=control,
        warnings=warnings,
    )
