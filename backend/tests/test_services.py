"""Service layer tests"""
import pytest
from app.utils.helpers import (
    format_file_size,
    calculate_time_elapsed,
    estimate_cost,
    validate_s3_key,
    sanitize_filename
)
from datetime import datetime, timedelta


def test_format_file_size():
    """Test file size formatting"""
    assert format_file_size(0) == "0.00 B"
    assert format_file_size(1024) == "1.00 KB"
    assert format_file_size(1024 * 1024) == "1.00 MB"
    assert format_file_size(1024 * 1024 * 1024) == "1.00 GB"


def test_calculate_time_elapsed():
    """Test time elapsed calculation"""
    start = datetime(2026, 1, 1, 12, 0, 0)
    end = datetime(2026, 1, 1, 12, 0, 30)
    assert "30 seconds" in calculate_time_elapsed(start, end)
    
    end = datetime(2026, 1, 1, 12, 5, 0)
    assert "5 minutes" in calculate_time_elapsed(start, end)
    
    end = datetime(2026, 1, 1, 14, 30, 0)
    result = calculate_time_elapsed(start, end)
    assert "2h" in result and "30m" in result


def test_estimate_cost():
    """Test cost estimation"""
    cost = estimate_cost(3600, vcpus=4, memory_gb=16)  # 1 hour
    assert cost > 0
    assert isinstance(cost, float)


def test_validate_s3_key():
    """Test S3 key validation"""
    assert validate_s3_key("valid/path/to/file.fastq") == True
    assert validate_s3_key("uploads/2026/01/29/file.gz") == True
    assert validate_s3_key("invalid<key>") == False
    assert validate_s3_key("") == False
    assert validate_s3_key("a" * 2000) == False  # Too long


def test_sanitize_filename():
    """Test filename sanitization"""
    assert sanitize_filename("normal.txt") == "normal.txt"
    assert sanitize_filename("file/with/slashes.txt") == "file_with_slashes.txt"
    assert sanitize_filename("file:with:colons.txt") == "file_with_colons.txt"
    assert sanitize_filename("file*?<>.txt") == "file____.txt"
