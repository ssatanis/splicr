"""
Run the SplicR pipeline on a StudyPlan whose FASTQ are on disk.

Counting happens once per sample, not once per contrast: a study with a drug arm
and a vehicle arm against one T0 would otherwise count the T0 reads twice. The
counts are written as one matrix; each contrast then runs the normal pipeline
(QC, MAGeCK RRA, BAGEL2 where eligible, artifact flags, Atlas context) on the
columns it uses. Per-sample read totals and mapping rates, which a count table
cannot carry, are kept from the counting step and returned alongside.

The library is identified from the reads (detect.detect_from_fastq), never from
the metadata text. A study whose reads match no library SplicR holds is not
analyzed: it is sent to review with the best candidate and its match rate.
"""

from __future__ import annotations

import csv
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from .models import StudyPlan


class LibraryNotRecognized(RuntimeError):
    pass


@dataclass
class ContrastResult:
    name: str
    result: object                      # splicr.pipeline.PipelineResult
    treatment: list[str]
    control: list[str]
    library_slug: str = ""


@dataclass
class StudyResult:
    accession: str
    library_slug: str
    library_name: str
    detection: str
    samples: dict[str, dict] = field(default_factory=dict)   # label -> {run, library, total_reads, mapped, mapping_rate}
    counts_paths: dict[str, Path] = field(default_factory=dict)   # library slug -> count table
    contrasts: list[ContrastResult] = field(default_factory=list)


def _count_one(args):
    from ..count import count_fastq
    from ..references import load_library

    path, slug, label, location = args
    return count_fastq(Path(path), load_library(slug), label=label, location=location)


def analyze(plan: StudyPlan, fastq_by_run: dict[str, Path], workdir: Path, processes: int = 4) -> StudyResult:
    from ..count import CountMatrix, detect_spacer_location, iter_reads
    from ..detect import detect_from_fastq
    from ..pipeline import ScreenInput, run_pipeline
    from ..references import load_library

    roles = [r for r in plan.roles if r.role != "exclude" and r.run in fastq_by_run]
    if not roles:
        raise ValueError(f"{plan.accession}: no included run has a downloaded FASTQ")
    # Several runs may share one label: technical runs (lanes, resequencing) of
    # one biological sample. Each run is counted on its own and the counts are
    # summed per label, so MAGeCK sees one sample, not pseudo-replicates.
    label_runs: dict[str, list[str]] = {}
    for r in roles:
        label_runs.setdefault(r.label, []).append(r.run)
    label_path = {label: fastq_by_run[runs[0]] for label, runs in label_runs.items()}
    label_run = {label: "+".join(runs) for label, runs in label_runs.items()}

    # The library is detected per run, not per study. Studies routinely
    # sequence a split library's halves as separate runs (GeCKO v2 A and B in
    # GSE145743), and a SuperSeries can hold two different screens. Runs are
    # grouped by library and each group is counted and analyzed on its own.
    groups: dict[str, list[str]] = {}
    detections: dict[str, str] = {}
    for label, path in label_path.items():
        det = detect_from_fastq(path)
        if not det.confident or det.best is None:
            top = (f"{det.best.slug} explained {det.best.match_rate:.1%} of sampled reads"
                   if det.best else "no library matched")
            raise LibraryNotRecognized(f"{label_run[label]}: library not identified from reads ({top}). "
                                       f"{det.describe()}")
        groups.setdefault(det.best.slug, []).append(label)
        detections[label] = det.describe()

    out = StudyResult(plan.accession, "+".join(sorted(groups)), "", "; ".join(sorted(set(detections.values()))))
    role_of = {r.label: r.role for r in roles}
    names = []
    for slug, labels in sorted(groups.items()):
        library = load_library(slug)
        names.append(library.name)
        # One spacer location per library group, found on a reference sample
        # when there is one: plasmid/T0 reads cover the whole library, whereas a
        # strongly selected arm can be dominated by a few guides.
        probe = next((l for l in labels if role_of[l] in ("plasmid", "reference")), labels[0])
        location = detect_spacer_location(list(iter_reads(label_path[probe], limit=200_000)), library)
        jobs = [(str(fastq_by_run[run]), slug, l, location) for l in labels for run in label_runs[l]]
        with ProcessPoolExecutor(max_workers=max(1, min(processes, len(jobs)))) as pool:
            per_run = list(pool.map(_count_one, jobs))
        samples = [merge_runs([c for c in per_run if c.label == l]) for l in labels]
        matrix = CountMatrix.from_samples(library, samples)
        gdir = workdir / slug
        counts_path = matrix.to_mageck_tsv(gdir / f"{plan.accession}.{slug}.counts.txt")
        out.counts_paths[slug] = counts_path
        for smp in samples:
            out.samples[smp.label] = {"run": label_run[smp.label], "library": slug,
                                      "total_reads": smp.total_reads, "mapped": smp.mapped,
                                      "mapping_rate": round(smp.mapping_rate, 4), "anchor_rate": smp.anchor_rate}

        in_group = set(labels)
        for c in plan.contrasts:
            treat = [l for l in c.treatment if l in in_group]
            ctrl = [l for l in c.control if l in in_group]
            if not treat or not ctrl:
                continue
            used = [l for l in labels if l in treat or l in ctrl or role_of[l] in ("plasmid", "reference")]
            name = c.name if len(groups) == 1 else f"{c.name}@{slug}"
            sub = _subset_counts(counts_path, gdir / name / "counts.txt", used)
            spec = ScreenInput(
                name=f"{plan.accession} {name}",
                count_table=sub,
                roles={l: role_of[l] for l in used},
                treatment=treat,
                control=ctrl,
                library_slug=slug,
                cell_line=plan.cell_line_raw,
                model_id=_depmap_id(plan.cell_line_rrid),
                phenotype=plan.phenotype,
                modality=plan.modality or "knockout",
                condition=name,
                fitness_assay=True if c.kind == "dropout" else (False if c.kind == "sorting" else None),
                run_drugz=c.kind == "drug_modifier",
            )
            res = run_pipeline(spec, gdir / name, persist=False, verbose=False)
            out.contrasts.append(ContrastResult(name, res, treat, ctrl, slug))
    out.library_name = " + ".join(names)
    if not out.contrasts:
        raise ValueError(f"{plan.accession}: no contrast has treatment and control runs in the same library")
    return out


def merge_runs(parts: list):
    """Sum per-run SampleCounts that belong to one sample (same label)."""
    if len(parts) == 1:
        return parts[0]
    from collections import Counter

    from ..count import SampleCounts

    total: Counter = Counter()
    for p in parts:
        total.update(p.counts)
    first = parts[0]
    return SampleCounts(
        label=first.label, counts=dict(total),
        total_reads=sum(p.total_reads for p in parts), mapped_exact=sum(p.mapped_exact for p in parts),
        mapped_mismatch=sum(p.mapped_mismatch for p in parts), unmapped=sum(p.unmapped for p in parts),
        no_spacer=sum(p.no_spacer for p in parts), with_anchor=sum(p.with_anchor for p in parts),
        anchor_name=first.anchor_name, location=first.location)


def _subset_counts(src: Path, dest: Path, labels: list[str]) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(src, newline="") as fh, open(dest, "w", newline="") as out:
        r = csv.reader(fh, delimiter="\t")
        w = csv.writer(out, delimiter="\t", lineterminator="\n")
        header = next(r)
        keep = [0, 1] + [header.index(l) for l in labels]
        w.writerow([header[i] for i in keep])
        for row in r:
            w.writerow([row[i] for i in keep])
    return dest


def _depmap_id(rrid: str | None) -> str | None:
    """DepMap ModelID for the line, so copy-number artifact flags can use measured CN."""
    if not rrid:
        return None
    from .. import harmonize

    rec = harmonize.cell_lines().records.get(rrid)
    return rec["depmap_ids"][0] if rec and rec.get("depmap_ids") else None
