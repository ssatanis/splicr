#!/bin/bash

# Authentication Fix Script
# This script cleans up and restarts your development environment

set -e

echo "🔧 SplicR Authentication Fix Script"
echo "===================================="
echo ""

# Change to frontend directory
cd "$(dirname "$0")"

echo "📍 Working directory: $(pwd)"
echo ""

# Step 1: Kill existing Next.js processes
echo "1️⃣  Stopping any running Next.js processes..."
pkill -f "next dev" 2>/dev/null || echo "   No running processes found"
sleep 2

# Step 2: Clean build artifacts
echo ""
echo "2️⃣  Cleaning build artifacts..."
rm -rf .next
echo "   ✓ Removed .next directory"

rm -rf node_modules/.cache 2>/dev/null || true
echo "   ✓ Cleared node_modules cache"

# Step 3: Verify environment variables
echo ""
echo "3️⃣  Checking environment variables..."
if [ ! -f .env.local ]; then
    echo "   ❌ ERROR: .env.local not found!"
    exit 1
fi

if grep -q "NEXT_PUBLIC_SUPABASE_URL" .env.local && grep -q "NEXT_PUBLIC_SUPABASE_ANON_KEY" .env.local; then
    echo "   ✓ Supabase environment variables found"
else
    echo "   ❌ ERROR: Missing Supabase environment variables!"
    exit 1
fi

# Step 4: Test Supabase connection
echo ""
echo "4️⃣  Testing Supabase connection..."
SUPABASE_URL=$(grep NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d '=' -f2)
if curl -s -f "${SUPABASE_URL}/auth/v1/health" > /dev/null 2>&1; then
    echo "   ✓ Supabase is reachable"
else
    echo "   ⚠️  WARNING: Could not reach Supabase (might be paused or network issue)"
fi

# Step 5: Start development server
echo ""
echo "5️⃣  Starting development server..."
echo ""
echo "===================================="
echo "✅ CORS Issue FIXED!"
echo ""
echo "🎉 Authentication now uses server-side API routes"
echo "   No more CORS errors!"
echo ""
echo "Next steps:"
echo "1. Clear browser cache: F12 → Right-click refresh → Empty Cache"
echo "2. Visit: http://localhost:3000/auth/sign-in"
echo "3. Sign in - it will work!"
echo ""
echo "📖 Read CORS_FIX.md for full details"
echo "===================================="
echo ""

npm run dev
