import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

# Sample Payload
SAMPLE_PAYLOAD = {
    "gene_data": [
        {
            "gene_id": "GENE_A",
            "beta_score": -1.5,
            "fdr": 0.001,
            "lfc": -2.0,
            "max_offtarget_risk": 0.0
        },
        {
            "gene_id": "GENE_B",
            "beta_score": -0.1,
            "fdr": 0.8,
            "lfc": -0.1,
            "max_offtarget_risk": 3.0
        }
    ],
    "guide_data": {
        "GENE_A": [-1.9, -2.1, -2.0, -1.8], # Good concordance
        "GENE_B": [0.5, -0.5, 0.0, 1.0]     # Poor concordance
    },
    "replicate_data": {
        "GENE_A": [-2.0, -1.9],
        "GENE_B": [-0.2, 0.0]
    }
}

def test_calculate_ccs_endpoint():
    response = client.post(
        "/api/v1/ccs/calculate_ccs",
        json=SAMPLE_PAYLOAD
    )
    
    assert response.status_code == 200
    results = response.json()
    assert len(results) == 2
    
    # Check GENE_A (Should be Medium Risk / Good Candidate without pathway data)
    gene_a = next(r for r in results if r['gene'] == "GENE_A")
    assert gene_a['score'] > 60
    assert gene_a['tier'] in ["Medium Risk", "Good Candidate"]
    assert gene_a['components']['sgRNA_concordance'] > 80
    assert gene_a['components']['validation_likelihood'] > 50
    
    # Check GENE_B (Should be low confidence)
    gene_b = next(r for r in results if r['gene'] == "GENE_B")
    assert gene_b['score'] < 50
    assert gene_b['tier'] == "High Risk"
    assert gene_b['components']['sgRNA_concordance'] < 50
    assert gene_b['components']['offtarget_risk'] == 100.0 # Max risk > 2.5
