# Database Setup Guide

## Quick Start

Follow these steps to set up the TEA and TxScore database tables in Supabase:

### Step 1: Open Supabase SQL Editor
1. Go to your Supabase project dashboard
2. Click on "SQL Editor" in the left sidebar
3. Click "New query"

### Step 2: Create TEA Analyses Table
1. Copy the entire contents of `supabase/migrations/create_tea_analyses.sql`
2. Paste into the SQL Editor
3. Click "Run" or press Ctrl/Cmd + Enter
4. Verify success: You should see "Success. No rows returned"

### Step 3: Create TxScore Analyses Table
1. Copy the entire contents of `supabase/migrations/create_txscore_analyses.sql`
2. Paste into the SQL Editor
3. Click "Run" or press Ctrl/Cmd + Enter
4. Verify success: You should see "Success. No rows returned"

### Step 4: Verify Tables Created
Run this query to check:
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('tea_analyses', 'txscore_analyses');
```

You should see both tables listed.

### Step 5: Test ID Generation
```sql
SELECT generate_tea_id();
SELECT generate_txscore_id();
```

Each should return a unique ID in the format:
- TEA: `TEA-1708041600-ABC12345`
- TxScore: `TXS-1708041600-ABC12345`

### Step 6: Verify RLS Policies
```sql
SELECT schemaname, tablename, policyname 
FROM pg_policies 
WHERE tablename IN ('tea_analyses', 'txscore_analyses');
```

You should see 4 policies per table (SELECT, INSERT, UPDATE, DELETE).

## What Gets Created

### tea_analyses Table
- 27 fields for comprehensive TEA analysis data
- Stores sequence data, variant information, analysis results
- Includes external data integration (DepMap, GTEx, etc.)
- Full-text search capability on gene symbols

### txscore_analyses Table  
- 18 fields for gene list ranking and scoring
- Array support for gene lists
- JSON fields for flexible result storage
- Analytics views for dashboards

### Security Features
- **Row Level Security (RLS)** enabled on both tables
- Users can only access their own analyses
- Automatic user_id validation on insert/update
- Secure function execution

### Performance Optimizations
- Indexes on frequently queried columns
- GIN index on gene_list array
- Composite indexes for common queries
- Automatic timestamp updates

## Testing

### Insert Test Data for TEA
```sql
INSERT INTO tea_analyses (
  id, report_id, user_id, name, sequence, sequence_length,
  sequence_source, gene_symbol, tissue, status
) VALUES (
  generate_tea_id(),
  generate_tea_id(),
  auth.uid(),
  'Test BRCA1 Analysis',
  'ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG',
  44,
  'manual',
  'BRCA1',
  'liver',
  'complete'
);
```

### Insert Test Data for TxScore
```sql
INSERT INTO txscore_analyses (
  id, user_id, name, gene_list, gene_count,
  gene_source, status, average_tvs, top_target
) VALUES (
  generate_txscore_id(),
  auth.uid(),
  'Test Gene List',
  ARRAY['TP53', 'BRCA1', 'EGFR', 'KRAS', 'MYC'],
  5,
  'manual',
  'complete',
  72.5,
  'TP53'
);
```

### Query Your Data
```sql
-- View all your TEA analyses
SELECT * FROM tea_analyses WHERE user_id = auth.uid();

-- View all your TxScore analyses
SELECT * FROM txscore_analyses WHERE user_id = auth.uid();

-- Use summary views
SELECT * FROM tea_analyses_summary WHERE user_id = auth.uid();
SELECT * FROM txscore_analyses_summary WHERE user_id = auth.uid();
```

## Troubleshooting

### Error: "permission denied for table tea_analyses"
**Solution:** RLS policies are working correctly. You need to be authenticated. Run queries in the Supabase SQL Editor or ensure you're logged in via the API.

### Error: "function generate_tea_id() does not exist"
**Solution:** The function creation failed. Re-run the SQL script from the function definition onwards.

### Error: "relation tea_analyses already exists"
**Solution:** Table already created. You can:
- Skip to the next step
- Drop and recreate: `DROP TABLE tea_analyses CASCADE;` (⚠️ deletes all data)

### Slow Queries
**Solution:** Check if indexes were created:
```sql
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename IN ('tea_analyses', 'txscore_analyses');
```

## Maintenance

### Backup Recommendations
- Enable Supabase automatic backups (Project Settings → Database → Backups)
- Consider Point-in-Time Recovery (PITR) for production
- Export critical analyses regularly

### Monitoring
```sql
-- Check table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE tablename IN ('tea_analyses', 'txscore_analyses');

-- Check row counts
SELECT 
  'tea_analyses' as table_name,
  count(*) as row_count
FROM tea_analyses
UNION ALL
SELECT 
  'txscore_analyses',
  count(*)
FROM txscore_analyses;
```

### Archival (Optional)
For large datasets, consider archiving old analyses:
```sql
-- Archive completed analyses older than 1 year
CREATE TABLE tea_analyses_archive (LIKE tea_analyses INCLUDING ALL);

INSERT INTO tea_analyses_archive
SELECT * FROM tea_analyses
WHERE status = 'complete' 
  AND created_at < NOW() - INTERVAL '1 year';

-- Delete archived records from main table
DELETE FROM tea_analyses
WHERE id IN (SELECT id FROM tea_analyses_archive);
```

## Next Steps

1. ✅ Run SQL scripts in Supabase
2. ✅ Test with sample data
3. ✅ Verify RLS policies
4. 🔄 Deploy frontend changes (already pushed to Vercel)
5. 🔄 Test full workflow: Upload → Analyze → Results
6. 📊 Set up monitoring and alerts
7. 🎨 Customize dashboards in Supabase

## Support

If you encounter issues:
1. Check Supabase logs (Project → Logs)
2. Verify environment variables in Vercel
3. Test API endpoints manually
4. Review DEPLOYMENT_SUCCESS.md for troubleshooting

---

**Database Status:** Ready for Production ✅  
**Created:** February 14, 2026  
**Version:** 1.0.0
