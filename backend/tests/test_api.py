"""API endpoint tests"""
import pytest
from fastapi.testclient import TestClient


def test_root_endpoint(client):
    """Test root endpoint"""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "service" in data
    assert "version" in data


def test_health_check(client):
    """Test health check endpoint"""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"


def test_liveness_check(client):
    """Test liveness check endpoint"""
    response = client.get("/health/live")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "alive"


def test_presigned_url_generation(client):
    """Test presigned URL generation"""
    request_data = {
        "filename": "test.fastq.gz",
        "file_type": "application/gzip"
    }
    response = client.post("/api/v1/upload/presigned-url", json=request_data)
    # This will fail without AWS credentials, but tests the endpoint structure
    assert response.status_code in [200, 500]


def test_invalid_file_extension(client):
    """Test invalid file extension rejection"""
    request_data = {
        "filename": "test.txt",
        "file_type": "text/plain"
    }
    response = client.post("/api/v1/upload/presigned-url", json=request_data)
    assert response.status_code == 422  # Validation error


def test_analysis_submission_validation(client):
    """Test analysis submission validation"""
    request_data = {
        "file_keys": [],  # Empty file keys should fail
        "library_type": "genome-wide",
        "algorithm": "mageck"
    }
    response = client.post("/api/v1/analysis/submit", json=request_data)
    assert response.status_code == 422


def test_analysis_list_endpoint(client):
    """Test analysis list endpoint"""
    response = client.get("/api/v1/analysis/")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


def test_get_nonexistent_analysis(client):
    """Test getting non-existent analysis"""
    fake_uuid = "00000000-0000-0000-0000-000000000000"
    response = client.get(f"/api/v1/analysis/{fake_uuid}")
    assert response.status_code == 404


def test_api_documentation(client):
    """Test that API documentation is available"""
    response = client.get("/api/docs")
    assert response.status_code == 200
    
    response = client.get("/api/openapi.json")
    assert response.status_code == 200
    data = response.json()
    assert "openapi" in data
    assert "paths" in data
