"""
Configuration loader for CRISPR Confidence Score
"""
import os
import yaml
from pathlib import Path
from typing import Dict, Any

# Project Root
PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()

def load_config(config_path: str = "configs/config.yaml") -> Dict[str, Any]:
    """Load configuration from YAML file."""
    full_path = PROJECT_ROOT / config_path
    if not full_path.exists():
        raise FileNotFoundError(f"Config file not found: {full_path}")
    
    with open(full_path, "r") as f:
        config = yaml.safe_load(f)
    
    # Resolve paths to absolute
    paths = config.get("paths", {})
    for key, rel_path in paths.items():
        paths[key] = (PROJECT_ROOT / rel_path).resolve()
    
    # Override storage with env vars if present
    storage = config.get("storage", {})
    if os.environ.get("S3_BUCKET_NAME"):
        storage["bucket_name"] = os.environ["S3_BUCKET_NAME"]
    if os.environ.get("AWS_REGION"):
        storage["region"] = os.environ["AWS_REGION"]
    
    config["project_root"] = PROJECT_ROOT
    return config

# Global config object (lazy loaded)
_config = None

def get_config() -> Dict[str, Any]:
    """Get the global configuration object."""
    global _config
    if _config is None:
        _config = load_config()
    return _config
