"""Helper utility functions"""
from datetime import datetime, timedelta
from typing import Optional
import hashlib
import secrets


def generate_random_token(length: int = 32) -> str:
    """Generate random secure token"""
    return secrets.token_urlsafe(length)


def hash_string(value: str) -> str:
    """Hash string using SHA256"""
    return hashlib.sha256(value.encode()).hexdigest()


def format_file_size(size_bytes: int) -> str:
    """Format file size to human-readable format"""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.2f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.2f} PB"


def calculate_time_elapsed(start: datetime, end: Optional[datetime] = None) -> str:
    """Calculate human-readable time elapsed"""
    if end is None:
        end = datetime.utcnow()
    
    delta = end - start
    seconds = delta.total_seconds()
    
    if seconds < 60:
        return f"{int(seconds)} seconds"
    elif seconds < 3600:
        return f"{int(seconds / 60)} minutes"
    elif seconds < 86400:
        hours = int(seconds / 3600)
        minutes = int((seconds % 3600) / 60)
        return f"{hours}h {minutes}m"
    else:
        days = int(seconds / 86400)
        hours = int((seconds % 86400) / 3600)
        return f"{days}d {hours}h"


def estimate_cost(compute_time_seconds: float, vcpus: int = 4, memory_gb: int = 16) -> float:
    """
    Estimate AWS compute cost
    
    Simplified cost calculation based on AWS Batch pricing
    Actual costs may vary
    """
    # Example rates (adjust based on actual AWS pricing)
    cpu_cost_per_hour = 0.04  # per vCPU
    memory_cost_per_hour = 0.01  # per GB
    
    hours = compute_time_seconds / 3600
    
    cpu_cost = vcpus * cpu_cost_per_hour * hours
    memory_cost = memory_gb * memory_cost_per_hour * hours
    
    return round(cpu_cost + memory_cost, 4)


def validate_s3_key(s3_key: str) -> bool:
    """Validate S3 key format"""
    if not s3_key:
        return False
    
    # Check for invalid characters
    invalid_chars = ['\\', '{', '^', '}', '%', '`', '[', ']', '~', '<', '>', '#', '|']
    if any(char in s3_key for char in invalid_chars):
        return False
    
    # Check length
    if len(s3_key) > 1024:
        return False
    
    return True


def sanitize_filename(filename: str) -> str:
    """Sanitize filename for safe storage"""
    # Remove or replace unsafe characters
    unsafe_chars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|']
    for char in unsafe_chars:
        filename = filename.replace(char, '_')
    
    return filename
