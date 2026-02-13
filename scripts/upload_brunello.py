
import sys
import os
from pathlib import Path

# Add src to path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from src.crispr_confidence.storage import get_storage
from src.crispr_confidence.config import get_config

def upload_brunello():
    config = get_config()
    storage = get_storage()
    
    # Check if we have credentials
    if not storage.client:
        print("Storage client not initialized. check env vars.")
        sys.exit(1)
        
    local_path = config["paths"]["processed"] / config["resources"]["brunello_processed"]
    remote_key = f"processed/{config['resources']['brunello_processed']}"
    
    if not local_path.exists():
        print(f"File not found: {local_path}")
        sys.exit(1)
        
    print(f"Uploading {local_path} to {remote_key}...")
    success = storage.upload_file(local_path, str(remote_key))
    
    if success:
        print("Upload successful!")
    else:
        print("Upload failed.")
        sys.exit(1)

if __name__ == "__main__":
    upload_brunello()
