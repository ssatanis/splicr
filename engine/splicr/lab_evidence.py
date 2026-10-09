"""Deterministic, versioned laboratory evidence. Never changes caller statistics.

Time slopes use independent, declared biological trajectories as the uncertainty
unit. Guides and repeated time points are not independent biological replicates.
Reference context is not experimental validation; drift does not identify a
contaminant. JSON is strict: missing values are null, never NaN or guessed zeros.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from scipy.stats import t as student_t

SCHEMA = "splicr.lab-evidence.v1"


def receipt(kind: str, gene: str, payload: dict, inputs: dict) -> dict:
    body = {"schema": SCHEMA, "kind": kind, "gene": gene, "inputs": inputs, "payload": payload}
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return {**body, "sha256": hashlib.sha256(canonical.encode()).hexdigest(), "canonical": canonical}


def validate_options(options: dict, samples: list[str]) -> None:
    if not isinstance(options, dict):
        raise ValueError("lab evidence settings must be an object")
    allowed = {"isoforms", "context", "depmap_release", "transcript_expression", "expression_source",
               "time_course", "kinetic_normalization", "pseudocount", "reagent_lot", "transcript_expression_file_id", "expression_source_sha256"}
    if set(options) - allowed:
        raise ValueError("unknown lab evidence setting: " + ", ".join(sorted(set(options) - allowed)))
    for key in ("isoforms", "context"):
        if key in options and not isinstance(options[key], bool):
            raise ValueError(f"{key} must be a boolean")
    if options.get("depmap_release", "24Q4") not in ("24Q4", "26Q1"):
        raise ValueError("choose a supported, pinned DepMap release: 24Q4 or 26Q1")
    if options.get("kinetic_normalization", "median") not in ("median", "control"):
        raise ValueError("kinetic normalization must be median or control")
    pc = options.get("pseudocount", 1)
    if isinstance(pc, bool) or not isinstance(pc, (int, float)) or not math.isfinite(pc) or pc <= 0:
        raise ValueError("kinetic pseudocount must be finite and positive")
    if options.get("transcript_expression_file_id") and not options.get("isoforms"):
        raise ValueError("an expression file requires isoform mapping")
    expression = options.get("transcript_expression")
    if expression is not None:
        if not options.get("isoforms") or not options.get("expression_source"):
            raise ValueError("transcript expression requires isoform mapping and a named measurement source")
        if not isinstance(expression, dict) or not expression:
            raise ValueError("transcript expression must be a nonempty transcript-to-abundance object")
        for key, value in expression.items():
            if not isinstance(key, str) or not key or isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise ValueError("transcript abundances must be finite nonnegative measurements")
    entries = options.get("time_course", [])
    if not isinstance(entries, list) or len(entries) > 500:
        raise ValueError("time course must contain at most 500 declared samples")
    used, groups = set(), defaultdict(list)
    for row in entries:
        if not isinstance(row, dict) or set(row) != {"sample", "day", "replicate", "condition"}:
            raise ValueError("each time point needs sample, day, biological replicate and condition")
        sample, day = row["sample"], row["day"]
        if sample not in samples or sample in used:
            raise ValueError("time course samples must occur in the count matrix exactly once")
        if isinstance(day, bool) or not isinstance(day, (int, float)) or not math.isfinite(day) or day < 0:
            raise ValueError("time must be finite, nonnegative days from a shared declared origin")
        if not all(isinstance(row[k], str) and row[k].strip() for k in ("condition", "replicate")):
            raise ValueError("name each condition and biological replicate")
        used.add(sample)
        groups[(row["condition"], row["replicate"])].append(day)
    for days in groups.values():
        if len(set(days)) != len(days) or len(days) < 3:
            raise ValueError("each biological trajectory needs at least three distinct time points")


def _matrix(matrix):
    counts = np.asarray(matrix.matrix, dtype=float)
    if counts.shape != (len(matrix.guide_ids), len(matrix.samples)) or not counts.size:
        raise ValueError("count matrix dimensions are inconsistent or empty")
    if not np.isfinite(counts).all() or (counts < 0).any():
        raise ValueError("counts must be finite and nonnegative")
    return counts


def _size_factors(counts: np.ndarray, controls: list[int] | None = None) -> np.ndarray:
    """Median ratios on guides positive in every selected sample; no fake scale."""
    rows = counts if controls is None else counts[controls]
    rows = rows[(rows > 0).all(axis=1)]
    if not len(rows):
        raise ValueError("normalization needs guides with positive counts in every selected sample")
    geom = np.exp(np.log(rows).mean(axis=1))
    sf = np.median(rows / geom[:, None], axis=0)
    if not np.isfinite(sf).all() or (sf <= 0).any():
        raise ValueError("kinetic size factors are undefined")
    return sf / np.exp(np.log(sf).mean())


def kinetics(matrix, library, options: dict) -> dict[str, dict]:
    entries = options.get("time_course", [])
    if not entries:
        return {}
    validate_options(options, matrix.samples)
    # Excluded samples must not influence this analysis's normalization.
    columns = [matrix.samples.index(row["sample"]) for row in entries]
    counts = _matrix(matrix)[:, columns]
    control_keys = {g.guide_id for g in library.guides if g.is_control}
    controls = [i for i, key in enumerate(matrix.guide_ids) if key in control_keys]
    norm = options.get("kinetic_normalization", "median")
    if norm == "control" and len(controls) < 10:
        raise ValueError("kinetic control normalization requires at least ten measured negative-control guides")
    sf = _size_factors(counts, controls if norm == "control" else None)
    pc = float(options.get("pseudocount", 1))
    logc = np.log2(counts / sf + pc)
    genes, groups = defaultdict(list), defaultdict(list)
    for i, gene in enumerate(matrix.genes):
        if gene and matrix.guide_ids[i] not in control_keys:
            genes[gene].append(i)
    for j, row in enumerate(entries):
        groups[(row["condition"], row["replicate"])].append((float(row["day"]), j))
    output = {}
    for gene, indices in sorted(genes.items()):
        trajectories, unmeasured_trajectories, by_condition = [], [], defaultdict(list)
        # Entirely absent guides have no kinetic measurement. Don't fit pc-only zeros.
        measured = [i for i in indices if (counts[i] > 0).any()]
        if not measured:
            output[gene] = {"status": "not_measured", "reason": "All guides for this gene have zero counts at every selected time point; no kinetic curve was fitted."}
            continue
        for (condition, replicate), points in sorted(groups.items()):
            points = sorted(points)
            days = np.array([day for day, _ in points])
            js = [j for _, j in points]
            measured_here = [i for i in measured if (counts[i,js] > 0).any()]
            absent = [{"guide_key": matrix.guide_ids[i], "counts": counts[i,js].tolist()} for i in indices if i not in measured_here]
            if not measured_here:
                unmeasured_trajectories.append({"condition":condition,"replicate":replicate,
                    "days":days.tolist(),"samples":[entries[j]["sample"] for j in js],"guides":absent,
                    "reason":"All guide counts are zero in this trajectory; no slope or replicate was inferred."})
                continue
            # Average measured guides only; zero-only trajectories aren't replication.
            changes = logc[measured_here][:, js] - logc[measured_here][:, js[0]][:, None]
            mean = changes.mean(axis=0)
            centered = days - days.mean()
            slope = float(centered @ mean / (centered @ centered))
            intercept = float(mean.mean() - slope * days.mean())
            fitted = intercept + slope * days
            residual = float(np.sqrt(np.mean((mean - fitted) ** 2)))
            trajectory = {"condition": condition, "replicate": replicate, "days": days.tolist(),
                          "samples": [entries[j]["sample"] for j in js], "mean_lfc": mean.tolist(),
                          "slope": slope, "intercept": intercept, "residual_rmse": residual, "unmeasured_guides": absent,
                          "guides": [{"guide_key": matrix.guide_ids[i], "lfc": changes[k].tolist(),
                                      "counts": counts[i, js].tolist()} for k, i in enumerate(measured_here)]}
            trajectories.append(trajectory)
            by_condition[condition].append(slope)
        summaries = []
        for condition, slopes in sorted(by_condition.items()):
            mean, n = float(np.mean(slopes)), len(slopes)
            se = float(np.std(slopes, ddof=1) / np.sqrt(n)) if n >= 2 else None
            width = float(student_t.ppf(.975, n - 1) * se) if se is not None else None
            summaries.append({"condition": condition, "slope": mean, "n_replicates": n,
                              "standard_error": se,
                              "ci95": [mean - width, mean + width] if width is not None else None})
        output[gene] = {"status": "measured", "unit": "log2 relative abundance / day",
                        "n_guides": len(measured), "excluded_all_zero_guides": len(indices) - len(measured),
                        "normalization": norm, "pseudocount": pc,
                        "size_factors": {row["sample"]: float(sf[j]) for j, row in enumerate(entries)},
                        "trajectories": trajectories, "unmeasured_trajectories": unmeasured_trajectories, "conditions": summaries,
                        "interpretation": "A descriptive linear trend, not a mechanistic or essentiality call. Confidence intervals use declared independent biological trajectories, not guides. Shared library scaling and low-count pseudocounts can affect slopes; inspect the guide curves and fit residuals."}
    return output


def drift(matrix, library, effects, roles: dict, reagent_lot: str | None = None) -> dict:
    """Raw-count Lorenz/Gini and control-guide dispersions, without etiology."""
    from .references import essentials
    counts = _matrix(matrix)
    samples, flags = [], []
    for j, name in enumerate(matrix.samples):
        sorted_counts = np.sort(counts[:, j])
        total = float(sorted_counts.sum())
        n = len(sorted_counts)
        cumulative = np.concatenate(([0.], np.cumsum(sorted_counts)))
        positions = np.unique(np.round(np.linspace(0, n, min(n + 1, 101))).astype(int))
        gini = float(2 * np.dot(np.arange(1, n + 1), sorted_counts) / (n * total) - (n + 1) / n) if total else None
        top_tenth_share = float(sorted_counts[-max(1,math.ceil(n*.1)):].sum()/total) if total else None
        if roles.get(name) in {"reference", "plasmid"} and top_tenth_share is not None and top_tenth_share >= .9:
            flags.append({"sample": name, "severity": "critical_review", "code": "baseline_concentration",
                          "value": top_tenth_share, "threshold": .9,
                          "message": "The most abundant 10% of guides carry at least 90% of raw reads. Review library representation and preparation before interpreting hits; this does not identify its cause."})
        samples.append({"sample": name, "role": roles.get(name), "n_guides": n, "total_counts": total,
                        "zero_fraction": float((sorted_counts == 0).mean()), "raw_count_gini": gini, "top_10_percent_read_share": top_tenth_share,
                        "lorenz": [[float(i / n), float(cumulative[i] / total)] for i in positions] if total else [],
                        "baseline": roles.get(name) in {"reference", "plasmid"}})
    negative = {g.guide_id for g in library.guides if g.is_control}
    try:
        core = essentials(library.taxid)
        core_source = "CEGv2" if library.taxid == 9606 else "SplicR pinned species essential reference"
    except FileNotFoundError:
        core, core_source = set(), "unavailable"
    def dispersion(rows):
        values = np.asarray([r.lfc for r in rows if r.lfc is not None and math.isfinite(r.lfc)])
        return {"n_guides": len(values), "median_lfc": float(np.median(values)) if len(values) else None,
                "sd_lfc": float(np.std(values, ddof=1)) if len(values) >= 2 else None,
                "mad_lfc": float(np.median(np.abs(values - np.median(values)))) if len(values) else None,
                "status": "measured" if len(values) >= 10 else "insufficient_controls"}
    ntc = dispersion([r for r in effects if r.guide_key in negative])
    core_rows = [r for r in effects if r.gene in core and r.lfc is not None and math.isfinite(r.lfc)]
    essential = dispersion(core_rows)
    by_gene = defaultdict(list)
    for row in core_rows: by_gene[row.gene].append(row.lfc)
    groups = [np.asarray(v) for v in by_gene.values() if len(v) >= 2]
    degrees = sum(len(v)-1 for v in groups)
    essential["within_gene_variance_lfc"] = float(sum(((v-v.mean())**2).sum() for v in groups)/degrees) if degrees else None
    essential["within_gene_degrees_of_freedom"] = degrees
    essential["n_multiguide_genes"] = len(groups)
    return {"status": "measured", "library": library.slug, "reagent_lot": reagent_lot,
            "negative_controls": ntc, "core_essential_guides": essential, "essential_reference": core_source,
            "samples": samples, "flags": flags,
            "interpretation": "Control dispersion and unequal guide abundance can flag a screen for review. They cannot identify mycoplasma, reagent contamination or its cause. Compare like library, assay, time point and lot; essential dropout is applicable only to a declared fitness assay. Raw-count Gini here is distinct from the log-count QC Gini."}


def isoform_report(gene: str, guides, expression=None, expression_source=None, coordinate_notes=None) -> dict:
    from .validate.isoform import inclusion, transcript_tracks
    tracks = transcript_tracks(gene)
    from .validate.isoform import EXON_CACHE, GTF
    from .guide_mapping import file_identity
    annotation_identity = {"gtf_sha256": file_identity(GTF), "exon_cache_sha256": file_identity(EXON_CACHE)}
    mappings = []
    for guide in guides:
        row = {"guide_key": guide.guide_key, "lfc": guide.log2_fold_change if guide.log2_fold_change is not None and math.isfinite(guide.log2_fold_change) else None,
               "chromosome": guide.chromosome, "cut_position": guide.cut_position, "strand": guide.strand, "coordinate_verification": (coordinate_notes or {}).get(guide.guide_key)}
        if not guide.chromosome or guide.cut_position is None:
            row.update(status="unresolved", reason="No verified GRCh38 cut coordinate for this guide")
        else:
            result = inclusion(gene, guide.chromosome, guide.cut_position)
            values = asdict(result)
            for key in ("coding_fraction", "exonic_fraction"):
                values[key] = values[key] if math.isfinite(values[key]) else None
            values["interval_boundary"] = any(guide.chromosome == track["chromosome"] and guide.cut_position in (interval["start"], interval["end"])
                for track in tracks for interval in track["exons"] + track["cds"])
            row.update(status="mapped" if result.n_transcripts else "unresolved", annotation=values)
            if expression is not None and result.n_transcripts:
                try:
                    weighted = inclusion(gene, guide.chromosome, guide.cut_position, expression)
                    row["expression"] = {"coding_fraction": weighted.coding_fraction if math.isfinite(weighted.coding_fraction) else None,
                                         "exonic_fraction": weighted.exonic_fraction if math.isfinite(weighted.exonic_fraction) else None,
                                         "status": "measured" if math.isfinite(weighted.coding_fraction) else "not_expressed",
                                         "source": expression_source, "note": weighted.note}
                except ValueError as exc:
                    row["expression"] = {"status": "incomplete", "source": expression_source, "note": str(exc)}
        mappings.append(row)
    return {"annotation_identity": annotation_identity, "status": "mapped" if tracks else "no_annotation", "reference": "Ensembl 116 / GRCh38 / protein-coding transcripts",
            "coordinate_system": "0-based half-open intervals; cut_position is the Cas9 cleavage boundary between reference bases cut_position-1 and cut_position",
            "transcripts": tracks, "guides": mappings,
            "interpretation": "Annotated transcript coverage is context. It does not demonstrate which isoform this sample expresses, protein truncation or guide efficacy. Counts and caller results are unchanged."}


def build_evidence(matrix, library, hits, spec, workdir: Path) -> list[dict]:
    """Compute optional modules; a failed requested module is a recorded refusal."""
    options = spec.lab_evidence
    validate_options(options, matrix.samples)
    # Large count matrices are already materialised here. Bind all outputs to their exact input.
    digest = hashlib.sha256()
    for key, gene, row in zip(matrix.guide_ids, matrix.genes, matrix.matrix):
        digest.update(json.dumps([key, gene, row], separators=(",", ":")).encode() + b"\n")
    from importlib.metadata import version
    code_files = [Path(__file__), Path(__file__).with_name("lab_context.py"), Path(__file__).with_name("guide_mapping.py"), Path(__file__).parent / "validate" / "isoform.py"]
    library_bytes = json.dumps([[g.guide_id, g.sequence, g.gene, g.is_control, g.chrom, g.cut_pos, g.strand] for g in library.guides], separators=(",", ":"), allow_nan=False).encode()
    inputs = {"counts_sha256": digest.hexdigest(), "library_mapping_sha256": hashlib.sha256(library_bytes).hexdigest(),
              "software": {"numpy": version("numpy"), "scipy": version("scipy")}, "samples": matrix.samples, "settings_sha256": hashlib.sha256(json.dumps(options, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest(),
              "library": library.slug, "taxid": library.taxid,
              "code_sha256": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in code_files}}
    rows = [receipt("drift", "__SCREEN__", drift(matrix, library, hits.guide_effects, spec.roles, options.get("reagent_lot")), inputs)]
    if options.get("time_course"):
        try:
            for gene, payload in kinetics(matrix, library, options).items():
                rows.append(receipt("kinetics", gene, payload, inputs))
        except ValueError as exc:
            rows.append(receipt("kinetics", "__SCREEN__", {"status": "unavailable", "reason": str(exc)}, inputs))
    if options.get("isoforms"):
        if library.taxid != 9606 or spec.modality != "knockout":
            rows.append(receipt("isoforms", "__SCREEN__", {"status": "unavailable", "reason": "This mapping requires human GRCh38 verified knockout cut coordinates; other organisms/modalities need a matching reference and targeting convention."}, inputs))
        else:
            from .validate.domain_report import annotate_guides
            verified, coordinate_notes = verified_library_coordinates(library)
            annotated = annotate_guides(hits.guide_effects, verified, annotate_protein=False)
            from types import SimpleNamespace
            genes = defaultdict(list)
            by_key = {g.guide_key:g for g in annotated}
            measured_keys = set(matrix.guide_ids)
            for guide in verified.guides:
                if guide.targets_gene and guide.guide_id in measured_keys:
                    evidence = by_key.get(guide.guide_id) or SimpleNamespace(
                        guide_key=guide.guide_id, gene=guide.gene, log2_fold_change=None,
                        chromosome=guide.chrom, cut_position=guide.cut_pos, strand=guide.strand)
                    genes[guide.gene].append(evidence)
            try:
                for gene, guides in sorted(genes.items()):
                    rows.append(receipt("isoforms", gene, isoform_report(gene, guides,
                        options.get("transcript_expression"), options.get("expression_source"), coordinate_notes), inputs))
            except (FileNotFoundError, OSError) as exc:
                rows.append(receipt("isoforms", "__SCREEN__", {"status": "unavailable", "reason": str(exc)}, inputs))
    if options.get("context"):
        from .lab_context import context_matrix
        payloads = context_matrix(sorted(hits.genes), spec.cell_line, spec.model_id,
                                  options.get("depmap_release", "24Q4"), library.taxid)
        for gene, payload in payloads.items():
            rows.append(receipt("context", gene, payload, inputs))
    path = workdir / "lab_evidence.json"
    path.write_text(json.dumps({"schema": SCHEMA, "records": rows}, allow_nan=False) + "\n")
    return rows


def read_expression_file(path: Path) -> dict[str, float]:
    """Two-column measured transcript abundance. Missing and duplicate IDs are errors."""
    import csv
    import gzip
    opener = gzip.open if str(path).endswith(".gz") else open
    with opener(path, "rb") as handle:
        raw = handle.read(100 * 1024 * 1024 + 1)
    if len(raw) > 100 * 1024 * 1024:
        raise ValueError("expression matrix exceeds the 100 MB decompressed import limit")
    text = raw.decode("utf-8-sig")
    if text.lstrip().startswith("{"):
        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result: raise ValueError(f"duplicate transcript identifier {key}")
                result[key] = value
            return result
        values = json.loads(text, object_pairs_hook=unique)
    else:
        rows = list(csv.reader(text.splitlines(), delimiter="\t"))
        if not rows or len(rows[0]) != 2 or rows[0][0].lower() not in {"transcript_id", "transcript"} or rows[0][1].lower() not in {"tpm", "abundance"}:
            raise ValueError("expression needs a transcript-to-abundance JSON object or two-column transcript_id / TPM TSV")
        values = {}
        for row in rows[1:]:
            if len(row) != 2 or not row[0].strip() or not row[1].strip():
                raise ValueError("every transcript must have an explicit abundance; missing is not zero")
            if row[0] in values: raise ValueError(f"duplicate transcript identifier {row[0]}")
            values[row[0]] = float(row[1])
    validate_options({"isoforms": True, "expression_source": str(path), "transcript_expression": values}, [])
    return values



from .guide_mapping import verified_library_coordinates
