# Frontend structure

- **`src/`** – Application source
  - `src/app/` – Next.js App Router (pages, layouts, API routes)
  - `src/components/` – React components
  - `src/lib/` – Utilities, API clients, Supabase, types
  - `src/hooks/` – React hooks
  - `src/types/` – TypeScript declarations
  - `src/emails/` – Email templates and preview
- **`public/`** – Static assets (favicons, images) served at `/`
- **`scripts/`** – Build and env scripts (e.g. `validate-env.js`)
- **`main/`** – Electron main process
- **`build-resources/`** – App icons for Electron

Imports use the `@/` alias and resolve to `src/` (e.g. `@/components/Button` → `src/components/Button`).
