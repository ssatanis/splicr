"""
MAGeCK Output Progress Parser

Parses MAGeCK INFO lines to extract real-time progress for UI updates.
Based on MAGeCK 0.5.9 output format (SourceForge / NIH Biowulf).
"""

import re
from dataclasses import dataclass
from typing import Optional

# Regex patterns for MAGeCK stdout
PATTERNS = {
    'loading_sgrnas': re.compile(r'Loading\s+(\d+)\s+predefined\s+sgRNAs', re.I),
    'processing_reads': re.compile(r'Processing\s+(\d+)M\s+reads'),
    'total_reads': re.compile(r'Total:\s*(\d+)', re.I),
    'mapped_reads': re.compile(r'Mapped:\s*(\d+)', re.I),
    'normalization': re.compile(r'normaliz|size factor|median', re.I),
    'statistical_test': re.compile(r'Running.*test|RRA|permutation', re.I),
    'parsing_fastq': re.compile(r'Parsing\s+FASTQ|Parsing\s+fastq', re.I),
}

STEP_WEIGHTS = {
    'loading_library': 2,
    'processing_fastq': 60,
    'mapping_reads': 5,
    'normalizing': 10,
    'statistical_test': 18,
}


@dataclass
class ProgressUpdate:
    step: str
    progress: int
    message: str


def parse_mageck_line(line: str, state: dict) -> Optional[ProgressUpdate]:
    """Parse a line of MAGeCK output. Returns ProgressUpdate if progress-relevant."""
    content = line.strip()
    if not content:
        return None

    # Extract content after "INFO  @ ... :"
    if ':' in content:
        content = content.split(':', 1)[1].strip()

    # Loading library
    m = PATTERNS['loading_sgrnas'].search(content)
    if m:
        n = int(m.group(1))
        return ProgressUpdate(
            step='loading_library',
            progress=STEP_WEIGHTS['loading_library'],
            message=f'Loading {n:,} sgRNAs'
        )

    # Processing reads - main progress driver
    m = PATTERNS['processing_reads'].search(content)
    if m:
        million = int(m.group(1))
        total_m = state.get('total_million', 50)
        pct = min(
            STEP_WEIGHTS['loading_library'] + (million / total_m) * STEP_WEIGHTS['processing_fastq'],
            STEP_WEIGHTS['loading_library'] + STEP_WEIGHTS['processing_fastq']
        )
        return ProgressUpdate(
            step='processing_fastq',
            progress=int(pct),
            message=f'Processing {million}M reads'
        )

    # Total reads
    m = PATTERNS['total_reads'].search(content)
    if m:
        total = int(m.group(1))
        state['total_million'] = max(state.get('total_million', 1), (total // 1_000_000) + 1)
        return ProgressUpdate(
            step='mapping_reads',
            progress=67,
            message=f'Mapped {total:,} reads'
        )

    m = PATTERNS['mapped_reads'].search(content)
    if m:
        return ProgressUpdate(
            step='mapping_reads',
            progress=67,
            message=f"Mapped {int(m.group(1)):,} reads"
        )

    if PATTERNS['normalization'].search(content):
        return ProgressUpdate(step='normalizing', progress=75, message='Normalizing read counts')

    if PATTERNS['statistical_test'].search(content):
        return ProgressUpdate(step='statistical_test', progress=80, message='Running statistical tests')

    if PATTERNS['parsing_fastq'].search(content):
        return ProgressUpdate(step='processing_fastq', progress=15, message='Parsing FASTQ files')

    return None
