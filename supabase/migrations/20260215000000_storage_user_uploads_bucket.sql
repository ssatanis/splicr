-- Create storage bucket for user uploads (avatars, etc.)
-- Enables profile picture upload and other user-uploaded files.
-- Run this in Supabase SQL Editor if migrations don't have storage schema, or create
-- the bucket manually in Dashboard: Storage > New bucket > id: user-uploads, Public: ON.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'user-uploads') THEN
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('user-uploads', 'user-uploads', true);
    END IF;
  END IF;
END $$;

-- Drop existing policies if re-running (idempotent)
DROP POLICY IF EXISTS "Users can upload avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own avatars" ON storage.objects;
DROP POLICY IF EXISTS "Public read user-uploads" ON storage.objects;

-- Allow authenticated users to upload to avatars/ (profile pictures)
CREATE POLICY "Users can upload avatars"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'user-uploads'
  AND (storage.foldername(name))[1] = 'avatars'
);

-- Allow users to update their uploads in avatars/
CREATE POLICY "Users can update own avatars"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'user-uploads' AND (storage.foldername(name))[1] = 'avatars')
WITH CHECK (bucket_id = 'user-uploads' AND (storage.foldername(name))[1] = 'avatars');

-- Allow users to delete their uploads in avatars/
CREATE POLICY "Users can delete own avatars"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'user-uploads' AND (storage.foldername(name))[1] = 'avatars');

-- Public read for public bucket
CREATE POLICY "Public read user-uploads"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'user-uploads');
