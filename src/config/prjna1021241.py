"""
Configuration for PRJNA1021241 (mTOR inhibition in HNSCC) dataset.
"""
from ..crispr_confidence.models import ScreenSample, CONTROL_EXPERIMENT, TREATMENT_EXPERIMENT

PROJECT_ID = "PRJNA1021241"
CONTROL_RUN = "SRR26183442"
TREATMENT_RUN = "SRR26183437"

def get_prjna1021241_samples() -> list[ScreenSample]:
    """Returns the two key samples for PRJNA1021241 integration."""
    return [
        ScreenSample(
            name=CONTROL_RUN,
            fastq_path=f"data/raw/fastq/{PROJECT_ID}/{CONTROL_RUN}.fastq.gz",
            sample_type=CONTROL_EXPERIMENT,
            library_name="Brunello"
        ),
        ScreenSample(
            name=TREATMENT_RUN,
            fastq_path=f"data/raw/fastq/{PROJECT_ID}/{TREATMENT_RUN}.fastq.gz",
            sample_type=TREATMENT_EXPERIMENT,
            library_name="Brunello"
        )
    ]
