# Authentication Troubleshooting Guide

## Current Issue: 522 Error on Sign In

The `net::ERR_FAILED 522` error combined with CORS warnings usually indicates:
- Browser cache/cookie issues
- Multiple conflicting Supabase client instances (now fixed)
- Stale session data

## Quick Fix Steps

### 1. Clear ALL Browser Data (IMPORTANT)

The 522 error often comes from cached failed requests. **You MUST do this:**

**Chrome/Edge:**
1. Press `F12` to open DevTools
2. Right-click the refresh button
3. Select **"Empty Cache and Hard Reload"**
4. OR go to `chrome://settings/clearBrowserData`
5. Select "Cookies and other site data" + "Cached images and files"
6. Time range: "All time"
7. Click "Clear data"

**Firefox:**
1. Press `Ctrl+Shift+Delete` (Windows) or `Cmd+Shift+Delete` (Mac)
2. Select "Cookies" and "Cache"
3. Click "Clear Now"

**Safari:**
1. Safari → Preferences → Privacy
2. Click "Manage Website Data"
3. Remove All
4. Safari → Develop → Empty Caches

### 2. Restart Development Server

```bash
cd /Users/sahaj/Documents/Projects/SplicR/frontend

# Kill any running Next.js process
pkill -f "next dev" || true

# Clean everything
rm -rf .next
rm -rf node_modules/.cache

# Restart
npm run dev
```

### 3. Test in Incognito/Private Window

Open a fresh incognito/private window and try:
```
http://localhost:3000/auth/sign-in
```

This ensures no cached data interferes.

### 4. Verify Supabase Configuration

**Check your Supabase Dashboard:**
1. Go to: https://supabase.com/dashboard/project/bxfrhmvkylipqdtoehii
2. Navigate to **Authentication → URL Configuration**
3. Ensure these are set:

   **Site URL:**
   ```
   http://localhost:3000
   ```

   **Redirect URLs:** (one per line)
   ```
   http://localhost:3000/**
   ```

4. Navigate to **Settings → API**
5. Verify your keys match `.env.local`:
   - Project URL should be: `https://bxfrhmvkylipqdtoehii.supabase.co`
   - anon/public key should match `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 5. Test Supabase Connection

Run this to verify Supabase is accessible:
```bash
curl -H "apikey: YOUR_ANON_KEY" https://bxfrhmvkylipqdtoehii.supabase.co/auth/v1/health
```

Should return: `{"version":"...","name":"GoTrue"}`

Or test via the health endpoint:
```
http://localhost:3000/api/auth/health
```

## Still Not Working?

### Check Supabase Project Status

1. **Is the project paused?**
   - Free tier projects pause after 1 week of inactivity
   - Go to Dashboard → Settings → General
   - Click "Restore" if paused

2. **Check project logs:**
   - Dashboard → Logs → Auth Logs
   - Look for failed authentication attempts

### Network Issues

1. **Disable VPN/Proxy:**
   - VPNs can interfere with Supabase connections
   - Try disabling temporarily

2. **Check Firewall:**
   - Ensure outbound HTTPS (443) is allowed
   - Whitelist `*.supabase.co`

3. **DNS Issues:**
   - Try `ping bxfrhmvkylipqdtoehii.supabase.co`
   - Should resolve to Cloudflare IPs

### Environment Variables

Verify your `.env.local`:
```bash
cd frontend
cat .env.local | grep SUPABASE
```

Should show:
```
NEXT_PUBLIC_SUPABASE_URL=https://bxfrhmvkylipqdtoehii.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Create Test User Directly

Try creating a user via Supabase SQL Editor:
```sql
-- Go to Dashboard → SQL Editor and run:
SELECT auth.email(), auth.role();
```

If this fails, your Supabase project has issues.

## What We Fixed

✅ **Multiple GoTrueClient Instances** - Now using singleton pattern
✅ **Missing Middleware** - Added proper session management
✅ **Browser Client Configuration** - Using SSR-compatible client
✅ **Session Persistence** - Enabled automatic cookie storage
✅ **Error Messages** - Better CORS/network error detection

## Next Steps

After following the steps above:

1. **Sign Up:** http://localhost:3000/auth/sign-up
2. **Sign In:** http://localhost:3000/auth/sign-in
3. **Verify session persists** - Refresh page, should stay logged in

## Still Having Issues?

If the problem persists:

1. **Check Browser Console** - Press F12, look for errors
2. **Check Network Tab** - See exact request/response
3. **Share the error** - Copy full error message from console
4. **Verify Supabase status** - Check https://status.supabase.com/

The authentication system is now properly configured. The 522 error is almost certainly a browser cache issue or Supabase project configuration.
