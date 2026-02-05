# SplicR Deployment Checklist — Redis + Worker + MAGeCK

For analyses to complete (MAGeCK, BAGEL2, DrugZ), the **worker** must run the pipeline. Vercel serverless times out on long runs.

## 1. Upstash Redis (splicr-queue)

Set these **on both Vercel and Railway**:

```
UPSTASH_REDIS_REST_URL=https://striking-wallaby-46693.upstash.io
UPSTASH_REDIS_REST_TOKEN=<your-token>
```

## 2. Vercel (API)

| Variable | Required |
|----------|----------|
| `UPSTASH_REDIS_REST_URL` | Yes |
| `UPSTASH_REDIS_REST_TOKEN` | Yes |
| `RUN_ANALYSIS_INLINE` | **false** (or unset) |
| `R2_*`, `SUPABASE_*` | Yes (already set) |

## 3. Railway (Worker)

| Variable | Required |
|----------|----------|
| `UPSTASH_REDIS_REST_URL` | Yes |
| `UPSTASH_REDIS_REST_TOKEN` | Yes |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes |
| `R2_ENDPOINT` | Yes |
| `R2_ACCESS_KEY_ID` | Yes |
| `R2_SECRET_ACCESS_KEY` | Yes |
| `R2_BUCKET_NAME` | Yes (e.g. `splicr-fastq-files`) |

## 4. Stuck analysis at 5%?

1. Ensure `RUN_ANALYSIS_INLINE=false` on Vercel
2. Ensure Railway worker is deployed and running
3. On the results page, wait ~3 min — a **Retry** button will appear
4. Click **Retry** to re-queue
