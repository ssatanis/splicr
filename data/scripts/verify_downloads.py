#!/usr/bin/env python3
"""Verify all required databases are downloaded"""
from pathlib import Path
import json

BASE_DIR = Path(__file__).parent.parent.resolve()
RAW_DIR = BASE_DIR / "raw"
PROCESSED_DIR = BASE_DIR / "processed"

REQUIRED_FILES = {
    'raw': [
        '9606.protein.links.v12.0.txt', # STRING (decompressed)
        'UniProt2Reactome.txt',        # Reactome
        'CEG2_essentials.txt',         # Essential genes
    ],
    'processed': [
        'kegg_pathways.json',      # KEGG (processed)
        'reactome_pathways.json',  # Reactome (processed)
    ]
}

def check_file(path, required_size_mb=None):
    """Check if file exists and optionally verify size"""
    if not path.exists():
        return False, "Missing"
    
    size_mb = path.stat().st_size / (1024 * 1024)
    if required_size_mb and size_mb < required_size_mb:
        return False, f"Too small ({size_mb:.1f} MB < {required_size_mb} MB)"
        
    return True, f"OK ({size_mb:.1f} MB)"

def main():
    print("=" * 60)
    print("VERIFYING DOWNLOADS")
    print("=" * 60 + "\n")
    
    all_ok = True
    
    # Check raw files
    print("Raw files:")
    for filename in REQUIRED_FILES['raw']:
        path = RAW_DIR / filename
        ok, msg = check_file(path)
        status = "✓" if ok else "✗"
        print(f" {status} {filename}: {msg}")
        if not ok:
            all_ok = False
            
    print()
    
    # Check processed files
    print("Processed files:")
    for filename in REQUIRED_FILES['processed']:
        path = PROCESSED_DIR / filename
        ok, msg = check_file(path)
        
        # For JSON files, also check structure
        if ok and filename.endswith('.json'):
            try:
                with open(path) as f:
                    data = json.load(f)
                msg = f"OK ({len(data)} pathways)"
            except Exception as e:
                ok = False
                msg = f"Invalid JSON: {e}"
        
        status = "✓" if ok else "✗"
        print(f" {status} {filename}: {msg}")
        if not ok:
            all_ok = False

    print("\n" + "=" * 60)
    if all_ok:
        print("✓ ALL REQUIRED FILES PRESENT")
    else:
        print("✗ SOME FILES MISSING - Run download script")
    print("=" * 60)

if __name__ == '__main__':
    main()
