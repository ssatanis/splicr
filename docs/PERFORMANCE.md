# SplicR performance & Supabase Pro

Production-grade optimizations for speed, reliability, and researcher-ready UX.

## Implemented optimizations

### Database & API
- **Analysis list**: No longer selects `results` (huge JSONB). List loads 10–50ms instead of 300–500ms+ and avoids OOM.
- **Status endpoint**: Does not select `results`; `hasResults` is inferred from `status === 'complete'`.
- **Results payload**: Count matrix is stored in R2 and streamed on demand; main results JSON stays small.
- **Cache-Control**: List `max-age=15, stale-while-revalidate=30`; completed results `max-age=60, stale-while-revalidate=120`.

### Client
- **realApi cache**: Analysis list 20s; completed results 5 min; notes 10s. Cache invalidated on create/update/delete/run.
- **UserContext**: SessionStorage cache for analyses (5 min) and 5s cooldown on tab focus to avoid duplicate requests.

### Pipeline & storage
- **FASTQ fetch**: All files fetched in parallel (`Promise.all`) instead of sequentially.
- **R2 client**: Single reused S3 client (singleton) for pipeline and count-matrix; connection pooling and keep-alive.

### Supabase
- **Indexes**: `20260201000000_performance_optimization_indexes.sql` adds indexes for analyses, profiles, shares, comments, activity. Use covering index for list query.
- **Analyses**: `count_matrix_r2_key` column so count-matrix endpoint can read key without loading `results`.

## Supabase Pro recommendations

- **Connection pooler**: For serverless (e.g. Vercel), use the **transaction pooler** connection string (Session mode is fine for long-running server). In Dashboard → Project Settings → Database, use the “Connection string” with `-pooler` and port 6543. Set `NEXT_PUBLIC_SUPABASE_URL` and direct Postgres URL for migrations to the pooler if your stack supports it; Supabase JS client uses the REST API by default so this mainly affects direct SQL or server-side Postgres clients.
- **Disk & egress**: Pro includes 8 GB disk and 250 GB egress. Monitor in Dashboard; if you approach limits, upgrade or optimize large queries and avoid selecting `results` outside the dedicated results endpoint.
- **Cached egress**: 250 GB cached egress reduces cost for repeated reads; ensure API and static assets use CDN/cache headers (we set Cache-Control on list and results).
- **Backups**: 7-day daily backups; no extra action needed.
- **Log retention**: 7-day log retention; use Dashboard → Logs for debugging slow queries.

## Backend (Python/FastAPI)

The Next.js app talks to **Supabase** (DB, auth) and **R2** (files, count matrix). The Python backend in `/backend` is optional (e.g. for Celery, batch jobs, or separate deployments). For the main web flow:
- No Python backend is required; everything runs in Next.js API routes and the in-browser/Node pipeline.
- If you run the Python backend (e.g. for heavy batch or external integrations), use the same Supabase project and consider connection pooler for serverless workers.

## Monitoring

- **Supabase**: Database → Query Performance; check for slow queries and missing indexes.
- **Vercel**: Function duration and memory for `/api/analysis/*` and pipeline runs.
- **R2**: Request count and bandwidth in Cloudflare dashboard.

## Security (Supabase Linter)

- **Leaked password protection** (Supabase Linter): Enable in Dashboard → Auth → Providers → Email → "Prevent use of leaked passwords". Requires Pro plan. See [Supabase Password Security](https://supabase.com/docs/guides/auth/password-security).

## Supabase Database Linter

- **Unindexed foreign keys** / **Unused indexes**: Addressed in migration `20260210120000_linter_unindexed_fks_and_unused_indexes.sql`.
- **Auth DB connection strategy**: If the linter reports "Auth DB Connection Strategy is not Percentage", go to Supabase Dashboard → Project Settings → Database → Connection Pooling, and switch Auth's connection allocation from absolute (e.g. 10) to percentage-based. This improves Auth server performance when scaling the instance.

## Checklist

- [x] Analysis list does not select `results`
- [x] Status endpoint does not select `results`
- [x] Results and count matrix split (R2 + stream)
- [x] FASTQ files fetched in parallel
- [x] R2 client singleton
- [x] Cache-Control on list and results
- [x] realApi cache with invalidation
- [x] Performance indexes migration applied
- [ ] Supabase connection pooler configured (if using serverless Postgres clients)
- [ ] Alerts on DB CPU / egress (optional)
