-- Schedule chat-worker via pg_cron + pg_net (Supabase scheduled Edge Function pattern).
-- After deploy, store secrets in Vault (once per project):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<same as QUEUE_WORKER_SECRET>', 'queue_worker_secret');

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.invoke_chat_worker_cron()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  project_url text;
  worker_secret text;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  select decrypted_secret into worker_secret
  from vault.decrypted_secrets
  where name = 'queue_worker_secret'
  limit 1;

  if project_url is null or worker_secret is null then
    raise notice 'invoke_chat_worker_cron: missing vault secrets project_url or queue_worker_secret';
    return;
  end if;

  perform net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/chat-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-queue-worker-secret', worker_secret
    ),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.invoke_chat_worker_cron() from public;
grant execute on function public.invoke_chat_worker_cron() to postgres;

do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'chat-worker-every-minute') then
    perform cron.unschedule('chat-worker-every-minute');
  end if;
exception
  when undefined_table then null;
end;
$cron$;

select cron.schedule(
  'chat-worker-every-minute',
  '* * * * *',
  $$select public.invoke_chat_worker_cron();$$
);
