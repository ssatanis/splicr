"""
BAGEL2 Data Processor
Standardizes essential and non-essential gene lists.
"""
import pandas as pd
from pathlib import Path
import json
from ..config import get_config
from ..storage import get_storage

def process_bagel():
    config = get_config()
    paths = config["paths"]
    resources = config["resources"]
    
    raw_essentials = paths["raw"] / resources["bagel_essentials_raw"]
    output_essentials = paths["processed"] / resources["bagel_processed"]
    
    print(f"Processing BAGEL2 references...")
    
    bagel_data = {}
    
    # Process Essential Genes
    if raw_essentials.exists():
        try:
            # Assumes single column of gene names (validate format first if crucial, usually headerless or simple)
            # Checking first few lines might be good, but assuming standard format for now:
            # Gene
            # A1BG ...
            df = pd.read_csv(raw_essentials, header=None, names=["gene"])
            # If header exists and is 'Gene', it will be treated as value, so let's be safe
            if df.iloc[0]["gene"] == "Gene":
                df = df.iloc[1:]
                
            genes = sorted(df["gene"].unique().tolist())
            bagel_data["essential"] = genes
            print(f"  Loaded {len(genes)} core essential genes")
        except Exception as e:
            print(f"✗ Failed to read essentials: {e}")
            return False
    else:
        print(f"✗ BAGEL2 essentials file missing: {raw_essentials}")
        return False

    # Save to JSON
    try:
        output_essentials.parent.mkdir(parents=True, exist_ok=True)
        with open(output_essentials, "w") as f:
            json.dump(bagel_data, f, indent=2)
        print(f"✓ Saved BAGEL2 data to {output_essentials}")
        
        # Upload
        storage = get_storage()
        remote_path = f"processed/bagel/essentials.json"
        storage.upload_file(output_essentials, remote_path)
        
        return True
    except Exception as e:
        print(f"✗ Failed to save BAGEL2 data: {e}")
        return False
