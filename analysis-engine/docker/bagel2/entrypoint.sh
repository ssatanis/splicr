#!/bin/bash
set -e

echo "================================"
echo "SplicR BAGEL2 Analysis Container"
echo "================================"
echo ""

# Run BAGEL2 analysis
python3 /analysis/run_bagel2.py "$@"

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✓ BAGEL2 analysis completed successfully"
else
    echo ""
    echo "✗ BAGEL2 analysis failed with exit code $EXIT_CODE"
fi

exit $EXIT_CODE
