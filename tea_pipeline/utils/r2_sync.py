import os
import boto3
from botocore.config import Config
from pathlib import Path
from dotenv import load_dotenv

# Load env from root or backend
load_dotenv(Path(__file__).parent.parent.parent / ".env.local")
load_dotenv(Path(__file__).parent.parent.parent / "backend" / ".env")

def get_r2_client():
    endpoint = os.getenv("R2_ENDPOINT_URL")
    access_key = os.getenv("AWS_ACCESS_KEY_ID")
    secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
    
    if not all([endpoint, access_key, secret_key]):
        print("Error: R2 credentials missing in .env files.")
        return None
        
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto"
    )

def sync_to_r2(local_dir: Path, bucket: str, prefix: str = "tea_data/"):
    client = get_r2_client()
    if not client:
        return
        
    print(f"Syncing {local_dir} to r2://{bucket}/{prefix}...")
    
    for file_path in local_dir.rglob("*"):
        if file_path.is_file():
            relative_path = file_path.relative_to(local_dir)
            r2_key = f"{prefix}{relative_path}"
            
            print(f"Uploading {relative_path} -> {r2_key}...")
            client.upload_file(str(file_path), bucket, r2_key)
            
    print("Sync complete.")

def test_connection():
    client = get_r2_client()
    if not client:
        return False
        
    try:
        client.list_buckets()
        print("R2 Connection Successful!")
        return True
    except Exception as e:
        print(f"R2 Connection Failed: {e}")
        return False

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Sync tea_data to Cloudflare R2")
    parser.add_argument("--test", action="store_true", help="Test R2 connection")
    parser.add_argument("--upload", action="store_true", help="Upload tea_data to R2")
    args = parser.parse_args()
    
    ROOT_DIR = Path(__file__).parent.parent.parent
    TEA_DATA_DIR = ROOT_DIR / "tea_data"
    BUCKET = os.getenv("S3_BUCKET_NAME", "splicr-fastq-files")
    
    if args.test:
        test_connection()
    elif args.upload:
        if not TEA_DATA_DIR.exists():
            print(f"Error: {TEA_DATA_DIR} does not exist.")
        else:
            sync_to_r2(TEA_DATA_DIR, BUCKET)
    else:
        parser.print_help()
