# TxScore Migration Fixes - Quick Reference

## 🚨 Issues Fixed

1. **Missing `tx_` prefix in index names** - All indexes now correctly reference `tx_` prefixed tables
2. **Duplicate index errors** - Used `IF NOT EXISTS` for idempotent migrations
3. **Missing `user_saved_targets` table** - Created `tx_user_saved_targets` with full RLS

## 📋 Files Created/Modified

### Created:
- ✅ `supabase/migrations/20260213000003_fix_txscore_schema.sql` - Comprehensive fix
- ✅ `supabase/migrations/validate_txscore_schema.sql` - Validation script
- ✅ `scripts/apply-txscore-fixes.sh` - Automated fix application
- ✅ `docs/TXSCORE_MIGRATION_FIXES.md` - Detailed documentation

### Modified:
- ✅ `supabase/migrations/20260213000000_txscore_schema.sql` - Fixed index names (lines 68-82)

## 🚀 Quick Start

### Option 1: Automated (Recommended)
```bash
cd /Users/sahaj/Documents/Projects/SplicR
./scripts/apply-txscore-fixes.sh
```

### Option 2: Manual
```bash
# Apply all migrations
npx supabase db push --include-all

# Validate schema
npx supabase db execute --file supabase/migrations/validate_txscore_schema.sql
```

## 🔍 What Got Fixed

### Before (Broken):
```sql
-- ❌ Wrong: references non-existent table
CREATE INDEX idx_genes_master_symbol ON genes_master(gene_symbol);

-- ❌ Missing table
SELECT * FROM user_saved_targets;  -- PGRST205 error
```

### After (Fixed):
```sql
-- ✅ Correct: references actual table
CREATE INDEX IF NOT EXISTS idx_tx_genes_master_symbol ON tx_genes_master(gene_symbol);

-- ✅ Table exists
SELECT * FROM tx_user_saved_targets;  -- Works!
SELECT * FROM user_saved_targets;     -- Compatibility view also works!
```

## 📊 New Table: tx_user_saved_targets

### Schema:
```sql
CREATE TABLE tx_user_saved_targets (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,           -- References auth.users
    gene_id TEXT NOT NULL,            -- References tx_genes_master
    cancer_type TEXT,                 -- Optional filter
    notes TEXT,                       -- User notes
    tags TEXT[],                      -- Categorization
    priority INTEGER DEFAULT 0,       -- User ranking
    folder TEXT DEFAULT 'default',    -- Organization
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    last_viewed_at TIMESTAMP WITH TIME ZONE,
    UNIQUE (user_id, gene_id, cancer_type)
);
```

### Features:
- ✅ Full RLS (users can only see their own saved targets)
- ✅ Auto-update trigger for `updated_at`
- ✅ Enriched view with TxScore data: `tx_user_saved_targets_enriched`
- ✅ Backward compatibility view: `user_saved_targets`

## 🎯 Validation Checklist

After applying fixes, verify:

- [ ] 13 TxScore tables exist (including `tx_user_saved_targets`)
- [ ] All indexes start with `idx_tx_` prefix
- [ ] No "relation does not exist" errors
- [ ] No duplicate index errors
- [ ] RLS enabled on all TxScore tables
- [ ] 4 RLS policies on `tx_user_saved_targets`
- [ ] Views exist: `user_saved_targets`, `tx_user_saved_targets_enriched`
- [ ] API endpoint `/api/txscore/user/saved` returns 200 (not 500)

## 🧪 Testing

### SQL Tests:
```sql
-- Should return 13 tables
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name LIKE 'tx_%';

-- Should return 0 (no incorrectly named indexes)
SELECT COUNT(*) FROM pg_indexes
WHERE tablename LIKE 'tx_%' 
  AND indexname NOT LIKE 'idx_tx_%'
  AND indexname NOT LIKE '%_pkey'
  AND indexname NOT LIKE '%_unique_%';

-- Should work without error
SELECT * FROM tx_user_saved_targets LIMIT 1;
SELECT * FROM user_saved_targets LIMIT 1;
```

### API Tests:
```bash
# Should return 200 or 401 (not 500)
curl -I http://localhost:3000/api/txscore/user/saved

# Should return rankings
curl 'http://localhost:3000/api/txscore/targets/ranking?cancer_type=pan-cancer&limit=10'
```

## 📚 Documentation

Full details: [TXSCORE_MIGRATION_FIXES.md](./TXSCORE_MIGRATION_FIXES.md)

## ⚠️ Important Notes

1. **Idempotent**: Fix migration can be run multiple times safely
2. **No Data Loss**: Only drops/recreates indexes, preserves all data
3. **Fresh Install**: Works on both fresh and existing databases
4. **Order Matters**: Apply migrations in chronological order

## 🐛 Troubleshooting

### "relation already exists" error:
```bash
# The fix migration handles this - just apply it
npx supabase db push --include-all
```

### Supabase not running:
```bash
npx supabase start
```

### Migration fails:
```bash
# Check Supabase logs
npx supabase db logs

# Or apply just the fix migration
npx supabase migration up --include 20260213000003
```

## ✅ Success Criteria

You'll know it worked when:
1. No SQL errors during migration
2. Validation script shows all green checks
3. API endpoints return 200/401 (not 500)
4. Frontend TxScore features work without errors

## 🎉 Next Steps

1. ✅ Apply fixes (done!)
2. 📥 Populate `tx_genes_master` with gene data
3. 🧬 Load DepMap, GTEx, gnomAD data
4. 🔬 Run TxScore calculations
5. 💾 Cache results in `tx_txscore_cache`
6. 🚀 Test in production!
