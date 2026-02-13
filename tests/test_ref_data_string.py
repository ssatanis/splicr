
import sys
import os
from pathlib import Path

# Add src to path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from src.crispr_confidence.ref_data import get_loader

def test_string_loading():
    print("Initializing loader...")
    loader = get_loader()
    
    # Ensure processed file does not exist (to force raw processing)
    # config = loader.config
    # processed_path = config["paths"]["processed"] / config["resources"]["string_processed"]
    # if processed_path.exists():
    #     print(f"Removing existing processed file: {processed_path}")
    #     os.remove(processed_path)
    # Actually, let's rely on the loader logic. If it exists, it loads it.
    # To test generation, we should remove it manually or ensure we are using a test environment.
    # For this safe run, let's just see if it loads *something*.
    
    try:
        print("Calling load_string_network()...")
        df = loader.load_string_network()
        print(f"Successfully loaded STRING network with {len(df)} interactions.")
        print(df.head())
    except Exception as e:
        print(f"Failed to load: {e}")
        # Print traceback
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_string_loading()
