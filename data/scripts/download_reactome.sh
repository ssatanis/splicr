#!/bin/bash
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
RAW_DIR="$SCRIPT_DIR/../raw"
PROCESSED_DIR="$SCRIPT_DIR/../processed"

mkdir -p "$PROCESSED_DIR" "$RAW_DIR"

echo "Downloading Reactome pathways..."
curl -o "$RAW_DIR/UniProt2Reactome.txt" "https://reactome.org/download/current/UniProt2Reactome.txt"

echo "✓ Reactome download complete"
echo "File saved: $RAW_DIR/UniProt2Reactome.txt"
