#!/usr/bin/env bash
# Lindel (Chen et al., NAR 2019), MIT licence, pinned to one commit so a
# prediction stays attributable. Vendored rather than pip-installed: the repo
# has no release, and repair.py loads its weights directly.
set -euo pipefail
COMMIT=fdcad580ba76bcfb7a98f58c3769b76f31693d63
DIR="${SPLICR_LINDEL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/engine/.tools/lindel}"
mkdir -p "$DIR"; cd "$DIR"
BASE="https://raw.githubusercontent.com/shendurelab/Lindel/$COMMIT"
for f in Lindel/Predictor.py Lindel/__init__.py Lindel/Model_weights.pkl Lindel/model_prereq.pkl LICENSE; do
  curl -fSL --retry 5 -o "$(basename "$f")" "$BASE/$f"
done
echo "$COMMIT" > COMMIT
echo "ready: $DIR (Lindel @ $COMMIT, MIT)"
