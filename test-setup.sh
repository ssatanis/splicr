#!/bin/bash
# test-setup.sh

echo "Setting up SplicR test data..."

# 1. Install SRA toolkit
brew install sratoolkit

# 2. Create directory
mkdir -p ~/splicr-test-data
cd ~/splicr-test-data

# 3. Prefetch and dump to FASTQ (sratoolkit 3.x: no -N/-X; use --split-files -O only)
echo "Downloading control sample..."
prefetch SRR32320804
fasterq-dump SRR32320804 --split-files -O ./

echo "Downloading treatment sample..."
prefetch SRR32320801
fasterq-dump SRR32320801 --split-files -O ./

echo "Done! Files ready:"
ls -lh *.fastq 2>/dev/null || ls -lh
echo ""
echo "Upload these FASTQ files to SplicR (paired-end: use _1 and _2 as control/treatment or per your design):"
ls -1 *.fastq 2>/dev/null || true
