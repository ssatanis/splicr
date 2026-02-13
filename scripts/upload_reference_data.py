
import sys
import os
from pathlib import Path

# Add src to path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from src.crispr_confidence.storage import get_storage
from src.crispr_confidence.config import get_config

def upload_reference_data():
    storage = get_storage()
    
    # Check if we have credentials
    if not storage.client:
        print("Storage client not initialized. check env vars.")
        sys.exit(1)
    
    # Define files to upload (Local Path -> Remote Key)
    # Using relative paths from project root
    files_to_upload = {
        "data/raw/string/9606.protein.links.v12.0.txt": "raw/string/9606.protein.links.v12.0.txt"
    }
    
    project_root = Path(__file__).resolve().parent.parent
    
    for local_rel_path, remote_key in files_to_upload.items():
        local_path = project_root / local_rel_path
        
        if not local_path.exists():
            print(f"Skipping {local_rel_path} (not found)")
            continue
            
        print(f"Uploading {local_path} to {remote_key}...")
        success = storage.upload_file(local_path, remote_key)
        
        if success:
            print(f"Upload successful: {remote_key}")
        else:
            print(f"Upload failed: {remote_key}")
            # Don't exit immediately, try other files if any

if __name__ == "__main__":
    upload_reference_data()
