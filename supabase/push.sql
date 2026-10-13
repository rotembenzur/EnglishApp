-- LexBites push notifications: database side. Run by .github/workflows/push-server.yml through
-- the Supabase Management API after deploying the lexbites-push Edge Function. Safe to re-run.
-- Needs supabase/schema.sql first. :function_url is replaced by the workflow.
--
-- pg_cron calls the function every 5 minutes for daily reminders and streak alerts; a trigger
-- calls it on every new nudge so it arrives within seconds. Both send the passphrase hash from
-- lb_config, so the function reads the data through row-level security like the phones do.

create extension if not exists pg_net;
create extension if not exists pg_cron;

alter table lb_config add column if not exists push_url text;
alter table lb_config add column if not exists keepalive_at timestamptz;
update lb_config set push_url = ':function_url' where id = 1;

-- Server-owned send state (which reminders went out today). The phones write only `data`.
alter table lb_push add column if not exists state jsonb;
grant delete on lb_push to anon;

create or replace function lb_push_call(body jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  c lb_config;
begin
  select * into c from lb_config where id = 1;
  if c.push_url is null or c.push_url = '' then
    return;
  end if;
  perform net.http_post(
    url := c.push_url,
    body := body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-lexbites-key', c.key_hash),
    timeout_milliseconds := 30000
  );
end $$;
revoke all on function lb_push_call(jsonb) from public, anon, authenticated;

create or replace function lb_events_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.data ->> 'type' = 'nudge' then
    perform lb_push_call(jsonb_build_object('kind', 'nudge', 'id', new.id));
  end if;
  return null;
end $$;
revoke all on function lb_events_push() from public, anon, authenticated;

drop trigger if exists lb_events_push on lb_events;
create trigger lb_events_push after insert on lb_events
  for each row execute function lb_events_push();

-- Keepalive (.github/workflows/keepalive.yml): a real write, callable without the passphrase,
-- that only stamps a time. Free projects pause after a week without activity.
create or replace function lb_keepalive() returns timestamptz
language sql security definer set search_path = public as $$
  update lb_config set keepalive_at = now() where id = 1 returning keepalive_at;
$$;
revoke all on function lb_keepalive() from public;
grant execute on function lb_keepalive() to anon;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'lexbites-push-tick';
  perform cron.schedule('lexbites-push-tick', '*/5 * * * *', 'select lb_push_call(''{"kind":"tick"}''::jsonb)');
end $$;

select
  (select count(*) from cron.job where jobname = 'lexbites-push-tick') as cron_jobs,
  (select push_url is not null from lb_config where id = 1) as push_url_set,
  (select count(*) from pg_trigger where tgname = 'lb_events_push') as nudge_trigger;
