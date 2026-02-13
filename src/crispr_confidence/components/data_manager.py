"""
Data Manager for CRISPR Confidence Score Components
Handles loading and caching of reference datasets (STRING, KEGG, Reactome, etc.)
"""
import json
import pandas as pd
from pathlib import Path
from typing import Dict, Any, Optional
import networkx as nx
from ..config import get_config

class ReferenceDataManager:
    """
    Singleton-style manager for loading and accessing reference data.
    """
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ReferenceDataManager, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
            
        self.config = get_config()
        self.paths = self.config["paths"]
        self.resources = self.config["resources"]
        
        # Cache for loaded data
        self._string_network: Optional[nx.Graph] = None
        self._kegg_pathways: Optional[Dict] = None
        self._reactome_pathways: Optional[Dict] = None
        self._bagel_essentials: Optional[list] = None
        self._depmap_effect: Optional[pd.DataFrame] = None
        
        self._initialized = True

    def load_string_network(self, confidence_threshold: int = 400) -> nx.Graph:
        """
        Load STRING PPI network from processed Parquet file.
        Returns NetworkX graph.
        """
        if self._string_network is not None:
            return self._string_network
            
        file_path = self.paths["processed"] / self.resources["string_processed"]
        
        if not file_path.exists():
            print(f"⚠ STRING data not found at {file_path}. Returning empty graph.")
            self._string_network = nx.Graph()
            return self._string_network
            
        try:
            # Load edge list
            df = pd.read_parquet(file_path)
            
            # Construct graph
            # Assumes columns: protein1, protein2, combined_score
            G = nx.from_pandas_edgelist(
                df, 
                source='protein1', 
                target='protein2', 
                edge_attr='combined_score'
            )
            self._string_network = G
            return G
        except Exception as e:
            print(f"✗ Error loading STRING network: {e}")
            return nx.Graph()

    def load_kegg_pathways(self) -> Dict[str, Any]:
        """
        Load KEGG pathways from JSON.
        Returns dict: {pathway_id: {name: str, genes: [list]}}
        """
        if self._kegg_pathways is not None:
            return self._kegg_pathways
            
        file_path = self.paths["processed"] / self.resources["kegg_processed"]
        
        if not file_path.exists():
            print(f"⚠ KEGG data not found at {file_path}")
            return {}
            
        try:
            with open(file_path, 'r') as f:
                self._kegg_pathways = json.load(f)
            return self._kegg_pathways
        except Exception as e:
            print(f"✗ Error loading KEGG pathways: {e}")
            return {}

    def load_reactome_pathways(self) -> Dict[str, Any]:
        """
        Load Reactome pathways from JSON.
        Returns dict: {pathway_id: {name: str, genes: [list]}}
        """
        if self._reactome_pathways is not None:
            return self._reactome_pathways
            
        file_path = self.paths["processed"] / self.resources["reactome_processed"]
        
        if not file_path.exists():
            print(f"⚠ Reactome data not found at {file_path}")
            return {}
            
        try:
            with open(file_path, 'r') as f:
                self._reactome_pathways = json.load(f)
            return self._reactome_pathways
        except Exception as e:
            print(f"✗ Error loading Reactome pathways: {e}")
            return {}

    def load_bagel_essentials(self) -> list:
        """
        Load BAGEL2 essential genes list.
        """
        if self._bagel_essentials is not None:
            return self._bagel_essentials
            
        file_path = self.paths["processed"] / self.resources["bagel_processed"]
        
        if not file_path.exists():
            print(f"⚠ BAGEL2 data not found at {file_path}")
            return []
            
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
                self._bagel_essentials = data.get("essential", [])
            return self._bagel_essentials
        except Exception as e:
            print(f"✗ Error loading BAGEL2 essentials: {e}")
            return []

    def get_all_pathways_combined(self) -> Dict[str, Any]:
        """
        Merge KEGG and Reactome into a single dictionary for enrichment analysis.
        Keys are prefixed to avoid collisions (e.g., 'KEGG:hsa123', 'REACT:R-HSA-123')
        """
        kegg = self.load_kegg_pathways()
        reactome = self.load_reactome_pathways()
        
        combined = {}
        for pid, data in kegg.items():
            combined[f"KEGG:{pid}"] = data
            
        for pid, data in reactome.items():
            combined[f"REACT:{pid}"] = data
            
        return combined

# Global accessor
def get_data_manager() -> ReferenceDataManager:
    return ReferenceDataManager()
