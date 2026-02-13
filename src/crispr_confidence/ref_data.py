"""
Unified Reference Data Loader for CRISPR Confidence Score.
Handles loading, caching, and cloud fallback for all reference datasets.
"""
import pandas as pd
import json
from pathlib import Path
from typing import Dict, List, Any, Optional
from .config import get_config
from .storage import get_storage

class ReferenceDataLoader:
    def __init__(self):
        self.config = get_config()
        self.storage = get_storage()
        self._cache = {}

    def _get_file_path(self, resource_key: str, check_exists=True) -> Optional[Path]:
        """Resolves file path and ensures existence (downloads if needed)."""
        paths = self.config["paths"]
        resources = self.config["resources"]
        
        if resource_key not in resources:
            raise KeyError(f"Resource '{resource_key}' not found in configuration.")
            
        filename = resources[resource_key]
        
        # Decide base path based on key naming convention (naive but works for now)
        # if key ends with processed, assumes in processed
        base_path = paths["processed"] if "processed" in resource_key else paths["raw"]
        
        # Handle specific subfolders we created in processing
        if "string_processed" == resource_key:
             # filename is already relative "string/protein_links.parquet"
             pass
             
        local_path = base_path / filename
        
        if check_exists and not local_path.exists():
            print(f"⚠ Resource missing locally: {filename}")
            # Try to download
             # Assuming remote path structure mirrors "processed/subdir/file"
            if "processed" in resource_key:
                remote_key = f"processed/{filename}" 
            else:
                remote_key = f"raw/{filename}"
                
            if self.storage.download_file(remote_key, local_path):
                return local_path
            else:
                raise FileNotFoundError(f"Critical resource missing: {local_path} (Remote fetch failed)")
                
        return local_path

    def load_string_network(self) -> pd.DataFrame:
        """
        Load STRING network interactions.
        Returns DataFrame with [protein1, protein2, combined_score]
        """
        if "string" in self._cache:
            return self._cache["string"]
            
        path = self._get_file_path("string_processed")
        print(f"Loading STRING network from {path}...")
        
        df = pd.read_parquet(path)
        
        # Validation
        if df.empty:
            raise ValueError("STRING dataset is empty!")
            
        self._cache["string"] = df
        return df

    def load_kegg_pathways(self) -> Dict[str, Any]:
        """
        Load KEGG pathways.
        Returns Dict { pathway_id: {name, genes: []} }
        """
        if "kegg" in self._cache:
            return self._cache["kegg"]
            
        path = self._get_file_path("kegg_processed")
        print(f"Loading KEGG pathways from {path}...")
        
        with open(path) as f:
            data = json.load(f)
            
        if not data:
            raise ValueError("KEGG dataset is empty!")
            
        self._cache["kegg"] = data
        return data

    def load_reactome_pathways(self) -> Dict[str, Any]:
        """
        Load Reactome pathways.
        Returns Dict { pathway_id: {name, genes: []} }
        """
        if "reactome" in self._cache:
            return self._cache["reactome"]
            
        path = self._get_file_path("reactome_processed")
        print(f"Loading Reactome pathways from {path}...")
        
        with open(path) as f:
            data = json.load(f)
            
        if not data:
            raise ValueError("Reactome dataset is empty!")
            
        self._cache["reactome"] = data
        return data

    def load_bagel_essentials(self) -> List[str]:
        """
        Load BAGEL2 core essential genes.
        Returns List[str] of gene symbols.
        """
        if "bagel" in self._cache:
            return self._cache["bagel"]
            
        path = self._get_file_path("bagel_processed")
        print(f"Loading BAGEL2 essentials from {path}...")
        
        with open(path) as f:
            data = json.load(f)
            
        genes = data.get("essential", [])
        if not genes:
            raise ValueError("BAGEL2 dataset is empty or malformed!")
            
        self._cache["bagel"] = genes
        return genes

    def load_depmap_dependencies(self) -> pd.DataFrame:
        """
        Load DepMap gene dependency matrix.
        Returns DataFrame (lines x genes).
        """
        if "depmap" in self._cache:
            return self._cache["depmap"]
            
        path = self._get_file_path("depmap_processed")
        print(f"Loading DepMap dataset from {path}...")
        
        df = pd.read_parquet(path)
        
        if df.empty:
            raise ValueError("DepMap dataset is empty!")
            
        self._cache["depmap"] = df
        return df

    def load_brunello_library(self) -> pd.DataFrame:
        """
        Load Brunello sgRNA library.
        Returns DataFrame with [sgRNA_id, sequence, gene, is_nontargeting]
        """
        if "brunello" in self._cache:
            return self._cache["brunello"]
        
        # Try to get processed file
        # We use a try/catch block because _get_file_path might fail if remote doesn't exist yet
        # But for now, we expect it to exist or we generate it from raw
        
        try:
            path = self._get_file_path("brunello_processed", check_exists=True)
            print(f"Loading Brunello library from {path}...")
            df = pd.read_parquet(path)
        
        except (FileNotFoundError, KeyError):
            print("Processed Brunello library not found. Attempting to parse raw file...")
            # If processed missing, try to generate from raw
            raw_path = self._get_file_path("brunello_raw", check_exists=True)
            # Construct processed path manually if config key exists but file doesn't
            processed_filename = self.config["resources"]["brunello_processed"]
            processed_path = self.config["paths"]["processed"] / processed_filename
            
            from .data_processing.brunello_library import BrunelloParser
            parser = BrunelloParser(str(raw_path), str(processed_path))
            df = parser.process()

        # Sanity check
        if len(df) < 70000:
            raise ValueError(f"Brunello library truncated; expected ~76,441 guides, found {len(df)}")
            
        self._cache["brunello"] = df
        return df

# Singleton
_loader = None
def get_loader() -> ReferenceDataLoader:
    global _loader
    if _loader is None:
        _loader = ReferenceDataLoader()
    return _loader
