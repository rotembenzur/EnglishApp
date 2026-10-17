-- LexBites text audio (0.10.0). Phones submit the sentences and words of a saved text that have no
-- recording (lb_tts_jobs); the Text audio workflow (.github/workflows/tts.yml) renders them with
-- Kokoro and stores the clips (lb_tts_clips); phones download the clips and keep them offline.
-- Applied by the Push server workflow after schema.sql; safe to run again.
--
-- Phones (anon role with the passphrase hash) may add jobs and read jobs and clips. Only the render
-- workflow (service role) changes a job or writes a clip; it also deletes old rows.

create table if not exists lb_tts_jobs (
  id text primary key,
  user_id text not null,
  -- [{"k": clip key, "v": "us" | "uk", "t": text, "w": true for a word}], in reading order.
  units jsonb not null,
  total int not null,
  done int not null default 0,
  failed int not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lb_tts_jobs_status check (status in ('pending', 'running', 'done', 'failed')),
  constraint lb_tts_jobs_size check (
    jsonb_typeof(units) = 'array'
    and jsonb_array_length(units) between 1 and 2000
    and total = jsonb_array_length(units)
  )
);

create table if not exists lb_tts_clips (
  k text not null,
  v text not null,
  -- AAC in MP4 (m4a), 24 kHz mono, base64.
  audio text not null,
  ms int not null default 0,
  created_at timestamptz not null default now(),
  primary key (k, v)
);

create index if not exists lb_tts_jobs_open on lb_tts_jobs (created_at) where status in ('pending', 'running');

alter table lb_tts_jobs enable row level security;
alter table lb_tts_clips enable row level security;

drop policy if exists lb_tts_jobs_read on lb_tts_jobs;
drop policy if exists lb_tts_jobs_add on lb_tts_jobs;
drop policy if exists lb_tts_clips_read on lb_tts_clips;
create policy lb_tts_jobs_read on lb_tts_jobs for select to anon using (lb_authorized());
create policy lb_tts_jobs_add on lb_tts_jobs for insert to anon
  with check (lb_authorized() and status = 'pending' and done = 0 and failed = 0);
create policy lb_tts_clips_read on lb_tts_clips for select to anon using (lb_authorized());

revoke update, delete, truncate on lb_tts_jobs, lb_tts_clips from anon, authenticated;
grant select, insert on lb_tts_jobs to anon;
grant select on lb_tts_clips to anon;
grant all on lb_tts_jobs, lb_tts_clips to service_role;

select
  (select count(*) from pg_tables where schemaname = 'public'
    and tablename in ('lb_tts_jobs', 'lb_tts_clips')) as tts_tables;
