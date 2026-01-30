"""
Progress Reporter for real-time updates via WebSocket/API
"""

import requests
import os
import logging

logger = logging.getLogger(__name__)


class ProgressReporter:
    """Report analysis progress to backend API"""
    
    def __init__(self, analysis_id):
        self.analysis_id = analysis_id
        self.api_url = os.getenv('API_URL', 'http://api:8000')
        self.enabled = os.getenv('ENABLE_PROGRESS_REPORTING', 'true').lower() == 'true'
    
    def update(self, progress: int, message: str):
        """Send progress update"""
        if not self.enabled:
            return
        
        try:
            response = requests.post(
                f"{self.api_url}/api/v1/analysis/{self.analysis_id}/progress",
                json={
                    'progress': progress,
                    'message': message
                },
                timeout=5
            )
            
            if response.status_code == 200:
                logger.debug(f"Progress update sent: {progress}% - {message}")
            else:
                logger.warning(f"Progress update failed: {response.status_code}")
                
        except Exception as e:
            logger.warning(f"Failed to send progress update: {str(e)}")
