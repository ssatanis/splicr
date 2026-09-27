# Architecture

Three pieces, joined by one Postgres database.

```
  Browser                 Supabase                     Engine
  ┌──────────────┐        ┌─────────────────┐          ┌──────────────────┐
  │ Next.js 16   │ ─────▶ │ Postgres 17     │ ◀─────── │ Python workers   │
  │ React 19     │  RLS   │  public.*       │  secret  │  count, QC,      │
  │ Tailwind 4   │        │  atlas.*        │   key    │  hit calling,    │
  │              │ ◀───── │  private.*      │          │  scoring         │
  └──────────────┘ realtime└─────────────────┘         └──────────────────┘
        │                      │        ▲                      │
        │ resumable upload     │ pgmq   │ progress             │ reads/writes
        ▼                      ▼        │                      ▼
  ┌──────────────┐        ┌─────────────────┐          ┌──────────────────┐
  │ Object store │        │ Job queue       │          │ Reference data   │
  │ FASTQ, counts│        │ leases, retries │          │ HGNC, libraries  │
  └──────────────┘        └─────────────────┘          └──────────────────┘
```

## Why this shape

**The database is the contract.** The web app never talks to the engine and the
engine never talks to the web app. They meet in Postgres: the app writes a
screen and a run, the engine claims a job and writes results back. Either side
can be restarted, replaced or run locally without the other.

**Row Level Security is the only authorization.** There is no separate
permission layer to keep in sync. A user sees a row if they belong to the
organization that owns it, or if the screen is public. The browser holds a
publishable key that grants nothing on its own. The engine holds a secret key
that bypasses RLS, and it never touches the browser.

**Heavy compute lives outside.** Counting 40 million reads against a 77,000
guide library is minutes of CPU and gigabytes of memory. That cannot run in a
serverless function, so it runs on a worker that leases jobs from the queue.

## The three schemas

| Schema    | Holds                                              | Who writes |
|-----------|----------------------------------------------------|------------|
| `public`  | Screens, runs, jobs, hits, outcomes, reports        | App and engine |
| `atlas`   | Genes, libraries, guides, public screens, the answer key | Engine only |
| `private` | Security-definer helpers, never exposed to the API  | Nobody at runtime |

`private` is deliberately not in the API's exposed schemas, so its membership
helpers cannot be called from a browser even though policies depend on them.

## Request paths

**Reading a screen.** Server component calls Supabase with the user's cookie.
Postgres applies the policy. No filtering happens in application code, so a
missing `where` clause cannot leak another lab's data.

**Uploading FASTQ.** The browser uploads directly to object storage in
resumable chunks. The file never passes through the app server, which is what
makes a 50 GB upload possible at all.

**Running the pipeline.** Inserting a job row enqueues a message. A worker
leases it with a short visibility timeout and extends that lease from its
heartbeat, so a crashed worker releases its job in about a minute rather than
holding it for hours. Progress is written as rows, and a trigger broadcasts
them to the browser.

## Environments

Local development runs against the hosted database directly. Preview branches
get their own database branch. Production is the same schema with backups and
point-in-time recovery turned on.
