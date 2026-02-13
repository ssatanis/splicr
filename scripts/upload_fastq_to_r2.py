"""
SplicR Data Upload Utility
--------------------------
Use this script to upload large FASTQ files to R2 storage instead of committing them to Git.
This ensures your deployment remains lean and storage is handled correctly.

Usage:
    python scripts/upload_fastq_to_r2.py <local_fastq_path> <remote_key_path>

Example:
    python scripts/upload_fastq_to_r2.py data/raw/fastq/PRJNA1021241/SRR26183442.fastq.gz raw/fastq/PRJNA1021241/SRR26183442.fastq.gz
"""
import sys
import os
from pathlib import Path

# Add src to path
sys.path.append(str(Path(__file__).resolve().parent.parent / "src"))

from crispr_confidence.storage import get_storage

def main():
    if len(sys.argv) < 3:
        print("Usage: python scripts/upload_fastq_to_r2.py <local_path> <remote_key>")
        sys.exit(1)
        
    local_path = Path(sys.argv[1])
    remote_key = sys.argv[2]
    
    if not local_path.exists():
        print(f"Error: Local file {local_path} not found.")
        sys.exit(1)
        
    storage = get_storage()
    if not storage.client:
        print("Error: R2 storage not configured. check your .env and R2_ENDPOINT_URL.")
        sys.exit(1)
        
    print(f"Starting upload: {local_path} -> {remote_key}...")
    success = storage.upload_file(local_path, remote_key)
    
    if success:
        print(f"✓ Successfully uploaded {local_path.name} to R2.")
        print("You can now safely delete the local file if you need space.")
    else:
        print("✗ Upload failed. Check logs and credentials.")

if __name__ == "__main__":
    main()
