#!/bin/bash
# Fix script for Electron macOS crash issues

set -e

echo "🔧 Fixing Electron macOS crash issues..."
echo ""

# Step 1: Remove old builds
echo "Step 1: Cleaning old build artifacts..."
rm -rf dist out .next node_modules/.cache
echo "✓ Cleaned build artifacts"
echo ""

# Step 2: Remove quarantine attributes from existing app
echo "Step 2: Removing quarantine attributes..."
if [ -d "dist/mac/SplicR.app" ]; then
  xattr -cr dist/mac/SplicR.app
  echo "✓ Fixed dist/mac/SplicR.app"
elif [ -d "dist/mac-arm64/SplicR.app" ]; then
  xattr -cr dist/mac-arm64/SplicR.app
  echo "✓ Fixed dist/mac-arm64/SplicR.app"
fi

# Also fix the installed app if it exists
if [ -d "/Applications/SplicR.app" ]; then
  echo "Found SplicR.app in Applications folder"
  xattr -cr /Applications/SplicR.app
  echo "✓ Fixed /Applications/SplicR.app"
fi
echo ""

# Step 3: Kill any running instances
echo "Step 3: Stopping any running instances..."
pkill -f "SplicR" || true
echo "✓ Stopped running instances"
echo ""

echo "✅ Fixes applied!"
echo ""
echo "Next steps:"
echo "1. Run: npm run build:electron:mac"
echo "2. Open the app from: dist/mac-arm64/SplicR.app"
echo ""
echo "Or install from Applications:"
echo "  open -a /Applications/SplicR.app"
