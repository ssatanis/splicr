-- Enable Realtime for analyses table so the results page can show live progress
-- when the worker updates status, progress, current_step, and logs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'analyses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.analyses;
  END IF;
END $$;
