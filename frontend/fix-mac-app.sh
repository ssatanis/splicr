#!/bin/bash
# Script to fix macOS Gatekeeper issues for locally built SplicR app

echo "🔧 Fixing macOS Gatekeeper for SplicR app..."

# Find the app in dist directory
if [ -f "dist/mac/SplicR.app/Contents/MacOS/SplicR" ]; then
  APP_PATH="dist/mac/SplicR.app"
  echo "Found app at: $APP_PATH"
elif [ -f "dist/mac-arm64/SplicR.app/Contents/MacOS/SplicR" ]; then
  APP_PATH="dist/mac-arm64/SplicR.app"
  echo "Found app at: $APP_PATH"
else
  echo "❌ SplicR.app not found in dist directory"
  echo "   Please run 'npm run build:electron:mac' first"
  exit 1
fi

# Remove quarantine attribute
echo "Removing quarantine attribute..."
sudo xattr -cr "$APP_PATH"

# Allow unsigned apps to run
echo "Disabling Gatekeeper check for this app..."
sudo spctl --add "$APP_PATH"
sudo spctl --enable

echo ""
echo "✅ Done! You should now be able to open SplicR.app"
echo ""
echo "If you still see an error, try one of these options:"
echo ""
echo "Option 1: Right-click the app and choose 'Open'"
echo "Option 2: Run this command:"
echo "   xattr -cr '$APP_PATH' && open '$APP_PATH'"
echo ""
