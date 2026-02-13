"""
DepMap Processor
Standardizes gene dependency scores.
"""
import pandas as pd
from pathlib import Path
from ..config import get_config
from ..storage import get_storage

def process_depmap():
    config = get_config()
    paths = config["paths"]
    resources = config["resources"]
    
    gene_effect_raw = paths["raw"] / resources["depmap_gene_effect_raw"]
    output_path = paths["processed"] / resources["depmap_processed"]
    
    print(f"Processing DepMap from {gene_effect_raw}...")
    
    if not gene_effect_raw.exists():
        print(f"✗ DepMap gene effect file missing: {gene_effect_raw}")
        return False
    
    try:
        # Load Gene Effect: Rows=CellLines, Cols=Genes (Entrez ID)
        # Check first few columns/rows to infer format
        # Usually: DepMap_ID, A1BG (1), A1CF (29974), ...
        
        # Read with pandas (might be slow for full CSV, use chunks if crashing)
        # Using float32 to save memory
        df = pd.read_csv(gene_effect_raw, index_col=0) # Index is DepMap_ID
        
        # Sanitize Column Names: "Gene (ID)" -> "Gene"
        # We generally want the Gene Symbol for mapping.
        # "A1BG (1)" -> "A1BG"
        
        new_columns = {}
        for col in df.columns:
            if " (" in col:
                symbol = col.split(" (")[0]
                new_columns[col] = symbol
        
        if new_columns:
            df = df.rename(columns=new_columns)
            
        print(f"  Loaded {len(df)} lines x {len(df.columns)} genes")
        
        # Save as Parquet (much faster for querying)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(output_path, engine="pyarrow", compression="snappy")
        print(f"✓ Saved processed DepMap to {output_path}")
        
        # Upload
        storage = get_storage()
        remote_path = f"processed/depmap/gene_effect.parquet"
        storage.upload_file(output_path, remote_path)
            
        return True
    
    except Exception as e:
        print(f"✗ Failed to process DepMap: {e}")
        return False
