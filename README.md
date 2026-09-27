# SplicR

Know which hits are real.

SplicR is the answer key for CRISPR screens. Upload a screen and every hit comes
back with a calibrated chance it is real, the reason behind it, and what to do
next. It is built on every public screen re-analyzed through one pipeline, plus
a growing record of which hits held up when labs went back and checked.

## What is here

```
apps/web          Next.js app: marketing site, auth, dashboard
supabase          Database migrations (Postgres schema, RLS, queues, storage)
engine            Offline pipeline: counting, QC, hit calling, scoring
scripts           Data downloads and database tooling
data              Reference data (downloaded, not committed)
docs              How the pipeline, data model and science fit together
```

## Getting started

```bash
npm install
npm run dev
```

The site runs at http://localhost:3000. The dashboard has a demo mode, so you
can look around without an account.

Copy `.env.example` to `apps/web/.env.local` and fill in your Supabase URL and
publishable key.

## Database

```bash
npm run db:push
```

Applies every migration in `supabase/migrations` in order and records it the
same way the Supabase CLI does. `npm run db:status` prints what is actually in
the database: tables, row-level security, policies and scheduled jobs.

## Analysis engine

```bash
bash engine/setup.sh
export PATH="engine/.tools/env/bin:$PATH"
python engine/tests/smoke_test.py
```

Installs MAGeCK, BAGEL2, bowtie, cutadapt, fastp, seqkit and samtools into a
local environment, then verifies each one runs. The smoke test builds a count
table from real Brunello guides and checks both hit callers recover known
essential genes. See `docs/05-engine.md`.

## Reference data

```bash
bash scripts/data/download.sh
```

Downloads gene annotation, reference gene sets, cell line identities, pooled
library definitions and public evidence into `data/references`. Add `--all` for
the large archives. Licences differ per source, and `docs/04-data-sources.md`
lists each one. Addgene library files are for local use and are never
redistributed.

## Checks

```bash
npm run typecheck
npm run lint
npm run build
```

## Licence

MIT for the code. Data keeps the licence of whoever published it.
