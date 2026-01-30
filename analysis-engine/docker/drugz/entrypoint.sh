#!/bin/bash
set -e

echo "================================"
echo "SplicR DrugZ Analysis Container"
echo "================================"
echo ""

# Run DrugZ analysis
python3 /analysis/run_drugz.py "$@"

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✓ DrugZ analysis completed successfully"
else
    echo ""
    echo "✗ DrugZ analysis failed with exit code $EXIT_CODE"
fi

exit $EXIT_CODE
