#!/usr/bin/env bash
# =============================================================================
# SplicR reference data downloader
#
# Fetches every public dataset the engine needs into data/references/.
# Everything here is free to download; see docs/04-data-sources.md for the
# licence of each one. Re-running skips files that are already present.
#
#   bash scripts/data/download.sh            core set (about 2 GB)
#   bash scripts/data/download.sh --all      adds DepMap guide-level (about 8 GB)
#   bash scripts/data/download.sh --list     print what would be fetched
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST="${SPLICR_REFERENCE_DIR:-$ROOT/data/references}"
ALL=0
LIST=0
for arg in "$@"; do
  case "$arg" in
    --all)  ALL=1 ;;
    --list) LIST=1 ;;
  esac
done

UA="SplicR/0.1 (https://splicr.org; research data download)"
ok=0; skip=0; fail=0
declare -a FAILED=()

log()  { printf '\033[36m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
err()  { printf '\033[31m%s\033[0m\n' "$*"; }

# fetch <url> <relative/path> [description]
fetch() {
  local url="$1" rel="$2" desc="${3:-}"
  local out="$DEST/$rel"
  if [ "$LIST" = 1 ]; then printf '  %-52s %s\n' "$rel" "$url"; return; fi
  if [ -s "$out" ]; then skip=$((skip+1)); printf '  = %s\n' "$rel"; return; fi
  mkdir -p "$(dirname "$out")"
  printf '  . %s %s\n' "$rel" "${desc:+($desc)}"
  if curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 30 -A "$UA" "$url" -o "$out.part"; then
    # Guard against rate-limit bodies served with a 200 status.
    local size; size=$(wc -c < "$out.part" | tr -d ' ')
    if [ "$size" -lt 200 ] && grep -qiE 'error code|rate limit|access denied|<html' "$out.part" 2>/dev/null; then
      err "  ! $rel looks like an error page (${size}B), discarding"
      rm -f "$out.part"; FAILED+=("$rel"); fail=$((fail+1)); return
    fi
    mv "$out.part" "$out"
    ok=$((ok+1))
  else
    err "  ! failed: $rel"
    rm -f "$out.part"; FAILED+=("$rel"); fail=$((fail+1))
  fi
}

log "SplicR reference data -> $DEST"
mkdir -p "$DEST"

# -----------------------------------------------------------------------------
log ""
log "1. Gene annotation"
# HGNC moved off the EBI FTP to Google Cloud Storage. CC0.
fetch "https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/hgnc_complete_set.txt" \
      "annotation/hgnc_complete_set.txt" "HGNC complete set, CC0"
fetch "https://storage.googleapis.com/public-download-files/hcop/human_mouse_hcop_fifteen_column.txt.gz" \
      "annotation/human_mouse_hcop.txt.gz" "human-mouse orthology"
fetch "https://ftp.ncbi.nlm.nih.gov/gene/DATA/GENE_INFO/Mammalia/Homo_sapiens.gene_info.gz" \
      "annotation/Homo_sapiens.gene_info.gz" "NCBI gene_info human"
fetch "https://ftp.ncbi.nlm.nih.gov/gene/DATA/GENE_INFO/Mammalia/Mus_musculus.gene_info.gz" \
      "annotation/Mus_musculus.gene_info.gz" "NCBI gene_info mouse"
fetch "https://ftp.ensembl.org/pub/release-116/gtf/homo_sapiens/Homo_sapiens.GRCh38.116.chr.gtf.gz" \
      "annotation/Homo_sapiens.GRCh38.116.chr.gtf.gz" "Ensembl 116 GRCh38"
fetch "https://ftp.ensembl.org/pub/release-116/gtf/mus_musculus/Mus_musculus.GRCm39.116.chr.gtf.gz" \
      "annotation/Mus_musculus.GRCm39.116.chr.gtf.gz" "Ensembl 116 GRCm39"

# -----------------------------------------------------------------------------
log ""
log "2. Reference gene sets (Hart lab, for QC and BAGEL2)"
BAGEL_RAW="https://raw.githubusercontent.com/hart-lab/bagel/master"
fetch "$BAGEL_RAW/CEGv2.txt"     "genesets/CEGv2.txt"     "684 core essentials"
fetch "$BAGEL_RAW/NEGv1.txt"     "genesets/NEGv1.txt"     "927 nonessentials"
fetch "$BAGEL_RAW/CEG_mouse.txt" "genesets/CEG_mouse.txt" "mouse essentials"
fetch "$BAGEL_RAW/NEG_mouse.txt" "genesets/NEG_mouse.txt" "mouse nonessentials"

# -----------------------------------------------------------------------------
log ""
log "3. Cell line identity"
fetch "https://ftp.expasy.org/databases/cellosaurus/cellosaurus.txt" \
      "cells/cellosaurus.txt" "Cellosaurus, CC BY 4.0"
fetch "https://cog.sanger.ac.uk/cmp/download/model_list_latest.csv.gz" \
      "cells/sanger_model_list.csv.gz" "Cell Model Passports"

# -----------------------------------------------------------------------------
log ""
log "4. Pooled libraries (Addgene / Broad GPP)"
warn "   Addgene terms forbid redistribution. These stay local; never ship them."
warn "   Several files use bare CR line endings. Normalize before parsing."
GPP="https://media.addgene.org/cms/filer_public"
fetch "$GPP/8b/4c/8b4c89d9-eac1-44b2-bb2f-8fea95672705/broadgpp-brunello-library-contents.txt" \
      "libraries/brunello.txt" "Brunello, 77441 rows"
fetch "$GPP/be/cd/becdf7c4-ea7a-41a3-96c9-ef2bc3c85979/broadgpp-brie-library-contents.txt" \
      "libraries/brie.txt" "Brie mouse, 78637 rows"
fetch "$GPP/5c/ca/5cca8516-45a7-4d83-bfb2-d960c4ab9de5/broadgpp-brie-library-controls.csv" \
      "libraries/brie-controls.csv" "Brie controls, 1000"
fetch "$GPP/6b/e5/6be5752a-9a48-4d38-bfbc-4c2d68dbeb50/broadgpp-gattinara-library-contents.txt" \
      "libraries/gattinara.txt" "Gattinara, 40964 rows"
fetch "$GPP/f3/b7/f3b7e10c-a814-492d-9124-9a1df68444a5/broadgpp-calabrese-targets-seta.txt" \
      "libraries/calabrese-a.txt" "Calabrese A, CRISPRa"
fetch "$GPP/7b/85/7b85b5d1-d4d3-40e9-b074-be8beda6b12e/broadgpp-calabrese-targets-setb.txt" \
      "libraries/calabrese-b.txt" "Calabrese B, CRISPRa"
fetch "$GPP/1c/59/1c59fe51-ef6e-44bf-963a-598edadcd66f/broadgpp-dolcetto-targets-seta.txt" \
      "libraries/dolcetto-a.txt" "Dolcetto A, CRISPRi"
fetch "$GPP/6c/51/6c510ea5-f3e2-4b6e-824e-913157682b73/broadgpp-dolcetto-targets-setb.txt" \
      "libraries/dolcetto-b.txt" "Dolcetto B, CRISPRi"
fetch "$GPP/a4/b8/a4b8d181-c489-4dd7-823a-fe267fd7b277/human_geckov2_library_a_09mar2015.csv" \
      "libraries/geckov2-a.csv" "GeCKOv2 A, 65383 rows"
fetch "$GPP/2d/8b/2d8baa42-f5c8-4b63-9c6c-bd98f333b29e/human_geckov2_library_b_09mar2015.csv" \
      "libraries/geckov2-b.csv" "GeCKOv2 B, 58028 rows"
fetch "$GPP/71/a8/71a81179-7a62-4d75-9b53-236e6f6b7d4d/tkov3_guide_sequence.xlsx" \
      "libraries/tkov3.xlsx" "TKOv3, xlsx only"

# -----------------------------------------------------------------------------
log ""
log "5. Open Targets 26.09 evidence (CC0)"
OT="https://ftp.ebi.ac.uk/pub/databases/opentargets/platform/26.09/output"
fetch "$OT/evidence_crispr/part-00000-c28c692e-da84-48f4-9c5a-a0edd0ee988c-c000.zstd.parquet" \
      "opentargets/evidence_crispr.parquet" "Project Score, 517 rows"
fetch "$OT/evidence_crispr_screen/part-00000-9ca5473c-e030-4207-ba1a-8e991c2a9845-c000.zstd.parquet" \
      "opentargets/evidence_crispr_screen.parquet" "CRISPRbrain, 21640 rows"

# -----------------------------------------------------------------------------
if [ "$ALL" = 1 ]; then
  log ""
  log "6. BioGRID ORCS 2.0.18 (MIT). 718 MB, single attempt, no resume."
  warn "   This host rate-limits with a 17-byte body. The guard below catches it."
  ORCS="https://downloads.thebiogrid.org/Download/BioGRID-ORCS/Release-Archive/BIOGRID-ORCS-2.0.18"
  fetch "$ORCS/BIOGRID-ORCS-ALL-homo_sapiens-2.0.18.screens.tar.gz" \
        "orcs/orcs-human-2.0.18.screens.tar.gz" "2217 screens, 718 MB"
  fetch "$ORCS/BIOGRID-ORCS-ALL-mus_musculus-2.0.18.screens.tar.gz" \
        "orcs/orcs-mouse-2.0.18.screens.tar.gz" "mouse, 57 MB"

  log ""
  log "7. DepMap (CC BY 4.0). Large files, --all only."
  warn "   24Q4 is the newest complete release on Figshare; later ones are portal only,"
  warn "   and the portal answers 200 with a Cloudflare challenge page. Set"
  warn "   DEPMAP_FIGSHARE_ID from https://depmap.org/portal/data_page/?tab=allData."
  if [ -n "${DEPMAP_FIGSHARE_ID:-}" ]; then
    api="https://api.figshare.com/v2/articles/$DEPMAP_FIGSHARE_ID/files?page_size=500"
    log "   listing $api"
    curl -fsSL "$api" -o "$DEST/depmap/_files.json" --create-dirs && \
    python3 - "$DEST" <<'PY'
import json, sys, os, urllib.request
dest = sys.argv[1]
want = {
  "CRISPRGeneEffect.csv", "CRISPRGeneDependency.csv",
  "CRISPRInferredCommonEssentials.csv", "AchillesCommonEssentialControls.csv",
  "AchillesNonessentialControls.csv", "Model.csv", "OmicsCNGene.csv",
  "AvanaGuideMap.csv", "KYGuideMap.csv", "HumagneGuideMap.csv",
  "ScreenSequenceMap.csv", "CRISPRScreenMap.csv",
}
files = json.load(open(os.path.join(dest, "depmap", "_files.json")))
for f in files:
    if f["name"] not in want:
        continue
    out = os.path.join(dest, "depmap", f["name"])
    if os.path.exists(out) and os.path.getsize(out) > 0:
        print("  =", f["name"]); continue
    print("  .", f["name"], f"{f['size']/1e6:.0f} MB")
    urllib.request.urlretrieve(f["download_url"], out)
PY
  fi
fi

# -----------------------------------------------------------------------------
if [ "$LIST" = 1 ]; then exit 0; fi

log ""
log "Done. $ok downloaded, $skip already present, $fail failed."
if [ ${#FAILED[@]} -gt 0 ]; then
  warn "Failed:"
  for f in "${FAILED[@]}"; do warn "  $f"; done
  warn "Some hosts rate-limit or move files. See docs/04-data-sources.md for alternatives."
fi
du -sh "$DEST" 2>/dev/null || true
