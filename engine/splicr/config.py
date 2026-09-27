"""Paths and tunables. No magic numbers scattered through the pipeline."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]
ROOT = ENGINE_DIR.parent

REFERENCE_DIR = Path(os.environ.get("SPLICR_REFERENCE_DIR", ROOT / "data" / "references"))
TESTDATA_DIR = Path(os.environ.get("SPLICR_TESTDATA_DIR", ROOT / "data" / "testdata"))
WORK_DIR = Path(os.environ.get("SPLICR_WORK_DIR", ROOT / "data" / "work"))
TOOLS_DIR = ENGINE_DIR / ".tools"

LIBRARIES_DIR = REFERENCE_DIR / "libraries"
GENESETS_DIR = REFERENCE_DIR / "genesets"
COORDINATES_DIR = REFERENCE_DIR / "coordinates"
OFFTARGET_DIR = REFERENCE_DIR / "offtarget"
ANNOTATION_DIR = REFERENCE_DIR / "annotation"
DEPMAP_DIR = REFERENCE_DIR / "depmap"
ORCS_DIR = REFERENCE_DIR / "orcs"

BAGEL_DIR = TOOLS_DIR / "bagel2"
DRUGZ_DIR = TOOLS_DIR / "drugz"


# ---------------------------------------------------------------------------
# Vector anchors
#
# The constant sequence immediately upstream of the spacer. Counting locates
# the spacer by finding one of these rather than assuming a fixed offset,
# because staggered primers shift the spacer by 0-8 bases and a hardcoded
# trim loses most reads.
#
# lentiGuide/lentiCRISPRv2 value is from the Broad GPP sequencing protocol.
# pLCKO2 (TKOv3) differs, which is a common and silent source of total failure.
# ---------------------------------------------------------------------------
VECTOR_ANCHORS: dict[str, str] = {
    "lentiguide": "TTGTGGAAAGGACGAAACACCG",
    "plcko2": "TTGTGGAAAGGACGAGGTACCG",
    "lentiguide_short": "GGAAAGGACGAAACACCG",
    "u6_tail": "GACGAAACACCG",
}

# Start of the sgRNA scaffold, immediately downstream of the spacer. Used as a
# secondary check; on short reads it often falls off the end, so it is never
# the primary locator.
SCAFFOLD_ANCHOR = "GTTTTAGAGCTAGAAATAGCAAG"


@dataclass(frozen=True)
class CountConfig:
    """How reads become counts."""

    # Reads sampled when auto-detecting the library and guide offset.
    detect_sample_reads: int = 200_000

    # Accept a 1-mismatch hit when a read has no exact match. Deliberately
    # capped at 1: several libraries contain duplicate or near-duplicate
    # sequences, and a more permissive search assigns those reads arbitrarily.
    allow_mismatch: bool = True
    max_mismatches: int = 1

    # A 1-mismatch hit is only accepted when it is unambiguous, i.e. exactly
    # one library guide is within the distance. Ambiguous reads are dropped.
    require_unique_mismatch: bool = True

    # Offsets to try when no anchor is found, covering the documented Broad
    # GPP stagger set (0,1,2,3,4,6,7,8 added to the 22nt anchor).
    fallback_offsets: tuple[int, ...] = (22, 23, 24, 25, 26, 27, 28, 29, 30, 0)

    # A detection run must map at least this fraction of sampled reads before
    # the library call is trusted.
    min_detect_match_rate: float = 0.10


@dataclass(frozen=True)
class QcThresholds:
    """
    Thresholds for QC verdicts.

    Sources are recorded per field because several widely quoted numbers are
    misattributed in the literature. Where a number is a community convention
    rather than a published threshold it is marked as such.
    """

    # MAGeCK wiki: ~0.1 for plasmid/initial, 0.2-0.3 for negative selection.
    # Computed on log(count+1), not raw counts.
    gini_plasmid_max: float = 0.15
    gini_endpoint_max: float = 0.35

    # MAGeCK wiki: zero-count guides should be under 1%.
    zero_fraction_max: float = 0.01
    zero_fraction_warn: float = 0.05

    # MAGeCK wiki: at least 60%. MAGeCKFlute says 65%.
    mapping_rate_min: float = 0.60
    mapping_rate_warn: float = 0.65

    # Joung et al. 2017 Nat Protoc FAQ Q6: under 10-fold between the 90th and
    # 10th percentile. Often misattributed to Broad GPP.
    skew_ratio_max: float = 10.0

    # DepMap: sequences need > 185 mean reads per guide to pass.
    mean_reads_per_guide_min: float = 185.0

    # DepMap: NNMD = (median(ess) - median(non)) / MAD(non), pass at <= -1.25.
    # Originally defined with mean/SD at -1.0; Chronos moved it to median/MAD.
    nnmd_max: float = -1.25

    # DepMap residual-LFC replicate correlation floor.
    replicate_r_min: float = 0.19

    # A replicate losing this share of guides relative to the screen median is
    # treated as bottlenecked and down-weighted.
    bottleneck_guide_loss: float = 0.10

    # How far a sample's vector-anchor rate may fall below the screen median
    # before its amplicon purity is called out. Our own convention, not a
    # published threshold: DepMap's nearest equivalent is the cross-library
    # read fraction, which must stay under 0.1. Set relative rather than
    # absolute because the baseline rate depends on the PCR protocol.
    anchor_rate_drop: float = 0.20


@dataclass(frozen=True)
class ArtifactThresholds:
    """Thresholds for artifact flagging."""

    # Fraction of the absolute gene-level signal carried by a single guide
    # before the hit is flagged as single-guide driven.
    single_guide_share: float = 0.60

    # Guides with more than this many perfect genomic alignments are
    # promiscuous. DepMap drops guides with > 5 alignments; BAGEL2 uses 10.
    max_perfect_alignments: int = 5
    max_mismatch1_alignments: int = 10

    # Copy-number cluster detection: a run of same-direction depleted genes
    # along a chromosome. CRISPRcleanR's CBS uses a minimum of 3 distinct
    # genes, which this mirrors.
    cn_cluster_min_genes: int = 3
    cn_cluster_window: int = 10
    cn_amplification_threshold: float = 2.0  # linear relative CN

    # A gene hitting in more than this fraction of unrelated Atlas screens is
    # a frequent hitter: real, but not specific to the condition.
    frequent_hitter_rate: float = 0.25


@dataclass(frozen=True)
class Settings:
    count: CountConfig = field(default_factory=CountConfig)
    qc: QcThresholds = field(default_factory=QcThresholds)
    artifacts: ArtifactThresholds = field(default_factory=ArtifactThresholds)

    @property
    def tool_bin(self) -> Path:
        return TOOLS_DIR / "env" / "bin"


SETTINGS = Settings()


def tool_env() -> dict[str, str]:
    """
    Environment for subprocess calls.

    MAGeCK shells out to the RRA binary by bare name, so the tool bin must be
    on PATH. Calling the mageck binary by absolute path leaves RRA
    unresolvable and MAGeCK fails deep in its own log.
    """
    env = dict(os.environ)
    env["PATH"] = f"{SETTINGS.tool_bin}:{env.get('PATH', '')}"
    return env
