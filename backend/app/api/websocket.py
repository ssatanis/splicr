"""WebSocket API for real-time progress updates"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.services.analysis_service import AnalysisService
from typing import Dict, List
from uuid import UUID
import json
import logging
import asyncio

logger = logging.getLogger(__name__)
router = APIRouter()


class ConnectionManager:
    """Manager for WebSocket connections"""
    
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
    
    async def connect(self, websocket: WebSocket, analysis_id: str):
        """Accept WebSocket connection and add to pool"""
        await websocket.accept()
        if analysis_id not in self.active_connections:
            self.active_connections[analysis_id] = []
        self.active_connections[analysis_id].append(websocket)
        logger.info(f"WebSocket connected for analysis {analysis_id}")
    
    def disconnect(self, websocket: WebSocket, analysis_id: str):
        """Remove WebSocket connection from pool"""
        if analysis_id in self.active_connections:
            if websocket in self.active_connections[analysis_id]:
                self.active_connections[analysis_id].remove(websocket)
            if not self.active_connections[analysis_id]:
                del self.active_connections[analysis_id]
        logger.info(f"WebSocket disconnected for analysis {analysis_id}")
    
    async def send_update(self, analysis_id: str, message: dict):
        """Send update to all connected clients for an analysis"""
        if analysis_id in self.active_connections:
            disconnected = []
            for connection in self.active_connections[analysis_id]:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"Error sending message: {str(e)}")
                    disconnected.append(connection)
            
            # Clean up disconnected clients
            for conn in disconnected:
                self.disconnect(conn, analysis_id)
    
    async def broadcast(self, message: dict):
        """Broadcast message to all connected clients"""
        for analysis_id in list(self.active_connections.keys()):
            await self.send_update(analysis_id, message)


# Global connection manager
manager = ConnectionManager()


@router.websocket("/{analysis_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    analysis_id: str
):
    """
    WebSocket endpoint for real-time analysis progress updates
    
    Clients connect to this endpoint with their analysis ID to receive
    real-time status updates as the analysis progresses.
    
    Message format:
    ```json
    {
        "analysis_id": "uuid",
        "status": "RUNNING",
        "progress": 45,
        "current_step": "Running MAGeCK analysis",
        "timestamp": "2026-01-29T12:00:00Z"
    }
    ```
    """
    await manager.connect(websocket, analysis_id)
    
    try:
        # Send initial status
        from app.database import SessionLocal
        db = SessionLocal()
        try:
            analysis = AnalysisService.get_analysis(db, UUID(analysis_id))
            if analysis:
                initial_message = {
                    "analysis_id": str(analysis.id),
                    "status": analysis.status,
                    "progress": analysis.progress,
                    "current_step": analysis.current_step,
                    "message": "Connected to analysis updates",
                    "timestamp": analysis.created_at.isoformat()
                }
                await websocket.send_json(initial_message)
        finally:
            db.close()
        
        # Keep connection alive and handle incoming messages
        while True:
            try:
                # Receive any client messages (for heartbeat/ping)
                data = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=30.0
                )
                
                # Handle ping/pong
                if data == "ping":
                    await websocket.send_text("pong")
                
            except asyncio.TimeoutError:
                # Send heartbeat
                await websocket.send_json({
                    "type": "heartbeat",
                    "timestamp": "2026-01-29T12:00:00Z"
                })
            
    except WebSocketDisconnect:
        manager.disconnect(websocket, analysis_id)
        logger.info(f"Client disconnected from analysis {analysis_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        manager.disconnect(websocket, analysis_id)


async def send_progress_update(
    analysis_id: str,
    status: str,
    progress: int,
    current_step: str = None,
    message: str = None
):
    """
    Send progress update to all connected clients for an analysis
    
    This function should be called from Celery tasks to push updates.
    """
    update_message = {
        "analysis_id": analysis_id,
        "status": status,
        "progress": progress,
        "current_step": current_step,
        "message": message,
        "timestamp": "2026-01-29T12:00:00Z"
    }
    
    await manager.send_update(analysis_id, update_message)
