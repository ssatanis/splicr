"""
Script to build the Brunello pDNA reference control from PRJNA1021241 (SRR26183442).
"""
import sys
from pathlib import Path
import pandas as pd
import logging

# Add src to path
sys.path.append(str(Path(__file__).resolve().parent.parent / "src"))

from crispr_confidence.ref_data import get_loader
from crispr_confidence.data_processing.fastq import count_fastq
from crispr_confidence.storage import get_storage
from crispr_confidence.config import get_config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def main():
    config = get_config()
    storage = get_storage()
    loader = get_loader()
    
    # 1. Load library
    logger.info("Loading Brunello library...")
    brunello_lib = loader.load_brunello_library()
    
    # 2. Define FASTQ path for SRR26183442 (Control)
    fastq_path = "data/raw/fastq/PRJNA1021241/SRR26183442.fastq.gz"
    
    if not Path(fastq_path).exists():
        logger.error(f"FASTQ file not found: {fastq_path}. Please download it first using SRA Toolkit.")
        # For demonstration purposes, we'll stop here. 
        # In a real run, this would proceed to count.
        return

    # 3. Count FASTQ
    counts, qc = count_fastq(fastq_path, brunello_lib)
    
    # 4. Check QC
    if qc["mapping_rate"] < 0.30:
        logger.error(f"Mapping rate too low: {qc['mapping_rate']:.2%}. Check adapter/library.")
        return
    
    if qc["gini_index"] > 0.5: # Example threshold for plasmid library
        logger.error(f"Gini index too high: {qc['gini_index']:.2f}. Not pDNA-like.")
        return
    
    # 5. Save locally
    output_filename = "brunello_prjna1021241_pdna_counts.parquet"
    local_dir = Path(config["paths"]["processed"]) / "reference_controls"
    local_dir.mkdir(parents=True, exist_ok=True)
    local_path = local_dir / output_filename
    
    counts_df = counts.to_frame(name="count")
    counts_df.to_parquet(local_path)
    logger.info(f"Saved reference counts to {local_path}")
    
    # 6. Upload to cloud
    remote_key = f"crispr_ccs/reference_controls/{output_filename}"
    if storage.upload_file(local_path, remote_key):
        logger.info(f"Uploaded reference counts to {remote_key}")
    else:
        logger.warning("Cloud upload failed. Reference is only available locally.")

if __name__ == "__main__":
    main()
