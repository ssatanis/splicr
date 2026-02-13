"""
Loader for reference controls with cloud fallback.
"""
import pandas as pd
from pathlib import Path
from .crispr_confidence.ref_data import get_loader
from .crispr_confidence.storage import get_storage

def load_brunello_reference_pdna(config: dict) -> pd.Series:
    """
    Loads the canonical Brunello reference pDNA counts.
    Derived from PRJNA1021241 (SRR26183442).
    """
    filename = "brunello_prjna1021241_pdna_counts.parquet"
    local_path = Path(config["paths"]["processed"]) / "reference_controls" / filename
    remote_key = f"crispr_ccs/reference_controls/{filename}"
    
    if local_path.exists():
        return pd.read_parquet(local_path).iloc[:, 0]
    
    # Try cloud fallback
    storage = get_storage()
    if storage.download_file(remote_key, local_path):
        return pd.read_parquet(local_path).iloc[:, 0]
    
    raise FileNotFoundError(f"Reference pDNA counts not found locally or in cloud: {remote_key}")
