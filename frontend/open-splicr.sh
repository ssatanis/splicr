#!/bin/bash
# Helper script to open SplicR app (bypasses Gatekeeper for ad-hoc signed apps)

echo "🚀 Opening SplicR..."
echo ""

# Determine architecture
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  APP_PATH="dist/mac-arm64/SplicR.app"
  ARCH_NAME="Apple Silicon"
else
  APP_PATH="dist/mac/SplicR.app"
  ARCH_NAME="Intel"
fi

# Check if app exists
if [ ! -d "$APP_PATH" ]; then
  # Try the other architecture
  if [ "$ARCH" = "arm64" ]; then
    APP_PATH="dist/mac/SplicR.app"
    ARCH_NAME="Intel (Rosetta)"
  else
    APP_PATH="dist/mac-arm64/SplicR.app"
    ARCH_NAME="Apple Silicon"
  fi
fi

if [ ! -d "$APP_PATH" ]; then
  echo "❌ SplicR.app not found!"
  echo "   Please run 'npm run build:electron:mac' first"
  exit 1
fi

echo "📍 Opening: $APP_PATH ($ARCH_NAME)"
echo ""

# Try to open the app
open "$APP_PATH" 2>/dev/null

if [ $? -ne 0 ]; then
  echo "⚠️  macOS Gatekeeper blocked the app"
  echo ""
  echo "To open SplicR, use one of these methods:"
  echo ""
  echo "Method 1 (Easiest):"
  echo "  1. In Finder, navigate to: $APP_PATH"
  echo "  2. Right-click (or Control+click) on SplicR.app"
  echo "  3. Choose 'Open' from the menu"
  echo "  4. Click 'Open' in the security dialog"
  echo ""
  echo "Method 2 (System Settings):"
  echo "  1. Try opening the app normally (it will be blocked)"
  echo "  2. Go to: System Settings > Privacy & Security"
  echo "  3. Click 'Open Anyway' next to the SplicR message"
  echo ""
  echo "Method 3 (Command Line):"
  echo "  Run: open '$APP_PATH'"
  echo ""
  exit 1
fi

echo "✅ SplicR should open shortly!"
echo ""
echo "Note: If you see a security warning, right-click the app and choose 'Open'"
echo ""
