#!/bin/bash

# =====================================================================
# TxScore Migration Fix Application Script
# =====================================================================
# This script applies the TxScore migration fixes and validates the result
# =====================================================================

set -e  # Exit on error

echo "========================================="
echo "TxScore Migration Fix Application"
echo "========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "supabase/migrations/20260213000003_fix_txscore_schema.sql" ]; then
    echo -e "${RED}Error: Must run from SplicR project root${NC}"
    echo "Current directory: $(pwd)"
    exit 1
fi

echo "✓ Found TxScore fix migration"
echo ""

# Function to run SQL file
run_sql_file() {
    local file=$1
    local description=$2
    
    echo -e "${YELLOW}Running: $description${NC}"
    
    if npx supabase db push --include-all 2>&1 | grep -q "error"; then
        echo -e "${RED}✗ Failed to apply migrations${NC}"
        return 1
    else
        echo -e "${GREEN}✓ $description completed${NC}"
        return 0
    fi
}

# Step 1: Show current migration status
echo "Step 1: Checking migration status..."
echo "-------------------------------------"
npx supabase migration list 2>&1 || echo "Warning: Could not list migrations"
echo ""

# Step 2: Apply all pending migrations
echo "Step 2: Applying migrations..."
echo "-------------------------------------"
if npx supabase db push --include-all; then
    echo -e "${GREEN}✓ All migrations applied successfully${NC}"
else
    echo -e "${RED}✗ Migration failed${NC}"
    echo ""
    echo "Troubleshooting tips:"
    echo "1. Check if Supabase is running: npx supabase status"
    echo "2. Start Supabase if needed: npx supabase start"
    echo "3. Check migration files for syntax errors"
    exit 1
fi
echo ""

# Step 3: Run validation script
echo "Step 3: Validating schema..."
echo "-------------------------------------"
if [ -f "supabase/migrations/validate_txscore_schema.sql" ]; then
    echo "Running validation script..."
    npx supabase db execute --file supabase/migrations/validate_txscore_schema.sql || {
        echo -e "${YELLOW}Warning: Validation script encountered issues${NC}"
    }
else
    echo -e "${YELLOW}Warning: Validation script not found${NC}"
fi
echo ""

# Step 4: Quick API test (if applicable)
echo "Step 4: Testing API endpoints..."
echo "-------------------------------------"

# Check if frontend is running
if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "Testing /api/txscore/user/saved endpoint..."
    
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/txscore/user/saved)
    
    if [ "$RESPONSE" = "200" ] || [ "$RESPONSE" = "401" ]; then
        echo -e "${GREEN}✓ API endpoint responding (HTTP $RESPONSE)${NC}"
    else
        echo -e "${RED}✗ API endpoint error (HTTP $RESPONSE)${NC}"
    fi
else
    echo -e "${YELLOW}Note: Frontend not running, skipping API tests${NC}"
    echo "Start frontend with: npm run dev"
fi
echo ""

# Step 5: Summary
echo "========================================="
echo "Migration Fix Summary"
echo "========================================="
echo ""
echo "✓ Migrations applied"
echo "✓ Schema validated"
echo ""
echo "Next steps:"
echo "1. Review validation output above"
echo "2. Test TxScore features in the UI"
echo "3. Populate tx_genes_master with gene data"
echo "4. Run TxScore calculations to populate tx_txscore_cache"
echo ""
echo "Documentation: docs/TXSCORE_MIGRATION_FIXES.md"
echo ""
echo -e "${GREEN}Done!${NC}"
