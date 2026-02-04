# Profile Avatar Upload Setup

Profile pictures are stored in Supabase Storage. If you see **"Bucket not found"** when uploading, create the bucket and policies as below.

## Option 1: Run the migration (recommended)

From the project root:

```bash
supabase db push
# or apply the migration file in Supabase Dashboard > SQL Editor
```

Migration file: `supabase/migrations/20260215000000_storage_user_uploads_bucket.sql`

## Option 2: Create bucket manually in Supabase Dashboard

1. Open **Supabase Dashboard** → **Storage**.
2. Click **New bucket**.
3. Set **Name** to `user-uploads`.
4. Enable **Public bucket** (so profile photo URLs work without signed links).
5. Optional: set **File size limit** to 5 MB and **Allowed MIME types** to `image/jpeg`, `image/png`, `image/gif`, `image/webp`.
6. Create the bucket.
7. Go to **Policies** for the bucket and add:
   - **INSERT**: Allow authenticated users (e.g. policy name "Users can upload avatars", check `bucket_id = 'user-uploads'` and folder `avatars`).
   - **SELECT**: Allow public read so profile photos load.
   - **UPDATE/DELETE**: Allow authenticated for their uploads if you want remove/replace.

After the bucket exists, profile upload in **Settings → Profile** will work. The photo appears in the **top-right user menu** and on your **public profile** when you share it.
