#!/usr/bin/env python3
"""
Fetch processed databases from R2 Cloud Storage
Run: python data/scripts/fetch_from_cloud.py
"""
import os
import boto3
from pathlib import Path
from tqdm import tqdm
from botocore.exceptions import ClientError
from botocore.config import Config

# --- Configuration ---
BASE_DIR = Path(__file__).parent.parent.resolve()
RAW_DIR = BASE_DIR / "raw"
PROCESSED_DIR = BASE_DIR / "processed"

# R2 Configuration
R2_ENDPOINT_URL = os.environ.get("R2_ENDPOINT_URL")
AWS_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY")
S3_BUCKET_NAME = os.environ.get("S3_BUCKET_NAME")
AWS_REGION = os.environ.get("AWS_REGION", "auto")

def get_s3_client():
    if not all([R2_ENDPOINT_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME]):
        print("✗ R2 credentials missing. Please set R2_ENDPOINT_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME")
        return None
        
    config = Config(
        region_name=AWS_REGION,
        retries={'max_attempts': 3, 'mode': 'adaptive'},
        connect_timeout=5,
        read_timeout=60
    )
    return boto3.client(
        's3',
        endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
        config=config
    )

def download_from_r2(s3_client, s3_key, local_path):
    """Download file from R2 if it exists"""
    if local_path.exists():
        print(f"✓ Local file exists: {local_path.name}")
        return True
        
    print(f"Fetching {s3_key} from R2...")
    try:
        # Check size first
        response = s3_client.head_object(Bucket=S3_BUCKET_NAME, Key=s3_key)
        total_size = response['ContentLength']
        
        local_path.parent.mkdir(parents=True, exist_ok=True)
        
        with tqdm(total=total_size, unit='B', unit_scale=True, desc=local_path.name) as pbar:
            s3_client.download_file(
                S3_BUCKET_NAME,
                s3_key,
                str(local_path),
                Callback=pbar.update
            )
        print(f"✓ Downloaded {local_path.name}")
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == "404":
            print(f"✗ File not found in R2: {s3_key}")
        else:
            print(f"✗ Error downloading {s3_key}: {e}")
        return False

def main():
    print("=" * 60)
    print("FETCHING PRE-GENERATED DATA FROM CLOUD")
    print("=" * 60 + "\n")
    
    s3_client = get_s3_client()
    if not s3_client:
        return

    # files to fetch mapped to (s3_key, local_path)
    # Assuming s3 key structure mimics local structure relative to data/
    # e.g. data/processed/kegg_pathways.json
    
    files_to_sync = [
        # Processed files
        ('data/processed/kegg_pathways.json', PROCESSED_DIR / 'kegg_pathways.json'),
        ('data/processed/reactome_pathways.json', PROCESSED_DIR / 'reactome_pathways.json'),
        
        # Raw files (optional, maybe skip huge ones or make configurable)
        ('data/raw/CEG2_essentials.txt', RAW_DIR / 'CEG2_essentials.txt'),
        ('data/raw/UniProt2Reactome.txt', RAW_DIR / 'UniProt2Reactome.txt'),
        # ('data/raw/hg38.fa', RAW_DIR / 'hg38.fa'), # Too big?
    ]
    
    for s3_key, local_path in files_to_sync:
        download_from_r2(s3_client, s3_key, local_path)

    print("\n" + "=" * 60)
    print("SYNC COMPLETE")
    print("=" * 60)

if __name__ == "__main__":
    main()
