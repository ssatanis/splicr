# CRISPR Confidence Score Infrastructure

This directory contains the backend infrastructure for the CRISPR Confidence Score (CCS) project.

## Directory Structure
```
SplicR/
├── configs/          # Configuration files
│   └── config.yaml   # Main configuration
├── data/
│   ├── raw/          # Original downloaded files (e.g., STRING, Reactome)
│   ├── processed/    # Processed JSON/tables
│   ├── external/     # Third-party datasets (DepMap, BAGEL2)
│   └── scripts/      # Data management scripts
├── models/           # Trained ML models
├── scripts/          # Utility scripts (bootstrap, maintenance)
├── src/
│   └── crispr_confidence/
│       ├── config.py # Configuration loader
│       └── storage.py# Cloud storage abstraction
└── tests/            # Test suite
```

## Configuration
The system is configured via `configs/config.yaml`.
- **Paths**: Define locations for data varieties.
- **Storage**: Configure Cloudflare R2 or S3-compatible backend.
- **Resources**: Filenames for specific datasets.

## Environment Variables
The following environment variables are required for cloud storage:
- `R2_ENDPOINT_URL`: The S3-compatible endpoint URL.
- `AWS_ACCESS_KEY_ID`: Your access key.
- `AWS_SECRET_ACCESS_KEY`: Your secret key.
- `S3_BUCKET_NAME`: The target bucket name.
- `AWS_REGION`: Region (default: "auto").

## Scripts

### Bootstrap Environment
Validates raw data, creates directory structure, and syncs processed artifacts from cloud storage.
```bash
python scripts/bootstrap_environment.py
```

### Download Databases
Downloads original datasets from source and uploads to cloud storage.
```bash
python data/scripts/download_databases.py
```

## Documentation
- [Reference Data & Libraries](docs/reference_data.md)

