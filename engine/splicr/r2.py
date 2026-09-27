"""
Cloudflare R2 object storage.

R2 speaks the S3 API, so boto3 works unchanged. The one quirk worth writing
down: for S3 compatibility Cloudflare derives the credentials from an API
token rather than issuing a separate key pair.

    Access Key ID      = the API token's id
    Secret Access Key  = the hex SHA-256 of the API token's value

Both are stored in .env by scripts/data/upload-r2.py so nothing has to
recompute them, but derive_credentials() is here so a fresh token can be
wired up in one line.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

try:
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError
except ImportError:  # pragma: no cover
    boto3 = None

from .db import _load_env


def derive_credentials(token: str, token_id: str) -> tuple[str, str]:
    """R2's S3 credentials from a Cloudflare API token."""
    return token_id, hashlib.sha256(token.encode()).hexdigest()


@dataclass(frozen=True)
class R2Config:
    account_id: str
    bucket: str
    endpoint: str
    access_key_id: str
    secret_access_key: str

    @classmethod
    def from_env(cls) -> "R2Config":
        _load_env()
        missing = [
            k for k in ("R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")
            if not os.environ.get(k)
        ]
        if missing:
            raise RuntimeError(
                f"R2 is not configured: {', '.join(missing)} missing from .env"
            )
        account = os.environ["R2_ACCOUNT_ID"]
        return cls(
            account_id=account,
            bucket=os.environ["R2_BUCKET"],
            endpoint=os.environ.get("R2_ENDPOINT")
            or f"https://{account}.r2.cloudflarestorage.com",
            access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        )


def client(config: R2Config | None = None):
    if boto3 is None:  # pragma: no cover
        raise RuntimeError(
            "boto3 is not installed: engine/.tools/env/bin/python -m pip install boto3"
        )
    cfg = config or R2Config.from_env()
    return boto3.client(
        "s3",
        endpoint_url=cfg.endpoint,
        aws_access_key_id=cfg.access_key_id,
        aws_secret_access_key=cfg.secret_access_key,
        region_name="auto",
        # R2 rejects the newer default checksum headers, so pin to plain SigV4.
        config=Config(signature_version="s3v4", retries={"max_attempts": 5, "mode": "standard"}),
    )


def head(s3, bucket: str, key: str) -> dict | None:
    try:
        return s3.head_object(Bucket=bucket, Key=key)
    except ClientError as exc:
        if exc.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
            return None
        raise


def upload(
    s3,
    bucket: str,
    path: Path,
    key: str,
    content_type: str | None = None,
    skip_if_same_size: bool = True,
) -> tuple[bool, int]:
    """
    Upload one file. Returns (uploaded, bytes).

    Skips when an object of the same size already exists, which makes the
    whole sync re-runnable without paying to move gigabytes twice.
    Files above 100 MB go through multipart automatically via upload_file.
    """
    size = path.stat().st_size
    if skip_if_same_size:
        existing = head(s3, bucket, key)
        if existing is not None and existing.get("ContentLength") == size:
            return False, size

    extra: dict = {}
    if content_type:
        extra["ContentType"] = content_type
    s3.upload_file(str(path), bucket, key, ExtraArgs=extra or None)
    return True, size


CONTENT_TYPES = {
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".txt": "text/plain",
    ".json": "application/json",
    ".jsonl": "application/x-ndjson",
    ".md": "text/markdown",
    ".gz": "application/gzip",
    ".zip": "application/zip",
    ".parquet": "application/vnd.apache.parquet",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".fastq": "text/plain",
    ".rdata": "application/octet-stream",
}


def guess_content_type(path: Path) -> str:
    return CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")


def iter_objects(s3, bucket: str, prefix: str = "") -> Iterator[dict]:
    token = None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": 1000}
        if token:
            kwargs["ContinuationToken"] = token
        page = s3.list_objects_v2(**kwargs)
        for obj in page.get("Contents", []):
            yield obj
        if not page.get("IsTruncated"):
            return
        token = page.get("NextContinuationToken")
