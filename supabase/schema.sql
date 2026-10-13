-- LexBites sync backend (Supabase free tier). Run once in the SQL Editor.
-- 1. Replace CHANGE-ME at the bottom with a passphrase you choose (same one on both phones).
-- 2. Run the whole script. Running it again is safe, also with CHANGE-ME left in place.
--
-- Every table stores the app's row as JSON plus the fields needed for merging.
-- server_at is set by the database on every write and drives incremental pulls.
-- Row tables are last-write-wins by updated_at (enforced by a trigger); reviews and events are
-- append-only. Access requires the x-lexbites-key header to match the stored passphrase hash.

create extension if not exists pgcrypto;

create table if not exists lb_config (
  id int primary key default 1 check (id = 1),
  key_hash text not null
);
alter table lb_config enable row level security;
-- No policies on lb_config: it is never readable through the API.

create or replace function lb_set_passphrase(p text) returns void
language plpgsql security definer as $$
begin
  -- Re-running the script with the placeholder keeps the passphrase that is already set.
  if p = 'CHANGE-ME' and exists (select 1 from lb_config) then
    raise notice 'Passphrase kept: the last line still says CHANGE-ME';
    return;
  end if;
  insert into lb_config (id, key_hash) values (1, encode(digest('lexbites:' || p, 'sha256'), 'hex'))
  on conflict (id) do update set key_hash = excluded.key_hash;
end $$;
revoke all on function lb_set_passphrase(text) from public, anon, authenticated;

create or replace function lb_authorized() returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from lb_config
    where key_hash = coalesce(current_setting('request.headers', true)::json ->> 'x-lexbites-key', '')
  );
$$;

create or replace function lb_touch() returns trigger language plpgsql as $$
begin
  new.server_at := clock_timestamp();
  return new;
end $$;

create or replace function lb_lww() returns trigger language plpgsql as $$
begin
  if new.updated_at < old.updated_at then
    return null; -- keep the newer row already stored
  end if;
  new.server_at := clock_timestamp();
  return new;
end $$;

create table if not exists lb_users (
  id text primary key,
  data jsonb not null,
  updated_at bigint not null,
  device_id text,
  server_at timestamptz not null default clock_timestamp()
);
create table if not exists lb_user_words (
  user_id text not null,
  lemma_id integer not null,
  data jsonb not null,
  updated_at bigint not null,
  device_id text,
  server_at timestamptz not null default clock_timestamp(),
  primary key (user_id, lemma_id)
);
create table if not exists lb_daily (
  user_id text not null,
  date text not null,
  data jsonb not null,
  updated_at bigint not null,
  device_id text,
  server_at timestamptz not null default clock_timestamp(),
  primary key (user_id, date)
);
create table if not exists lb_presence (
  user_id text primary key,
  data jsonb not null,
  updated_at bigint not null,
  device_id text,
  server_at timestamptz not null default clock_timestamp()
);
create table if not exists lb_reviews (
  id text primary key,
  user_id text not null,
  data jsonb not null,
  updated_at bigint not null,
  device_id text,
  server_at timestamptz not null default clock_timestamp()
);
create table if not exists lb_events (
  id text primary key,
  user_id text not null,
  data jsonb not null,
  updated_at bigint not null,
  device_id text,
  server_at timestamptz not null default clock_timestamp()
);
create table if not exists lb_push (
  endpoint text primary key,
  user_id text not null,
  data jsonb not null,
  updated_at bigint not null,
  device_id text,
  server_at timestamptz not null default clock_timestamp()
);

do $$
declare t text;
begin
  foreach t in array array['lb_users','lb_user_words','lb_daily','lb_presence','lb_push'] loop
    execute format('drop trigger if exists %I_lww on %I', t, t);
    execute format('create trigger %I_lww before update on %I for each row execute function lb_lww()', t, t);
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before insert on %I for each row execute function lb_touch()', t, t);
  end loop;
  foreach t in array array['lb_reviews','lb_events'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before insert on %I for each row execute function lb_touch()', t, t);
    -- Append-only: duplicates from retries are ignored.
    execute format('drop trigger if exists %I_lww on %I', t, t);
    execute format('create trigger %I_lww before update on %I for each row execute function lb_lww()', t, t);
  end loop;
  foreach t in array array['lb_users','lb_user_words','lb_daily','lb_presence','lb_reviews','lb_events','lb_push'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format('create policy %I_rw on %I for all to anon using (lb_authorized()) with check (lb_authorized())', t, t);
    execute format('create index if not exists %I_server_at on %I (server_at)', t, t);
  end loop;
end $$;

grant select, insert, update on lb_users, lb_user_words, lb_daily, lb_presence, lb_reviews, lb_events, lb_push to anon;
grant execute on function lb_authorized() to anon;

-- Keepalive (.github/workflows/keepalive.yml): a real write, callable without the passphrase,
-- that only stamps a time. Free projects pause after a week without activity.
alter table lb_config add column if not exists keepalive_at timestamptz;
create or replace function lb_keepalive() returns timestamptz
language sql security definer set search_path = public as $$
  update lb_config set keepalive_at = now() where id = 1 returning keepalive_at;
$$;
revoke all on function lb_keepalive() from public;
grant execute on function lb_keepalive() to anon;

-- Your shared passphrase (the same one you type in the app on both phones):
select lb_set_passphrase('CHANGE-ME');
