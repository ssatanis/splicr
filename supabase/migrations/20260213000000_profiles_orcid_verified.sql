-- Add orcid_verified to profiles if missing (for ORCID verification in settings)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'orcid_verified') THEN
      ALTER TABLE public.profiles ADD COLUMN orcid_verified boolean DEFAULT false;
    END IF;
  END IF;
END $$;
