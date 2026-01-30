"""
SplicR Python SDK - API client for CRISPR screen analysis.

Usage:
    from splicr import SplicRClient

    client = SplicRClient(api_key='sk_live_...')

    # Create analysis
    analysis = client.create_analysis(
        name='My Screen',
        library='brunello',
        method='mageck',
        fastq_files=['control.fastq', 'treatment.fastq']
    )

    # Run BAGEL2 on existing analysis
    bagel_result = client.run_bagel2(analysis['id'])

    # Get results
    results = client.get_results(analysis['id'])
"""

import requests
from typing import Any, Dict, List, Optional


class SplicRClient:
    """Client for the SplicR REST API."""

    def __init__(self, api_key: str, base_url: str = "https://splicr.ai"):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {api_key}"})

    def create_analysis(
        self,
        name: str,
        library: str = "brunello",
        method: str = "mageck",
        fastq_files: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Create a new CRISPR analysis."""
        response = self.session.post(
            f"{self.base_url}/api/v1/analyses",
            json={
                "name": name,
                "library": library,
                "method": method,
                "fastq_files": fastq_files or [],
                **kwargs,
            },
        )
        response.raise_for_status()
        return response.json()

    def get_analysis(self, analysis_id: str) -> Dict[str, Any]:
        """Get analysis details."""
        response = self.session.get(f"{self.base_url}/api/v1/analyses/{analysis_id}")
        response.raise_for_status()
        return response.json()

    def get_results(self, analysis_id: str) -> Dict[str, Any]:
        """Get analysis results."""
        response = self.session.get(f"{self.base_url}/api/v1/analyses/{analysis_id}/results")
        response.raise_for_status()
        return response.json()

    def run_bagel2(self, analysis_id: str, **kwargs: Any) -> Dict[str, Any]:
        """Run BAGEL2 on an existing analysis."""
        response = self.session.post(
            f"{self.base_url}/api/analyze/bagel2",
            json={"analysisId": analysis_id, **kwargs},
        )
        response.raise_for_status()
        return response.json()

    def run_drugz(self, analysis_id: str, **kwargs: Any) -> Dict[str, Any]:
        """Run DrugZ on an existing analysis."""
        response = self.session.post(
            f"{self.base_url}/api/analyze/drugz",
            json={"analysisId": analysis_id, **kwargs},
        )
        response.raise_for_status()
        return response.json()

    def list_analyses(self) -> List[Dict[str, Any]]:
        """List all analyses."""
        response = self.session.get(f"{self.base_url}/api/v1/analyses")
        response.raise_for_status()
        return response.json()

    def list_templates(self) -> List[Dict[str, Any]]:
        """List analysis templates."""
        response = self.session.get(f"{self.base_url}/api/v1/templates")
        response.raise_for_status()
        return response.json()

    def use_template(self, template_id: str, parameters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Use an analysis template."""
        response = self.session.post(
            f"{self.base_url}/api/v1/templates/{template_id}/use",
            json={"parameters": parameters or {}},
        )
        response.raise_for_status()
        return response.json()
