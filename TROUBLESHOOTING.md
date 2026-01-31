# SplicR Analysis Upload Fix

## Problem
You're seeing "Status: failed" on analyses with these 404 errors in the browser console:
```
analysis_activity?select=*&analysis_id=eq...  Failed to load resource: 404
analysis_comments?select=*&analysis_id=eq...  Failed to load resource: 404
activity_logs?select=*&resource_type=eq...   Failed to load resource: 404
```

## Root Cause
The database is missing several required tables that the frontend tries to query.

## Solution

### Step 1: Run Database Migrations

1. Open your Supabase dashboard: https://supabase.com/dashboard/project/bxfrhmvkylipqdtoehii
2. Click **SQL Editor** in the left sidebar
3. Open the file `supabase/combined_migration.sql` in this project
4. Copy the entire contents
5. Paste into the SQL Editor
6. Click **RUN**

This creates these tables:
- ✅ `profiles` - User profiles and settings
- ✅ `analyses` - Core analysis table with proper schema
- ✅ `analysis_shares` - Sharing and collaboration
- ✅ `analysis_comments` - Comments system
- ✅ `analysis_activity` - Activity tracking
- ✅ `activity_logs` - General logging
- ✅ `comment_reactions` - Emoji reactions

### Step 2: Verify Tables Exist

After running the migration, verify the tables in Supabase:

1. Go to **Table Editor** in your Supabase dashboard
2. You should see all the tables listed above
3. The 404 errors should disappear

### Step 3: Test the Upload Flow

1. Make sure your dev server is running:
   ```bash
   cd frontend
   npm run dev
   ```

2. Navigate to http://localhost:3000/upload

3. Upload a FASTQ file:
   - Select an sgRNA library (e.g., Brunello)
   - Upload test files
   - Label samples (at least 1 control + 1 treatment)
   - Select analysis algorithm (MAGeCK recommended)
   - Click "Start Analysis"

4. You should be redirected to the results page showing:
   - Progress bar updating in real-time
   - Status changing from "pending" → "running" → "complete"
   - Analysis logs showing each step

### Step 4: Verify Analysis Works

The analysis should complete with:
- ✅ Status: "complete"
- ✅ Progress: 100%
- ✅ Results visible in all tabs (Overview, Volcano Plot, etc.)
- ✅ No 404 errors in browser console

## How the Analysis Pipeline Works

1. **File Upload** (`/upload`)
   - Files upload directly to Cloudflare R2 (no backend needed)
   - Creates analysis record in Supabase with status "pending"

2. **Analysis Creation** (`/api/analysis/create`)
   - Creates analysis in database
   - Calls `/api/analysis/{id}/run` to start processing

3. **Processing** (`/api/analysis/{id}/run`)
   - Simulates CRISPR analysis pipeline
   - Updates progress in real-time (5% → 10% → 20% → ... → 100%)
   - Generates realistic results (depleted/enriched genes)
   - Updates status to "complete"

4. **Results Display** (`/results/{id}`)
   - Polls every 3 seconds while status is "running"
   - Shows progress bar
   - Displays results when complete

## Common Issues

### Issue: Analysis stays at "pending" or "failed"

**Cause**: The dev server wasn't running when you created the analysis

**Fix**:
1. Make sure `npm run dev` is running in the `frontend/` directory
2. On the results page, click the **Retry** button
3. This will re-run the analysis pipeline

### Issue: Still seeing 404 errors after migration

**Cause**: Migration didn't run successfully

**Fix**:
1. Check Supabase SQL Editor for any errors
2. Try running each migration file separately:
   - `000_initial_schema.sql`
   - `001_analysis_shares.sql`
   - `002_collaboration_tables.sql`

### Issue: Files upload but analysis immediately fails

**Cause**: `NEXT_PUBLIC_APP_URL` is not set or dev server is not running

**Fix**:
1. Verify `frontend/.env.local` has:
   ```
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```
2. Restart the dev server:
   ```bash
   cd frontend
   npm run dev
   ```

## Realtime Progress Tracking

The analysis pipeline now includes:
- ✅ Real-time progress updates (every step updates the database)
- ✅ Progress bar showing percentage complete
- ✅ Current step description
- ✅ Detailed logs for each step
- ✅ Automatic polling every 3 seconds while running

Progress steps:
1. Initializing pipeline (5%)
2. Validating files (10%)
3. Loading sgRNA library (15%)
4. Aligning reads (20%)
5. Counting sgRNAs (30%)
6. Quality control (40%)
7. Normalizing counts (50%)
8. Running algorithms (55-85%)
9. Computing statistics (90%)
10. Complete (100%)

## Next Steps

Once the migrations are complete and you verify the flow works:

1. ✅ Upload a test analysis
2. ✅ Verify progress tracking works
3. ✅ Check that results display correctly
4. ✅ Test commenting and collaboration features
5. ✅ Export results in various formats

## Need Help?

If you're still experiencing issues after following this guide:

1. Check the browser console for errors (F12 → Console)
2. Check the Next.js server logs in your terminal
3. Verify all tables exist in Supabase Table Editor
4. Make sure the dev server is running on port 3000
