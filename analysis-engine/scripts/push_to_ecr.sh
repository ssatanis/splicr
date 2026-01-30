#!/bin/bash

# Push Docker containers to AWS ECR

set -e

# Configuration
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID}"
AWS_REGION="${AWS_REGION:-us-east-1}"
VERSION="${VERSION:-latest}"

if [ -z "$AWS_ACCOUNT_ID" ]; then
    echo "Error: AWS_ACCOUNT_ID environment variable not set"
    exit 1
fi

ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

echo "================================"
echo "Pushing Containers to AWS ECR"
echo "================================"
echo ""
echo "Registry: ${ECR_REGISTRY}"
echo "Region: ${AWS_REGION}"
echo ""

# Login to ECR
echo "Logging in to ECR..."
aws ecr get-login-password --region ${AWS_REGION} | \
    docker login --username AWS --password-stdin ${ECR_REGISTRY}
echo "✓ Logged in to ECR"
echo ""

# Create repositories if they don't exist
for repo in mageck bagel2 drugz visualization; do
    echo "Checking repository: ${repo}"
    aws ecr describe-repositories --repository-names splicr/${repo} --region ${AWS_REGION} 2>/dev/null || \
        aws ecr create-repository --repository-name splicr/${repo} --region ${AWS_REGION}
done
echo ""

# Tag and push containers
for container in mageck bagel2 drugz visualization; do
    echo "Pushing splicr/${container}:${VERSION}..."
    
    docker tag splicr/${container}:${VERSION} ${ECR_REGISTRY}/splicr/${container}:${VERSION}
    docker push ${ECR_REGISTRY}/splicr/${container}:${VERSION}
    
    echo "✓ Pushed ${container}"
    echo ""
done

echo "================================"
echo "All containers pushed successfully!"
echo "================================"
echo ""
echo "Container URIs:"
echo "  - ${ECR_REGISTRY}/splicr/mageck:${VERSION}"
echo "  - ${ECR_REGISTRY}/splicr/bagel2:${VERSION}"
echo "  - ${ECR_REGISTRY}/splicr/drugz:${VERSION}"
echo "  - ${ECR_REGISTRY}/splicr/visualization:${VERSION}"
