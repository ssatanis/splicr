"""
STRING DB Processor
Filters human protein links with high confidence and saves as parquet.
"""
import pandas as pd
import gzip
from pathlib import Path
from ..config import get_config
from ..storage import get_storage

def process_string():
    config = get_config()
    paths = config["paths"]
    resources = config["resources"]
    
    raw_path = paths["raw"] / resources["string_raw"]
    output_path = paths["processed"] / resources["string_processed"]
    
    print(f"Processing STRING DB from {raw_path}...")
    
    if not raw_path.exists():
        print(f"✗ STRING raw file missing: {raw_path}")
        return False

    try:
        # Read huge file efficiently
        # Columns: protein1, protein2, combined_score
        df = pd.read_csv(
            raw_path,
            sep=" ",
            usecols=["protein1", "protein2", "combined_score"],
            dtype={
                "protein1": "category",
                "protein2": "category",
                "combined_score": "int16"
            }
        )
        
        # Filter: combined_score >= 400
        initial_len = len(df)
        df = df[df["combined_score"] >= 400]
        print(f"  Filtered {initial_len} -> {len(df)} interactions (score >= 400)")
        
        # Save as Parquet
        output_path.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(output_path, engine="pyarrow", compression="snappy")
        print(f"✓ Saved processed STRING to {output_path}")
        
        # Upload to storage
        storage = get_storage()
        remote_path = f"processed/string/protein_links.parquet"
        storage.upload_file(output_path, remote_path)
        
        return True
        
    except Exception as e:
        print(f"✗ Failed to process STRING: {e}")
        return False
