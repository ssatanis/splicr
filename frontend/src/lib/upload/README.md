# Upload + Dedup Architecture (SplicR)

## Summary

- **Dedup**: Before uploading, the client computes a content hash (SHA-256: full for files ≤50MB, size+first/last 5MB for larger). It calls `POST /api/upload/check` with `{ hash, fileName, size, contentType }`. If the backend finds a row in `sequencing_files` for that hash, it returns `{ exists: true, key }` and the client skips upload and shows "reused from cloud storage". Otherwise the client uploads (proxy for <100MB, multipart for ≥100MB) and the backend registers the file in Postgres on complete.
- **Global dedup**: One row per `file_hash` in `sequencing_files`; first upload wins. Concurrent uploads of the same content both complete; the second gets the same canonical key from the table. Access control is enforced at app level (e.g. who can start analysis with which keys).

## Flow (bullets)

1. User selects files → for each file the client computes `hash` (see `lib/storage/file-hash.ts`).
2. `POST /api/upload/check` with `{ hash, fileName, size, contentType }` → `200 { exists: true, key }` or `{ exists: false }`.
3. If `exists`: add file to list with `key`, set progress 100%, show "reused from cloud storage".
4. If not:  
   - &lt;100MB: `POST /api/upload/proxy` (FormData: file, userId, hash) → R2 PutObject, then upsert `sequencing_files` (on conflict do nothing), return key.  
   - ≥100MB: `POST /api/upload/multipart/create` → uploadId, key; upload parts in parallel (presigned URLs); `POST /api/upload/multipart/complete` with `key, uploadId, parts, fileHash, fileName, size, contentType` → R2 complete, then upsert `sequencing_files`, return canonical key.
5. All upload APIs require Supabase auth; only authenticated users can check/upload/register.

## Environment variables

- `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` (Cloudflare R2).
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (Supabase; service role used for `sequencing_files` in API routes).

## Part size and concurrency

- **Part size**: 100MB (`LARGE_PART_SIZE` in `lib/storage/r2-upload.ts`). Fewer, larger parts reduce request count; R2 supports up to 5GB per part.
- **Parallelism**: 4 parts at a time (`PARALLEL_UPLOADS`). Increase for faster uploads on good links; decrease if you hit rate limits or memory.

To tune: edit `LARGE_PART_SIZE` and `PARALLEL_UPLOADS` in `frontend/lib/storage/r2-upload.ts`.

## Database

Run the migration that creates `sequencing_files`:

- From Supabase dashboard: SQL Editor → run `supabase/migrations/20250130100000_sequencing_files_dedup.sql`.
- Or CLI: `supabase db push` (if using Supabase CLI).
