#!/usr/bin/env python3
"""
Bootstrap environment for CRISPR Confidence Score.
Validates raw data, creates directories, and syncs basic artifacts.
"""
import sys
from pathlib import Path

# Add src to path
PROJECT_ROOT = Path(__file__).parent.parent.resolve()
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from crispr_confidence.config import get_config
from crispr_confidence.storage import get_storage

def bootstrap():
    print("=" * 60)
    print("BOOTSTRAPPING CRISPR CONFIDENCE SCORE ENVIRONMENT")
    print("=" * 60 + "\n")
    
    config = get_config()
    paths = config["paths"]
    resources = config["resources"]
    
    # 1. Create Directories
    print("1. Creating Directories...")
    for key, path in paths.items():
        if isinstance(path, Path):
            path.mkdir(parents=True, exist_ok=True)
            print(f"  ✓ {key}: {path}")
            
    # 2. Validate Raw Files
    print("\n2. Validating Raw Data...")
    raw_path = paths["raw"]
    missing_raw = []
    
    # List of expected critical raw files
    expected_raw = [
        resources["string_db"],
        resources["reactome_raw"],
        resources["bagel_essentials"]
    ]
    
    for filename in expected_raw:
        file_path = raw_path / filename
        if file_path.exists():
            print(f"  ✓ Found: {filename} ({file_path.stat().st_size / (1024*1024):.1f} MB)")
        else:
            print(f"  ✗ Missing: {filename}")
            missing_raw.append(filename)
            
    if missing_raw:
        print(f"\n⚠ Warning: {len(missing_raw)} raw files are missing.")
        print("  Please run: python data/scripts/download_databases.py")
    else:
        print("\n✓ All raw files present.")

    # 3. Storage Sync check
    print("\n3. Storage Initialization...")
    storage = get_storage()
    if storage.client:
        print(f"  ✓ Storage backend active: {config['storage']['backend']}")
        print(f"  ✓ Bucket: {config['storage']['bucket_name']}")
        
        # Attempt to upload processed files if they exist locally but not remote
        processed_path = paths["processed"]
        processed_files = [resources["kegg_processed"], resources["reactome_processed"]]
        
        for filename in processed_files:
            local_file = processed_path / filename
            remote_path = f"processed/{filename}"
            
            if local_file.exists():
                # Check if exists remotely (simple check, doesn't verify hash/size for speed)
                if not storage.file_exists(remote_path):
                    print(f"  ☁ Uploading missing artifact: {filename}")
                    storage.upload_file(local_file, remote_path)
                else:
                    print(f"  ✓ synced: {filename}")
            else:
                 # Check if we can download it
                if storage.file_exists(remote_path):
                     print(f"  ☁ Downloading missing local artifact: {filename}")
                     storage.download_file(remote_path, local_file)

    else:
        print("  ✗ Storage not configured (check env vars).")

    print("\n" + "=" * 60)
    print("BOOTSTRAP COMPLETE")
    print("=" * 60)

if __name__ == "__main__":
    bootstrap()
