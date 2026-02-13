#!/bin/bash
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
RAW_DIR="$SCRIPT_DIR/../raw"
PROCESSED_DIR="$SCRIPT_DIR/../processed"

mkdir -p "$PROCESSED_DIR" "$RAW_DIR"

echo "Downloading KEGG pathways..."
curl -o "$RAW_DIR/kegg_pathways_list.txt" "https://rest.kegg.jp/list/pathway/hsa"

python3 - <<'PYTHON'
import os
import requests
import json
from pathlib import Path

raw_dir = Path(os.environ['RAW_DIR'])
processed_dir = Path(os.environ['PROCESSED_DIR'])

with open(raw_dir / 'kegg_pathways_list.txt') as f:
    pathways = f.read().strip().split('\n')

pathway_data = {}
for line in pathways:
    parts = line.split('\t')
    pathway_id = parts[0]
    pathway_name = parts[1] if len(parts) > 1 else "Unknown"
    
    # Get genes
    try:
        response = requests.get(f'https://rest.kegg.jp/link/genes/{pathway_id}')
        if response.status_code == 200 and response.text.strip():
            genes = [g.split('\t')[1] for g in response.text.strip().split('\n')]
            pathway_data[pathway_id] = {
                'name': pathway_name,
                'genes': genes
            }
    except Exception as e:
        print(f"Error fetching {pathway_id}: {e}")

with open(processed_dir / 'kegg_pathways.json', 'w') as f:
    json.dump(pathway_data, f, indent=2)

print(f"✓ Saved {len(pathway_data)} pathways")
PYTHON

echo "✓ KEGG download complete"
