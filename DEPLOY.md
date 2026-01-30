# Deploy SplicR on Vercel

## Recommended: Use Frontend as Root

1. In [Vercel](https://vercel.com): **Add New Project** → Import your repo.
2. **Root Directory**: Click "Edit" and set to **`frontend`** (so Vercel uses the Next.js app there).
3. **Framework Preset**: Next.js (auto-detected).
4. **Environment Variables**: Add from `frontend/.env.example` (e.g. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, R2 vars if using uploads).
5. **Deploy**.

## Alternative: Deploy from Repo Root

If you leave Root Directory blank, the root `package.json` and `vercel.json` are used: the build runs `cd frontend && npm install && npm run build` and output is `frontend/.next`. Ensure environment variables are set in the Vercel project.
