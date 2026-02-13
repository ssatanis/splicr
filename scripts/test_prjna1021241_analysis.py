"""
Sanity check helper for PRJNA1021241 analysis.
Executes the full flow (Treatment vs Reference).
"""
import sys
from pathlib import Path
import logging

# Add src to path
sys.path.append(str(Path(__file__).resolve().parent.parent / "src"))

from config.prjna1021241 import get_prjna1021241_samples
from crispr_confidence.analysis import run_screen_analysis
from crispr_confidence.config import get_config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def main():
    logger.info("Starting PRJNA1021241 sanity check...")
    config = get_config()
    
    # Get the TREATMENT sample (INK3)
    samples = get_prjna1021241_samples()
    treatment_sample = [s for s in samples if "INK" in s.name or "SRR26183437" in s.name]
    
    if not treatment_sample:
        logger.error("Treatment sample not found in config.")
        return

    # Run analysis for only the treatment sample (should trigger single_vs_reference mode)
    output = run_screen_analysis(treatment_sample, "Brunello", config)
    
    print("\n--- Sanity Check Results ---")
    print(f"Mode: {output['mode']}")
    print(f"Status: {output['status']}")
    print(f"Sample QC: {output['sample_qc']}")
    print(f"Top 10 Genes CCS: {output['results'][:10]}")
    print("---------------------------\n")

if __name__ == "__main__":
    main()
