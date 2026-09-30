"""
What an in-frame repair outcome does to the protein.

A frameshift is easy to reason about: the coding sequence past the cut is
garbage and the transcript is usually destroyed by nonsense-mediated decay. An
in-frame deletion is not. It removes whole codons and leaves a shorter protein
that may be fully functional, partly functional, or dead, depending entirely on
which residues went missing. This module asks that question with annotation
rather than intuition.

WHAT IT USES

    Ensembl 116 GTF   CDS structure of the MANE Select transcript, which turns a
                      genomic cut position into a codon index and a position
                      along the protein.
    UniProt           curated residue-level features for the human proteome:
                      active sites, binding sites, disulphide bonds, and the
                      domains a residue belongs to. This is the strong signal,
                      because it is experimental annotation, not prediction.
    AlphaFold DB      per-residue pLDDT, fetched on demand. Optional, and used
                      only as a weak prior.

HOW FAR THE CLAIMS GO

"This deletion removes a residue UniProt annotates as the catalytic site" is a
statement about a curated database and is worth acting on. "This deletion falls
in a region AlphaFold models with low confidence" is much weaker: pLDDT measures
how sure the structure predictor was, and low confidence correlates with
intrinsic disorder, which correlates with tolerance to deletion. Two
correlations chained together is a hint, not a finding, and `impact()` reports
which of the two kinds of evidence it used so a reader can tell them apart.
"""

from __future__ import annotations

import functools
import gzip
import json
import re
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from ..config import ANNOTATION_DIR, REFERENCE_DIR

GTF = ANNOTATION_DIR / "Homo_sapiens.GRCh38.116.chr.gtf.gz"
CACHE = REFERENCE_DIR / "derived"
CDS_CACHE = CACHE / "mane_cds_GRCh38_116.parquet"
UNIPROT_CACHE = CACHE / "uniprot_features_human.parquet"
UA = "SplicR-validate/1.0 (mailto:ss4497@cornell.edu)"

#: UniProt feature types that mark a residue as doing chemistry. Losing one of
#: these is a strong reason to believe an in-frame deletion still broke the
#: protein, which is the opposite of the usual assumption about in-frame edits.
CATALYTIC = {"Active site", "Binding site", "Site", "Metal binding"}
STRUCTURAL = {"Disulfide bond", "Cross-link", "Domain", "Zinc finger", "DNA binding",
              "Transmembrane", "Coiled coil"}

_ATTR = re.compile(r'(\S+) "([^"]*)"')


@dataclass(frozen=True)
class CodonPosition:
    """Where a genomic position falls in a transcript's protein."""

    gene: str
    transcript: str
    residue: int              # 1-based codon index
    n_residues: int
    strand: str
    exon_number: int
    n_exons: int

    @property
    def fraction(self) -> float:
        return self.residue / self.n_residues if self.n_residues else float("nan")

    @property
    def in_last_exon(self) -> bool:
        """Frameshifts here usually escape nonsense-mediated decay."""
        return self.exon_number >= self.n_exons


@dataclass
class ProteinImpact:
    """What a set of in-frame deletions is predicted to remove."""

    gene: str
    residue: int | None = None
    fraction: float | None = None
    in_last_exon: bool | None = None
    #: Probability mass of in-frame outcomes that delete an annotated catalytic residue.
    hits_catalytic: float = 0.0
    #: ... a structural feature (domain, disulphide, transmembrane).
    hits_structural: float = 0.0
    features_hit: tuple[str, ...] = ()
    uniprot: str | None = None
    evidence: str = "none"        # curated | predicted | none
    note: str = ""


# ---------------------------------------------------------------------------
# CDS structure
# ---------------------------------------------------------------------------

def build_cds_cache(gtf: Path = GTF, out: Path = CDS_CACHE) -> Path:
    """
    One row per CDS interval of every MANE Select transcript.

    MANE Select is the transcript RefSeq and Ensembl agree on, one per protein
    coding gene. Picking it rather than the longest transcript means a residue
    index here is the same residue index UniProt uses, which is what makes the
    feature join below valid.
    """
    import pandas as pd

    rows = []
    with gzip.open(gtf, "rt") as fh:
        for line in fh:
            if line.startswith("#"):
                continue
            f = line.rstrip("\n").split("\t")
            if len(f) < 9 or f[2] != "CDS" or 'tag "MANE_Select"' not in f[8]:
                continue
            a = dict(_ATTR.findall(f[8]))
            rows.append({
                "gene": a.get("gene_name"), "gene_id": a.get("gene_id"),
                "transcript": a.get("transcript_id"), "chrom": f[0],
                "start": int(f[3]) - 1, "end": int(f[4]), "strand": f[6],
                "frame": int(f[7]) if f[7].isdigit() else 0,
                "exon_number": int(a.get("exon_number", 0)),
            })
    df = pd.DataFrame(rows)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, compression="zstd", index=False)
    return out


@functools.lru_cache(maxsize=1)
def _cds_index():
    import pandas as pd

    if not CDS_CACHE.exists():
        build_cds_cache()
    df = pd.read_parquet(CDS_CACHE)
    by_gene: dict[str, list] = {}
    for gene, sub in df.groupby("gene", sort=False):
        sub = sub.sort_values("start")
        by_gene[gene] = sub.to_dict("records")
    return by_gene


def locate(gene: str, chrom: str, pos: int) -> CodonPosition | None:
    """Codon index of a 0-based genomic position inside `gene`'s MANE CDS."""
    exons = _cds_index().get(gene)
    if not exons:
        return None
    chrom = chrom[3:] if chrom.startswith("chr") else chrom
    exons = [e for e in exons if str(e["chrom"]) == chrom]
    if not exons:
        return None
    strand = exons[0]["strand"]
    total = sum(e["end"] - e["start"] for e in exons)
    ordered = sorted(exons, key=lambda e: e["start"], reverse=strand == "-")
    offset = 0
    for e in ordered:
        if e["start"] <= pos < e["end"]:
            within = (pos - e["start"]) if strand == "+" else (e["end"] - 1 - pos)
            cds_pos = offset + within
            return CodonPosition(gene, e["transcript"], cds_pos // 3 + 1, max(1, total // 3),
                                 strand, int(e["exon_number"]), len(exons))
        offset += e["end"] - e["start"]
    return None


# ---------------------------------------------------------------------------
# UniProt features
# ---------------------------------------------------------------------------

def _fetch_uniprot(gene: str) -> dict | None:
    url = ("https://rest.uniprot.org/uniprotkb/search?"
           + urllib.parse.urlencode({
               "query": f"gene_exact:{gene} AND organism_id:9606 AND reviewed:true",
               "fields": "accession,ft_act_site,ft_binding,ft_site,ft_disulfid,ft_domain,"
                         "ft_transmem,ft_zn_fing,ft_dna_bind,length",
               "size": 1, "format": "json"}))
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            results = data.get("results") or []
            return results[0] if results else None
        except Exception:  # noqa: BLE001 - transient; the caller degrades to no annotation
            if attempt == 2:
                return None
            time.sleep(2 ** attempt)
    return None


@functools.lru_cache(maxsize=20000)
def features(gene: str) -> tuple[str | None, tuple[tuple[str, int, int], ...]]:
    """(UniProt accession, features as (type, start, end)) for a gene symbol."""
    rec = _fetch_uniprot(gene)
    if not rec:
        return None, ()
    out = []
    for ft in rec.get("features", []):
        loc = ft.get("location", {})
        s, e = loc.get("start", {}).get("value"), loc.get("end", {}).get("value")
        if s and e:
            out.append((ft.get("type", ""), int(s), int(e)))
    return rec.get("primaryAccession"), tuple(out)


def impact(gene: str, chrom: str, cut_pos: int,
           in_frame_deletions: list[tuple[int, int, float]],
           use_uniprot: bool = True) -> ProteinImpact:
    """
    What the predicted in-frame deletions remove.

    `in_frame_deletions` is (offset from cut, length in bp, probability), as
    `validate.repair` returns it. Each one is mapped onto the protein and
    checked against UniProt's residue features.
    """
    pos = locate(gene, chrom, cut_pos)
    out = ProteinImpact(gene=gene)
    if pos is None:
        out.note = "no MANE Select CDS covers this cut"
        return out
    out.residue, out.fraction, out.in_last_exon = pos.residue, round(pos.fraction, 4), pos.in_last_exon
    if not use_uniprot or not in_frame_deletions:
        return out

    acc, feats = features(gene)
    out.uniprot = acc
    if not feats:
        out.note = "no reviewed UniProt entry with residue features"
        return out

    hit_names: set[str] = set()
    for offset, length, prob in in_frame_deletions:
        # The deleted window in codon space, from the cut's own codon.
        first = pos.residue + (offset // 3)
        last = first + max(1, length // 3) - 1
        for ftype, fs, fe in feats:
            if last < fs or first > fe:
                continue
            if ftype in CATALYTIC:
                out.hits_catalytic += prob
                hit_names.add(ftype)
            elif ftype in STRUCTURAL:
                out.hits_structural += prob
                hit_names.add(ftype)
    out.features_hit = tuple(sorted(hit_names))
    out.evidence = "curated" if hit_names else "none"
    out.hits_catalytic = round(min(out.hits_catalytic, 1.0), 4)
    out.hits_structural = round(min(out.hits_structural, 1.0), 4)
    return out
