#!/bin/bash
# Script to fix macOS Gatekeeper issues for locally built SplicR app

echo "🔧 Fixing macOS Gatekeeper for SplicR app..."
echo ""

# Function to fix a single app
fix_app() {
  local APP_PATH=$1
  echo "Processing: $APP_PATH"
  
  # Remove quarantine attribute
  echo "  → Removing quarantine attribute..."
  xattr -cr "$APP_PATH" 2>/dev/null || true
  xattr -d com.apple.quarantine "$APP_PATH" 2>/dev/null || true
  
  # Apply ad-hoc signature (required for macOS 15+)
  echo "  → Applying ad-hoc code signature..."
  codesign --force --deep --sign - "$APP_PATH"
  
  if [ $? -eq 0 ]; then
    echo "  ✓ Successfully fixed: $APP_PATH"
    return 0
  else
    echo "  ✗ Failed to fix: $APP_PATH"
    return 1
  fi
}

# Find and fix all apps
FIXED=0

if [ -d "dist/mac/SplicR.app" ]; then
  if fix_app "dist/mac/SplicR.app"; then
    FIXED=$((FIXED + 1))
  fi
  echo ""
fi

if [ -d "dist/mac-arm64/SplicR.app" ]; then
  if fix_app "dist/mac-arm64/SplicR.app"; then
    FIXED=$((FIXED + 1))
  fi
  echo ""
fi

if [ $FIXED -eq 0 ]; then
  echo "❌ No apps found in dist directory"
  echo "   Please run 'npm run build:electron:mac' first"
  exit 1
fi

echo "✅ Fixed $FIXED app(s)! You should now be able to open SplicR.app"
echo ""
echo "To open the app:"
echo "  Intel Mac:      open dist/mac/SplicR.app"
echo "  Apple Silicon:  open dist/mac-arm64/SplicR.app"
echo ""
