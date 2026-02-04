-- Part 9: Analysis hash for uniqueness / deduplication
-- Hash is derived from file inputs and parameters so identical inputs produce the same hash.

ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS analysis_hash TEXT;

-- Function to generate analysis hash from file_names, library, and parameters
CREATE OR REPLACE FUNCTION public.generate_analysis_hash()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.analysis_hash := md5(
    COALESCE(array_to_string(NEW.file_names, '|'), '') ||
    COALESCE(NEW.library, '') ||
    COALESCE(NEW.parameters::text, '')
  );
  RETURN NEW;
END;
$$;

-- Trigger to set hash before insert (and update, so re-runs keep same hash for same inputs)
DROP TRIGGER IF EXISTS set_analysis_hash ON public.analyses;
CREATE TRIGGER set_analysis_hash
  BEFORE INSERT OR UPDATE ON public.analyses
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_analysis_hash();

-- Backfill existing rows
UPDATE public.analyses
SET analysis_hash = md5(
  COALESCE(array_to_string(file_names, '|'), '') ||
  COALESCE(library, '') ||
  COALESCE(parameters::text, '')
)
WHERE analysis_hash IS NULL;

-- Index for lookups (e.g. "same input already run?")
CREATE INDEX IF NOT EXISTS idx_analyses_analysis_hash ON public.analyses(analysis_hash);

COMMENT ON COLUMN public.analyses.analysis_hash IS 'MD5 of file_names + library + parameters; used for deduplication and ensuring each screen is unique.';
