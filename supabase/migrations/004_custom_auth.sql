create extension if not exists citext;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_user_credentials (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  password_hash text not null,
  password_algo text not null default 'pbkdf2-sha256',
  updated_at timestamptz not null default now()
);

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  refresh_token_hash text not null unique,
  user_agent text,
  ip_address text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_sessions_user_id_idx
  on public.app_sessions(user_id);

create index if not exists app_sessions_expires_at_idx
  on public.app_sessions(expires_at);

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.app_user_id', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'app_user_id'),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

alter table public.conversations
  add constraint conversations_user_id_app_users_fkey
  foreign key (user_id) references public.app_users(id) on delete cascade not valid;

do $$
declare
  legacy_email text;
begin
  insert into public.app_users (id, email, created_at, updated_at)
  select distinct
    c.user_id,
    (('legacy-' || c.user_id::text || '@local.invalid')::citext),
    now(),
    now()
  from public.conversations c
  where not exists (
    select 1 from public.app_users u where u.id = c.user_id
  );

  alter table public.conversations
    validate constraint conversations_user_id_app_users_fkey;

  if exists (
    select 1
    from pg_constraint
    where conname = 'conversations_user_id_fkey'
      and conrelid = 'public.conversations'::regclass
  ) then
    alter table public.conversations drop constraint conversations_user_id_fkey;
  end if;
end $$;

drop policy if exists "Users can select own conversations" on public.conversations;
drop policy if exists "Users can select conversations" on public.conversations;
drop policy if exists "Users can insert own conversations" on public.conversations;
drop policy if exists "Users can update own conversations" on public.conversations;
drop policy if exists "Users can delete own conversations" on public.conversations;

create policy "Users can select conversations"
  on public.conversations for select
  to authenticated
  using (public.current_app_user_id() = user_id or is_public = true);

create policy "Users can insert own conversations"
  on public.conversations for insert
  to authenticated
  with check (public.current_app_user_id() = user_id);

create policy "Users can update own conversations"
  on public.conversations for update
  to authenticated
  using (public.current_app_user_id() = user_id)
  with check (public.current_app_user_id() = user_id);

create policy "Users can delete own conversations"
  on public.conversations for delete
  to authenticated
  using (public.current_app_user_id() = user_id);

drop policy if exists "Users can select messages in own conversations" on public.messages;
drop policy if exists "Users can select messages in accessible conversations" on public.messages;
drop policy if exists "Users can insert messages in own conversations" on public.messages;
drop policy if exists "Users can update messages in own conversations" on public.messages;
drop policy if exists "Users can delete messages in own conversations" on public.messages;

create policy "Users can select messages in accessible conversations"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and (c.user_id = public.current_app_user_id() or c.is_public = true)
    )
  );

create policy "Users can insert messages in own conversations"
  on public.messages for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = public.current_app_user_id()
    )
  );

create policy "Users can update messages in own conversations"
  on public.messages for update
  to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = public.current_app_user_id()
    )
  );

create policy "Users can delete messages in own conversations"
  on public.messages for delete
  to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = public.current_app_user_id()
    )
  );

drop policy if exists "Chat uploads insert own" on storage.objects;
drop policy if exists "Chat uploads select own" on storage.objects;
drop policy if exists "Chat uploads delete own" on storage.objects;
drop policy if exists "Chat uploads select public conversation" on storage.objects;

create policy "Chat uploads insert own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'chat-uploads'
    and (storage.foldername(name))[1] = public.current_app_user_id()::text
  );

create policy "Chat uploads select own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'chat-uploads'
    and (storage.foldername(name))[1] = public.current_app_user_id()::text
  );

create policy "Chat uploads delete own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'chat-uploads'
    and (storage.foldername(name))[1] = public.current_app_user_id()::text
  );

create policy "Chat uploads select public conversation"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'chat-uploads'
    and exists (
      select 1
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where c.is_public = true
        and m.metadata->'attachments' is not null
        and exists (
          select 1
          from jsonb_array_elements(m.metadata->'attachments') att
          where att->>'path' = name
        )
    )
  );
