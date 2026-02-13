"""
Pathways Data Processor (KEGG & Reactome)
Standardizes pathway-to-gene mappings.
"""
import pandas as pd
import json
from pathlib import Path
from ..config import get_config
from ..storage import get_storage

def process_pathways():
    config = get_config()
    paths = config["paths"]
    resources = config["resources"]
    storage = get_storage()
    
    # --- KEGG ---
    # KEGG is already downloaded as JSON by the download script, 
    # but we can validate/standardize if needed. 
    # For now, we assume the download script did a good job, 
    # but let's ensure it's in the right place and re-upload if needed.
    # actually, download script put it in data/processed/kegg_pathways.json
    # we want data/processed/kegg/pathways.json
    
    kegg_source = paths["processed"] / resources["kegg_processed"] # e.g. data/processed/kegg_pathways.json
    kegg_dest = paths["processed"] / "kegg/pathways.json"
    
    if kegg_source.exists():
        print(f"Processing KEGG from {kegg_source}...")
        try:
            with open(kegg_source) as f:
                data = json.load(f)
            
            # Create dest dir
            kegg_dest.parent.mkdir(parents=True, exist_ok=True)
            
            # Save standardized (it's already good, just moving/copying)
            with open(kegg_dest, "w") as f:
                json.dump(data, f, indent=2)
                
            print(f"✓ KEGG data formatted to {kegg_dest}")
            storage.upload_file(kegg_dest, "processed/kegg/pathways.json")
            
        except Exception as e:
            print(f"✗ Failed to process KEGG: {e}")
    else:
        print(f"⚠ KEGG source file missing: {kegg_source}")

    # --- Reactome ---
    # Reactome also has a processed JSON from download script,
    # but let's implement the raw processor for robustness as requested.
    reactome_raw = paths["raw"] / resources["reactome_raw"]
    reactome_dest = paths["processed"] / "reactome/pathways.json"
    
    if reactome_raw.exists():
        print(f"Processing Reactome from {reactome_raw}...")
        try:
            # Read UniProt2Reactome
            # Columns: UniProt, ReactomeID, URL, Name, Evidence, Species
            df = pd.read_csv(
                reactome_raw,
                sep="\t",
                header=None,
                names=["uniprot", "id", "url", "name", "evidence", "species"],
                usecols=["uniprot", "id", "name", "species"]
            )
            
            # Filter Human
            df = df[df["species"] == "Homo sapiens"]
            
            # Group: ID -> {name, genes}
            pathway_data = {}
            # Groupby is faster than loop
            grouped = df.groupby("id")
            for pid, group in grouped:
                pathway_data[pid] = {
                    "name": group["name"].iloc[0],
                    "genes": sorted(list(set(group["uniprot"].tolist())))
                }
            
            # Save
            reactome_dest.parent.mkdir(parents=True, exist_ok=True)
            with open(reactome_dest, "w") as f:
                json.dump(pathway_data, f, indent=2)

            print(f"✓ Reactome data formatted to {reactome_dest}")
            storage.upload_file(reactome_dest, "processed/reactome/pathways.json")
            
        except Exception as e:
            print(f"✗ Failed to process Reactome: {e}")
    else:
        print(f"⚠ Reactome raw file missing: {reactome_raw}")

    return True
