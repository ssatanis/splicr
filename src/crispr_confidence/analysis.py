"""
Main analysis orchestration for CRISPR screens.
"""
import logging
from typing import List, Dict, Any
from .models import ScreenSample, CONTROL_EXPERIMENT, TREATMENT_EXPERIMENT
from .layout import infer_screen_layout
from ..ref_controls import load_brunello_reference_pdna
from .engine import get_scorer

logger = logging.getLogger(__name__)

def run_screen_analysis(samples: List[ScreenSample], library_name: str, config: dict) -> Dict[str, Any]:
    """
    Orchestrates the full screen analysis pipeline.
    """
    logger.info(f"Starting analysis for {len(samples)} samples using {library_name} library.")
    
    # 1. Infer layout
    mode = infer_screen_layout(samples, library_name, config)
    logger.info(f"Inferred analysis mode: {mode}")
    
    # 2. Perform QC and Counting for each sample
    # (In real logic, this would be a loop or batch task)
    for sample in samples:
        logger.info(f"Processing sample: {sample.name}")
        # count_fastq(...) -> update sample.mapped_reads, gini_index etc.
        
    if mode == "single_qc_only" or mode == "single_control_qc_only":
        return {
            "mode": mode,
            "status": "QC_SUCCESS",
            "samples": [vars(s) for s in samples],
            "message": "QC complete. No hit calling performed for single/control-only mode."
        }

    # 3. Load Control counts
    control_counts = None
    if mode == "paired":
        control_sample = next(s for s in samples if s.sample_type == CONTROL_EXPERIMENT)
        # control_counts = get_counts(control_sample)
    elif mode == "single_vs_reference":
        logger.info("Loading reference pDNA counts...")
        control_counts = load_brunello_reference_pdna(config)

    # 4. Compute LFC and run CCS
    # This is where the core engine (scores.py/engine.py) takes over
    # scorer = get_scorer()
    # results = scorer.score_screen(data)
    
    return {
        "mode": mode,
        "status": "SUCCESS",
        "sample_qc": [vars(s) for s in samples],
        "results": [] # Placeholder for CCS output
    }
