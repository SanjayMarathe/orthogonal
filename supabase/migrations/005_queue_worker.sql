create table if not exists public.queue_jobs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  request_payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','running','done','failed','cancelled')),
  priority int not null default 0,
  attempt int not null default 0,
  max_attempts int not null default 3,
  idempotency_key text,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  dead_letter_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists queue_jobs_idempotency_key_idx
  on public.queue_jobs(idempotency_key)
  where idempotency_key is not null;

create index if not exists queue_jobs_status_available_priority_idx
  on public.queue_jobs(status, available_at, priority desc, created_at);

create index if not exists queue_jobs_user_created_idx
  on public.queue_jobs(user_id, created_at desc);

create index if not exists queue_jobs_conversation_created_idx
  on public.queue_jobs(conversation_id, created_at desc);

create table if not exists public.queue_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.queue_jobs(id) on delete cascade,
  assistant_message_id uuid references public.messages(id) on delete set null,
  result_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists queue_results_job_id_idx
  on public.queue_results(job_id);

create table if not exists public.queue_provider_limits (
  provider text primary key,
  max_running int not null default 5,
  current_running int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.queue_provider_breakers (
  provider text primary key,
  failure_count int not null default 0,
  open_until timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists public.queue_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.queue_jobs(id) on delete cascade,
  event_type text not null,
  event_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists queue_events_job_created_idx
  on public.queue_events(job_id, created_at desc);

create or replace function public.dequeue_jobs(worker text, limit_n int default 5)
returns setof public.queue_jobs
language plpgsql
as $$
begin
  return query
    with picked as (
      select q.id
      from public.queue_jobs q
      where q.status = 'queued'
        and q.available_at <= now()
      order by q.priority desc, q.created_at asc
      for update skip locked
      limit greatest(limit_n, 1)
    )
    update public.queue_jobs q
    set status = 'running',
        attempt = q.attempt + 1,
        locked_at = now(),
        locked_by = worker,
        started_at = coalesce(q.started_at, now()),
        updated_at = now()
    from picked
    where q.id = picked.id
    returning q.*;
end;
$$;

create or replace function public.recover_stale_jobs(stale_seconds int default 120)
returns int
language plpgsql
as $$
declare
  recovered int := 0;
begin
  with target as (
    select id
    from public.queue_jobs
    where status = 'running'
      and locked_at is not null
      and locked_at < now() - make_interval(secs => stale_seconds)
  )
  update public.queue_jobs q
  set status = case when q.attempt >= q.max_attempts then 'failed' else 'queued' end,
      available_at = now() + make_interval(secs => least(120, greatest(5, q.attempt * 10))),
      locked_at = null,
      locked_by = null,
      error = case when q.attempt >= q.max_attempts then coalesce(q.error, 'stale-lock-max-attempts') else q.error end,
      dead_letter_reason = case when q.attempt >= q.max_attempts then coalesce(q.dead_letter_reason, 'stale_lock_timeout') else q.dead_letter_reason end,
      updated_at = now()
  from target
  where q.id = target.id;

  get diagnostics recovered = row_count;
  return recovered;
end;
$$;
