#!/bin/bash

# Test analysis engine locally

set -e

echo "================================"
echo "Testing SplicR Analysis Engine Locally"
echo "================================"
echo ""

# Configuration
ANALYSIS_ID="test-$(date +%s)"
S3_BUCKET="${S3_BUCKET:-splicr-data-dev}"

echo "Analysis ID: ${ANALYSIS_ID}"
echo "S3 Bucket: ${S3_BUCKET}"
echo ""

# Test MAGeCK container
echo "Testing MAGeCK container..."
docker run --rm \
    -e AWS_ACCESS_KEY_ID \
    -e AWS_SECRET_ACCESS_KEY \
    -e AWS_REGION \
    splicr/mageck:latest \
    --analysis-id ${ANALYSIS_ID} \
    --file-keys "test/sample1.fastq.gz,test/sample2.fastq.gz" \
    --library "libraries/brunello.txt" \
    --s3-bucket ${S3_BUCKET} \
    --treatment "treatment1,treatment2" \
    --control "control1,control2" \
    --region us-east-1

echo "✓ MAGeCK test complete"
echo ""

# Test Visualization container
echo "Testing Visualization container..."
docker run --rm \
    -e AWS_ACCESS_KEY_ID \
    -e AWS_SECRET_ACCESS_KEY \
    -e AWS_REGION \
    splicr/visualization:latest \
    --analysis-id ${ANALYSIS_ID} \
    --s3-bucket ${S3_BUCKET} \
    --algorithm mageck

echo "✓ Visualization test complete"
echo ""

echo "================================"
echo "All tests passed!"
echo "================================"
