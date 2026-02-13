
#!/bin/bash
# Setup script for Off-Target Analysis Tools
# run with: bash scripts/setup-offtarget-tools.sh

echo "Setting up Off-Target Analysis Tools..."
echo "----------------------------------------"

# 1. Check for Conda
if ! command -v conda &> /dev/null; then
    echo "❌ Conda is not installed. Please install Miniconda or Anaconda first to use CRISPRitz."
    echo "   See: https://docs.conda.io/en/latest/miniconda.html"
else
    echo "✅ Conda found."
    
    # 2. Install CRISPRitz
    echo "Checking CRISPRitz..."
    if ! command -v crispitz &> /dev/null; then
        echo "Installing CRISPRitz via Bioconda..."
        conda install -y -c bioconda crispitz
    else
        echo "✅ CRISPRitz is already installed."
    fi
fi

# 3. Install Python dependencies (CRISPR-Net)
echo "----------------------------------------"
echo "Checking Python dependencies..."

if ! command -v pip &> /dev/null; then
    echo "❌ Pip is not available."
else
    echo "Installing CRISPR-Net..."
    pip install crisprnet tensorflow
fi

# 4. Create directory for genome index
echo "----------------------------------------"
INDEX_DIR="./data/genomes/GRCh38"
mkdir -p $INDEX_DIR
echo "Created genome index directory: $INDEX_DIR"
echo "⚠️  NOTE: You must download GRCh38.fa manually to $INDEX_DIR and run 'crispitz index-genome' before using prediction."

echo "----------------------------------------"
echo "Setup complete! (Dependencies installed)"
