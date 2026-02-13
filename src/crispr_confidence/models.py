"""
Core models and constants for CRISPR screen samples.
"""
from dataclasses import dataclass
from typing import Optional

# Sample Types
CONTROL_EXPERIMENT = "CONTROL_EXPERIMENT"
TREATMENT_EXPERIMENT = "TREATMENT_EXPERIMENT"

@dataclass
class ScreenSample:
    name: str
    fastq_path: str
    sample_type: Optional[str] = None
    library_name: str = "Brunello"
    total_reads: int = 0
    mapped_reads: int = 0
    mapping_rate: float = 0.0
    gini_index: float = 0.0

    def __post_init__(self):
        if self.total_reads > 0:
            self.mapping_rate = self.mapped_reads / self.total_reads
