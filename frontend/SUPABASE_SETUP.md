# Supabase Authentication Setup Guide

## CORS Error Fix - Required Steps

The CORS error you're seeing indicates that your Supabase project needs to be configured to allow authentication from localhost. Follow these steps:

### 1. Configure Authentication URLs in Supabase Dashboard

1. Go to your Supabase Dashboard: https://supabase.com/dashboard/project/bxfrhmvkylipqdtoehii
2. Navigate to **Authentication** → **URL Configuration**
3. Update the following settings:

   **Site URL:**
   ```
   http://localhost:3000
   ```

   **Redirect URLs:** (Add all of these, one per line)
   ```
   http://localhost:3000/auth/callback
   http://localhost:3000/auth/sign-in
   http://localhost:3000/dashboard
   https://your-production-domain.com/auth/callback
   ```

4. Click **Save**

### 2. Verify CORS Settings

1. In Supabase Dashboard, go to **Settings** → **API**
2. Ensure that **CORS** is not restricted
3. The default setting should allow all origins (`*`) for development

### 3. Check Authentication Providers

1. Go to **Authentication** → **Providers**
2. Ensure **Email** provider is enabled
3. Check if **Confirm email** is toggled on/off based on your preference
   - If ON: Users must verify email before signing in
   - If OFF: Users can sign in immediately after signup

### 4. Restart Your Development Server

After making changes in the Supabase Dashboard:

```bash
cd frontend
rm -rf .next
npm run dev
```

### 5. Clear Browser Data

The CORS error might be cached. Clear your browser's:
- Cookies for localhost:3000
- Cache
- Or use an incognito/private window

## Testing Authentication

After completing the above steps, test your authentication:

1. Go to http://localhost:3000/auth/sign-up
2. Create a new account
3. If email confirmation is enabled, check your email and click the confirmation link
4. Go to http://localhost:3000/auth/sign-in
5. Sign in with your credentials

The session should persist across page refreshes!

## Troubleshooting

If you still see CORS errors:

1. **Check Supabase Project Status**: Ensure your project isn't paused
2. **Verify Environment Variables**: Make sure `.env.local` has the correct values
3. **Check Network Tab**: In browser DevTools → Network, check if the request to Supabase shows a 403 or 401 error
4. **Supabase Logs**: In Dashboard → Logs, check for authentication errors

## Environment Variables Reference

Your current configuration in `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://bxfrhmvkylipqdtoehii.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

These should match exactly with the values in:
**Supabase Dashboard → Settings → API → Project URL and anon/public key**
