"""
Storage abstraction layer for CRISPR Confidence Score artifacts.
Supports Cloudflare R2 / S3-compatible storage.
"""
import os
import boto3
from botocore.exceptions import ClientError
from botocore.config import Config
from pathlib import Path
from typing import Optional
from .config import get_config

class StorageManager:
    def __init__(self):
        self.config = get_config()
        self.storage_conf = self.config.get("storage", {})
        self.bucket_name = self.storage_conf.get("bucket_name")
        self.prefix = self.storage_conf.get("prefix", "")
        
        # S3 / R2 Credentials
        self.endpoint_url = os.environ.get("R2_ENDPOINT_URL")
        self.access_key = os.environ.get("AWS_ACCESS_KEY_ID")
        self.secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY")
        self.region = self.storage_conf.get("region", "auto")
        
        self.client = self._init_client()

    def _init_client(self):
        """Initialize boto3 client."""
        if not all([self.endpoint_url, self.access_key, self.secret_key, self.bucket_name]):
            print("⚠ Storage credentials incomplete. Storage features disabled.")
            return None
            
        try:
            config = Config(
                region_name=self.region,
                retries={'max_attempts': 3, 'mode': 'adaptive'},
                connect_timeout=5,
                read_timeout=60
            )
            return boto3.client(
                's3',
                endpoint_url=self.endpoint_url,
                aws_access_key_id=self.access_key,
                aws_secret_access_key=self.secret_key,
                config=config
            )
        except Exception as e:
            print(f"✗ Failed to initialize storage client: {e}")
            return None

    def _get_remote_key(self, remote_path: str) -> str:
        """Prepend prefix to remote path if configured."""
        # Clean path to avoid double slashes
        key = f"{self.prefix}/{remote_path}".replace("//", "/")
        if key.startswith("/"):
            key = key[1:]
        return key

    def upload_file(self, local_path: Path, remote_path: str) -> bool:
        """Upload file to storage."""
        if not self.client:
            return False
            
        key = self._get_remote_key(remote_path)
        print(f"Uploading {local_path.name} -> {key} ...")
        
        try:
            self.client.upload_file(str(local_path), self.bucket_name, key)
            print(f"✓ Upload successful")
            return True
        except ClientError as e:
            print(f"✗ Upload failed: {e}")
            return False

    def download_file(self, remote_path: str, local_path: Path) -> bool:
        """Download file from storage."""
        if not self.client:
            return False
            
        key = self._get_remote_key(remote_path)
        print(f"Downloading {key} -> {local_path.name} ...")
        
        try:
            local_path.parent.mkdir(parents=True, exist_ok=True)
            self.client.download_file(self.bucket_name, key, str(local_path))
            print(f"✓ Download successful")
            return True
        except ClientError as e:
            if e.response['Error']['Code'] == "404":
                print(f"✗ File not found: {key}")
            else:
                print(f"✗ Download failed: {e}")
            return False

    def file_exists(self, remote_path: str) -> bool:
        """Check if file exists in storage."""
        if not self.client:
            return False
            
        key = self._get_remote_key(remote_path)
        try:
            self.client.head_object(Bucket=self.bucket_name, Key=key)
            return True
        except ClientError:
            return False

# Singleton instance
_storage = None

def get_storage() -> StorageManager:
    global _storage
    if _storage is None:
        _storage = StorageManager()
    return _storage
