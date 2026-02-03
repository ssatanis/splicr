-- ============================================================================
-- DISABLE EMAIL VERIFICATION REQUIREMENT
-- ============================================================================
-- This migration confirms all existing user emails so they can sign in
-- immediately without needing to verify their email addresses.
--
-- Date: 2026-02-03
-- Purpose: Remove email verification barrier for user sign-in
-- ============================================================================

-- Confirm all existing users who haven't confirmed their email
UPDATE auth.users 
SET 
  email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
  updated_at = NOW()
WHERE email_confirmed_at IS NULL;

-- Log the change
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO updated_count
  FROM auth.users
  WHERE email_confirmed_at IS NOT NULL;
  
  RAISE NOTICE 'Email verification disabled: % users can now sign in', updated_count;
END $$;

-- ============================================================================
-- IMPORTANT NOTES
-- ============================================================================
-- This migration only affects the database. You MUST also:
--
-- 1. Disable email confirmations in Supabase Dashboard:
--    - Go to: Authentication → Settings → Email
--    - Turn OFF "Confirm email"
--    - Click Save
--
-- 2. Or set in Supabase config (for hosted instances):
--    - enable_confirmations = false
--
-- Without disabling in the dashboard/config, new signups will still
-- require email verification.
-- ============================================================================
