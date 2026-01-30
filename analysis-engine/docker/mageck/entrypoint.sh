#!/bin/bash
set -e

echo "================================"
echo "SplicR MAGeCK Analysis Container"
echo "================================"
echo ""

# Run MAGeCK analysis
python3 /analysis/run_mageck.py "$@"

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✓ MAGeCK analysis completed successfully"
else
    echo ""
    echo "✗ MAGeCK analysis failed with exit code $EXIT_CODE"
fi

exit $EXIT_CODE
