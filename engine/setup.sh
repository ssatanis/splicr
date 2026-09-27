#!/usr/bin/env bash
# =============================================================================
# Builds the SplicR analysis environment.
#
#   bash engine/setup.sh
#
# Installs micromamba locally (no system package manager needed), creates the
# pinned environment from environment.yml, and clones BAGEL2, which is not on
# bioconda. Everything lands under engine/.tools and is gitignored.
#
# Re-running is safe: existing pieces are left alone.
# =============================================================================
set -euo pipefail

ENGINE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS="$ENGINE/.tools"
ENV_DIR="$TOOLS/env"
export MAMBA_ROOT_PREFIX="$TOOLS/mamba"

log() { printf '\033[36m%s\033[0m\n' "$*"; }

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLATFORM=osx-arm64 ;;
  Darwin-x86_64) PLATFORM=osx-64 ;;
  Linux-aarch64) PLATFORM=linux-aarch64 ;;
  Linux-x86_64) PLATFORM=linux-64 ;;
  *) echo "Unsupported platform: $(uname -s)-$(uname -m)"; exit 1 ;;
esac

mkdir -p "$TOOLS"

# --- micromamba -------------------------------------------------------------
if [ ! -x "$TOOLS/bin/micromamba" ]; then
  log "Installing micromamba ($PLATFORM)"
  curl -fsSL "https://micro.mamba.pm/api/micromamba/$PLATFORM/latest" \
    | tar -xj -C "$TOOLS" bin/micromamba
fi
MAMBA="$TOOLS/bin/micromamba"

# --- environment ------------------------------------------------------------
if [ ! -x "$ENV_DIR/bin/mageck" ]; then
  log "Creating the analysis environment. This takes a few minutes."
  "$MAMBA" create -y -p "$ENV_DIR" -f "$ENGINE/environment.yml"
else
  log "Environment already present at $ENV_DIR"
fi

# --- BAGEL2 -----------------------------------------------------------------
if [ ! -f "$TOOLS/bagel2/BAGEL.py" ]; then
  log "Cloning BAGEL2 (not on bioconda)"
  git clone --depth 1 -q https://github.com/hart-lab/bagel.git "$TOOLS/bagel2"
fi

# --- verify -----------------------------------------------------------------
log ""
log "Verifying every tool actually runs"
export PATH="$ENV_DIR/bin:$PATH"

check() {
  printf '  %-12s ' "$1"
  if out=$(eval "$2" 2>&1 | head -1); then echo "$out"; else echo "FAILED"; return 1; fi
}

check mageck   "mageck -v"
check bowtie   "bowtie --version | head -1"
check cutadapt "cutadapt --version"
check fastp    "fastp --version"
check seqkit   "seqkit version"
check samtools "samtools --version | head -1"
check python   "python -V"
check numpy    "python -c 'import numpy; print(numpy.__version__)'"
check bagel2   "python $TOOLS/bagel2/BAGEL.py version | sed -n 2p"

log ""
log "Ready. MAGeCK shells out to RRA by bare name, so always put the"
log "environment on PATH rather than calling binaries by absolute path:"
log ""
log "  export PATH=\"$ENV_DIR/bin:\$PATH\""
log ""
log "Smoke test (needs reference data):  python engine/tests/smoke_test.py"
