#!/bin/bash

# Build all Docker containers for SplicR analysis engine

set -e

echo "================================"
echo "Building SplicR Analysis Containers"
echo "================================"
echo ""

# Configuration
REGISTRY="${DOCKER_REGISTRY:-splicr}"
VERSION="${VERSION:-latest}"

# Build MAGeCK container
echo "Building MAGeCK container..."
docker build -t ${REGISTRY}/mageck:${VERSION} docker/mageck/
echo "✓ MAGeCK container built"
echo ""

# Build BAGEL2 container
echo "Building BAGEL2 container..."
docker build -t ${REGISTRY}/bagel2:${VERSION} docker/bagel2/
echo "✓ BAGEL2 container built"
echo ""

# Build DrugZ container
echo "Building DrugZ container..."
docker build -t ${REGISTRY}/drugz:${VERSION} docker/drugz/
echo "✓ DrugZ container built"
echo ""

# Build Visualization container
echo "Building Visualization container..."
docker build -t ${REGISTRY}/visualization:${VERSION} docker/visualization/
echo "✓ Visualization container built"
echo ""

echo "================================"
echo "All containers built successfully!"
echo "================================"
echo ""
echo "Built containers:"
echo "  - ${REGISTRY}/mageck:${VERSION}"
echo "  - ${REGISTRY}/bagel2:${VERSION}"
echo "  - ${REGISTRY}/drugz:${VERSION}"
echo "  - ${REGISTRY}/visualization:${VERSION}"
echo ""
echo "To push to registry:"
echo "  docker push ${REGISTRY}/mageck:${VERSION}"
echo "  docker push ${REGISTRY}/bagel2:${VERSION}"
echo "  docker push ${REGISTRY}/drugz:${VERSION}"
echo "  docker push ${REGISTRY}/visualization:${VERSION}"
