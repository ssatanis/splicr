#!/usr/bin/env bash
# BioGRID ORCS is a 718 MB archive behind Cloudflare. The host does not honour
# Range, so a truncated transfer cannot resume: each attempt restarts.
# This retries until the gzip stream validates, or gives up after N tries.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST="${SPLICR_REFERENCE_DIR:-$ROOT/data/references}/orcs"
BASE="https://downloads.thebiogrid.org/Download/BioGRID-ORCS/Release-Archive/BIOGRID-ORCS-2.0.18"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
ATTEMPTS="${ORCS_ATTEMPTS:-6}"
mkdir -p "$DEST"

grab() {
  local species="$1" out="$DEST/orcs-$2.tar.gz"
  if [ -s "$out" ] && gzip -t "$out" 2>/dev/null; then
    echo "= $2 already complete ($(du -h "$out" | cut -f1))"; return 0
  fi
  for i in $(seq 1 "$ATTEMPTS"); do
    echo ". $2 attempt $i/$ATTEMPTS"
    curl -fL --http1.1 --connect-timeout 60 --max-time 3600 \
         --speed-time 120 --speed-limit 10240 \
         -A "$UA" -H "Referer: https://downloads.thebiogrid.org/BioGRID-ORCS" \
         "$BASE/BIOGRID-ORCS-ALL-$species-2.0.18.screens.tar.gz" -o "$out.part" -s
    if gzip -t "$out.part" 2>/dev/null; then
      mv "$out.part" "$out"
      echo "+ $2 ok: $(du -h "$out" | cut -f1), $(tar -tzf "$out" | wc -l | tr -d ' ') files"
      return 0
    fi
    echo "  truncated ($(du -h "$out.part" 2>/dev/null | cut -f1)), waiting 60s"
    rm -f "$out.part"; sleep 60
  done
  echo "! $2 failed after $ATTEMPTS attempts. Download in a browser from:"
  echo "  $BASE/BIOGRID-ORCS-ALL-$species-2.0.18.screens.tar.gz"
  return 1
}

grab "saccharomyces_cerevisiae_S288C" "yeast"
grab "drosophila_melanogaster" "fly"
grab "chlorocebus_sabaeus" "green-monkey"
grab "mus_musculus" "mouse"
grab "homo_sapiens" "human"
