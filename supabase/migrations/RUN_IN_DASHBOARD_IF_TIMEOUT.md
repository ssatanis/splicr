# If migration times out (Connection timeout)

**Easiest:** From the project root run:
```bash
npm run ensure-share-columns
```
This uses `DATABASE_URL` from `frontend/.env.local` and adds the missing columns. Requires `pg` (installed as devDependency).

**Or** run the SQL in **Supabase Dashboard**:

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project.
2. Go to **SQL Editor**.
3. Paste and run **one of these**:

**Option A – Minimal (only fixes Share error):**
```sql
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS is_link_share BOOLEAN NOT NULL DEFAULT false;
```

**Option B – Full migration:**  
1. Open `20260201120000_ensure_analysis_shares_is_link_share.sql`, copy its contents, paste in SQL Editor, then Run.  
2. Then open `20260201130000_fix_analysis_shares_unique_constraint.sql`, copy its contents, paste in SQL Editor, then Run (allows multiple collaborators per analysis).

**Or** from project root: `npm run ensure-share-columns` (applies both column and constraint fixes).

After running, reload the schema cache if needed: **Settings → API → Reload schema cache** (or wait a few seconds).
