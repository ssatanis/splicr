#!/usr/bin/env bash
# hg38 plus a faidx index, which validate/genome.py seeks into.
#
# Kept uncompressed (3.1 GB): random access then needs nothing but the .fai,
# where a bgzip-compressed copy would need a BGZF reader for the same thing.
set -euo pipefail
DIR="${SPLICR_GENOME_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/data/references/genome}"
mkdir -p "$DIR"; cd "$DIR"
if [ ! -f hg38.fa ]; then
  echo "Downloading hg38 (~950 MB compressed)"
  curl -fSL --retry 5 -C - -o hg38.fa.gz https://hgdownload.soe.ucsc.edu/goldenPath/hg38/bigZips/hg38.fa.gz
  gunzip -c hg38.fa.gz > hg38.fa
fi
ENV_BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/engine/.tools/env/bin"
[ -f hg38.fa.fai ] || "$ENV_BIN/samtools" faidx hg38.fa
echo "ready: $DIR/hg38.fa ($(wc -c < hg38.fa) bytes) + .fai"
