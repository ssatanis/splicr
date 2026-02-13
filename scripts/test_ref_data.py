"""
Test script for Reference Data Loader.
"""
import sys
from pathlib import Path
import pandas as pd

# Add src to path
PROJECT_ROOT = Path(__file__).parent.parent.resolve()
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from crispr_confidence.ref_data import get_loader

def test_loader():
    print("=" * 60)
    print("TESTING REFERENCE DATA LOADER")
    print("=" * 60 + "\n")
    
    loader = get_loader()
    
    # 1. Test BAGEL (Smallest)
    try:
        essentials = loader.load_bagel_essentials()
        print(f"✓ BAGEL essentials loaded: {len(essentials)} genes")
        print(f"  Sample: {essentials[:5]}")
    except Exception as e:
        print(f"✗ BAGEL load failed: {e}")

    # 2. Test KEGG
    try:
        kegg = loader.load_kegg_pathways()
        print(f"✓ KEGG pathways loaded: {len(kegg)} pathways")
        # Spot check
        first_id = list(kegg.keys())[0]
        print(f"  Sample: {first_id} -> {kegg[first_id]['name']}")
    except Exception as e:
        print(f"✗ KEGG load failed: {e}")

    # 3. Test Reactome
    try:
        reactome = loader.load_reactome_pathways()
        print(f"✓ Reactome pathways loaded: {len(reactome)} pathways")
    except Exception as e:
        print(f"✗ Reactome load failed: {e}")

    # 4. Test STRING (Parquet)
    try:
        # Check if file exists first to avoid massive load if missing
        string_df = loader.load_string_network()
        print(f"✓ STRING network loaded: {len(string_df)} interactions")
        print(f"  Columns: {string_df.columns.tolist()}")
    except Exception as e:
        print(f"✗ STRING load failed: {e}")

    # 5. Test DepMap (Parquet)
    try:
        depmap = loader.load_depmap_dependencies()
        print(f"✓ DepMap loaded: {depmap.shape[0]} cell lines x {depmap.shape[1]} genes")
    except Exception as e:
        print(f"✗ DepMap load failed: {e}")

if __name__ == "__main__":
    test_loader()
