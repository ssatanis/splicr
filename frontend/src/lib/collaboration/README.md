# Collaboration module

Real-time presence, comments, activity, and notifications for SplicR analyses.

## Hooks

- **useAuth** (`@/hooks/useAuth`) – Current user from Supabase session or UserContext.
- **usePresence** – Who is viewing the analysis; heartbeat + postgres_changes on `analysis_presence`.
- **useComments** – Threaded comments with replies, resolve, reactions; uses `analysis_comments` and `comment_reactions`.
- **useActivity** – Analysis activity feed; uses `analysis_activity` or falls back to `activity_logs`.
- **useNotifications** – User notifications; uses `user_notifications` (graceful if table missing).

## Supabase tables (create in SQL if not present)

```sql
-- Presence: who is viewing and where
create table if not exists analysis_presence (
  id uuid primary key default gen_random_uuid(),
  analysis_id text not null,
  user_id uuid not null,
  display_name text,
  avatar_url text,
  current_view text default 'results_table',
  cursor_position jsonb,
  last_seen timestamptz default now(),
  unique(analysis_id, user_id)
);

-- Comments (threaded, with target)
create table if not exists analysis_comments (
  id uuid primary key default gen_random_uuid(),
  analysis_id text not null,
  user_id uuid not null,
  parent_comment_id uuid references analysis_comments(id),
  target_type text not null default 'analysis',
  target_id text,
  content text not null,
  mentions jsonb default '[]',
  is_resolved boolean default false,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  edited boolean default false
);

-- Comment reactions
create table if not exists comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references analysis_comments(id) on delete cascade,
  user_id uuid not null,
  reaction text not null,
  unique(comment_id, user_id, reaction)
);

-- Activity log per analysis
create table if not exists analysis_activity (
  id uuid primary key default gen_random_uuid(),
  analysis_id text not null,
  user_id uuid not null,
  activity_type text not null,
  description text,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- User notifications (optional)
create table if not exists user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  message text,
  type text default 'info',
  read boolean default false,
  metadata jsonb,
  created_at timestamptz default now()
);

-- Enable RLS and policies as needed for your auth
```

## Usage

On the results page, the **Collaboration** button opens the sidebar. The sidebar has tabs:

- **Online** – Users currently viewing (from `usePresence`).
- **Comments** – Add/ reply/resolve comments; @mentions (TODO: resolve user lookup).
- **Activity** – Recent analysis activity.
- **Alerts** – Notifications (if `user_notifications` exists).
