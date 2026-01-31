# Deploy SplicR on Vercel

Use **Node.js 24.x** and the latest stack for production.

## Option A: Build from repo root (default)

The repo is set up so Vercel builds from the **root**:

1. **Root Directory**: Leave blank (use repo root).
2. **Node.js**: Set to **24.x** in Vercel → Project Settings → General → Node.js Version (or rely on `package.json` `engines.node`: `"24.x"`).
3. **Install**: `npm ci` runs at root (installs Next.js for detection).
4. **Build**: `npm run build` runs `cd frontend && npm ci && npm run build`.
5. **Output**: `frontend/.next`.
6. **Environment variables**: Add from `frontend/.env.example` (e.g. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, R2 vars if using uploads).

No extra Vercel settings are required.

## Option B: Build from `frontend` (alternative)

1. In Vercel: Project Settings → General → **Root Directory** → set to **`frontend`**.
2. **Node.js**: 24.x (from `frontend/package.json` `engines`).
3. **Framework**: Next.js (auto-detected).
4. **Environment variables**: Same as above.

Deploy from the **root** (Option A) or from **`frontend`** (Option B); both work.
