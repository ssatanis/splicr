-- Lab Invite Codes Migration
-- Adds invite_code field to labs table with generation and regeneration functions

-- ============================================================================
-- 1. CREATE INVITE CODE GENERATION FUNCTION
-- ============================================================================
-- Generates a random 6-character alphanumeric code
-- Excludes ambiguous characters: 0/O, 1/I/l for better readability
CREATE OR REPLACE FUNCTION generate_invite_code()
RETURNS VARCHAR(6) AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 33 chars (removed 0,O,1,I)
  result VARCHAR(6) := '';
  i INT;
  max_attempts INT := 100;
  attempt INT := 0;
  code_exists BOOLEAN;
BEGIN
  -- Try to generate a unique code (with retry logic for collision prevention)
  LOOP
    result := '';

    -- Generate 6 random characters
    FOR i IN 1..6 LOOP
      result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;

    -- Check if code already exists
    SELECT EXISTS(SELECT 1 FROM public.labs WHERE invite_code = result) INTO code_exists;

    -- Exit if unique or max attempts reached
    EXIT WHEN NOT code_exists OR attempt >= max_attempts;

    attempt := attempt + 1;
  END LOOP;

  -- If we couldn't generate a unique code after max attempts, raise error
  IF code_exists THEN
    RAISE EXCEPTION 'Unable to generate unique invite code after % attempts', max_attempts;
  END IF;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2. ADD INVITE_CODE COLUMN TO LABS TABLE
-- ============================================================================
-- Add invite_code column (initially nullable for backfill)
ALTER TABLE public.labs
ADD COLUMN IF NOT EXISTS invite_code VARCHAR(6);

-- ============================================================================
-- 3. BACKFILL EXISTING LABS WITH INVITE CODES
-- ============================================================================
-- Generate invite codes for any existing labs that don't have one
DO $$
DECLARE
  lab_record RECORD;
BEGIN
  FOR lab_record IN SELECT id FROM public.labs WHERE invite_code IS NULL LOOP
    UPDATE public.labs
    SET invite_code = generate_invite_code()
    WHERE id = lab_record.id;
  END LOOP;
END $$;

-- ============================================================================
-- 4. ADD CONSTRAINTS
-- ============================================================================
-- Now that all labs have codes, make it NOT NULL and UNIQUE
ALTER TABLE public.labs
ALTER COLUMN invite_code SET NOT NULL;

ALTER TABLE public.labs
ADD CONSTRAINT labs_invite_code_unique UNIQUE (invite_code);

-- ============================================================================
-- 5. CREATE TRIGGER FOR AUTO-GENERATION ON INSERT
-- ============================================================================
-- Automatically generate invite code when creating a new lab
CREATE OR REPLACE FUNCTION set_lab_invite_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invite_code IS NULL THEN
    NEW.invite_code := generate_invite_code();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it exists (for idempotency)
DROP TRIGGER IF EXISTS trigger_set_lab_invite_code ON public.labs;

-- Create trigger
CREATE TRIGGER trigger_set_lab_invite_code
BEFORE INSERT ON public.labs
FOR EACH ROW
EXECUTE FUNCTION set_lab_invite_code();

-- ============================================================================
-- 6. CREATE REGENERATE FUNCTION (FOR PI/ADMIN USE)
-- ============================================================================
-- Function to regenerate invite code for a specific lab
-- This will be called from the API with proper authorization checks
CREATE OR REPLACE FUNCTION regenerate_lab_invite_code(lab_id_param UUID)
RETURNS VARCHAR(6) AS $$
DECLARE
  new_code VARCHAR(6);
BEGIN
  -- Generate new unique code
  new_code := generate_invite_code();

  -- Update the lab
  UPDATE public.labs
  SET invite_code = new_code,
      updated_at = NOW()
  WHERE id = lab_id_param;

  -- Return the new code
  RETURN new_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 7. CREATE INDEX FOR FAST LOOKUPS
-- ============================================================================
-- Index for fast invite code lookups (used during join operations)
CREATE INDEX IF NOT EXISTS idx_labs_invite_code
ON public.labs(invite_code);

-- ============================================================================
-- 8. ADD HELPFUL COMMENT
-- ============================================================================
COMMENT ON COLUMN public.labs.invite_code IS
'Unique 6-character alphanumeric invite code for joining lab. Excludes ambiguous characters (0/O/1/I/l).';

-- ============================================================================
-- 9. ADD ROW LEVEL SECURITY POLICIES
-- ============================================================================
-- Enable RLS on labs table if not already enabled
ALTER TABLE public.labs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view labs they're members of
DROP POLICY IF EXISTS "Users can view their lab" ON public.labs;
CREATE POLICY "Users can view their lab"
  ON public.labs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.lab_members
      WHERE lab_members.lab_id = labs.id
      AND lab_members.user_id = auth.uid()
    )
  );

-- Policy: Only PI can update lab details (name, institution, etc.)
DROP POLICY IF EXISTS "PI can update lab" ON public.labs;
CREATE POLICY "PI can update lab"
  ON public.labs FOR UPDATE
  USING (pi_user_id = auth.uid());

-- Policy: Any authenticated user can insert (create) a lab
DROP POLICY IF EXISTS "Authenticated users can create labs" ON public.labs;
CREATE POLICY "Authenticated users can create labs"
  ON public.labs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- 10. ADD RLS POLICIES FOR LAB_MEMBERS TABLE
-- ============================================================================
-- Enable RLS on lab_members table if not already enabled
ALTER TABLE public.lab_members ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view members of their lab
DROP POLICY IF EXISTS "Users can view lab members" ON public.lab_members;
CREATE POLICY "Users can view lab members"
  ON public.lab_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.lab_members AS my_membership
      WHERE my_membership.lab_id = lab_members.lab_id
      AND my_membership.user_id = auth.uid()
    )
  );

-- Policy: Users can insert themselves into a lab (used during join)
-- The API will validate the invite code before inserting
DROP POLICY IF EXISTS "Users can join labs" ON public.lab_members;
CREATE POLICY "Users can join labs"
  ON public.lab_members FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Policy: PI and Admins can update member roles (enforced in API)
DROP POLICY IF EXISTS "Lab admins can update members" ON public.lab_members;
CREATE POLICY "Lab admins can update members"
  ON public.lab_members FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.lab_members AS my_membership
      WHERE my_membership.lab_id = lab_members.lab_id
      AND my_membership.user_id = auth.uid()
      AND my_membership.role IN ('pi', 'admin')
    )
  );

-- Policy: Users can delete themselves (leave lab)
-- PI and Admins can delete others (API enforces PI cannot be removed)
DROP POLICY IF EXISTS "Users can leave or be removed from labs" ON public.lab_members;
CREATE POLICY "Users can leave or be removed from labs"
  ON public.lab_members FOR DELETE
  USING (
    user_id = auth.uid() -- Can remove self
    OR EXISTS ( -- Or is PI/Admin
      SELECT 1 FROM public.lab_members AS my_membership
      WHERE my_membership.lab_id = lab_members.lab_id
      AND my_membership.user_id = auth.uid()
      AND my_membership.role IN ('pi', 'admin')
    )
  );

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- Summary:
-- ✓ Added invite_code column to labs table
-- ✓ Created generate_invite_code() function with collision prevention
-- ✓ Backfilled existing labs with unique codes
-- ✓ Added NOT NULL and UNIQUE constraints
-- ✓ Created auto-generation trigger for new labs
-- ✓ Created regenerate_lab_invite_code() function
-- ✓ Added index for fast lookups
-- ✓ Added RLS policies for labs and lab_members tables
