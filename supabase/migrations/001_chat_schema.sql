-- conversations: one thread per user
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  context_summary text,
  context_tokens int not null default 0,
  context_limit int not null default 262000,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- messages: full history including tool calls
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('system','user','assistant','tool')),
  content text,
  tool_calls jsonb,
  tool_call_id text,
  token_count int not null default 0,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "Users can select own conversations"
  on public.conversations for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own conversations"
  on public.conversations for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own conversations"
  on public.conversations for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own conversations"
  on public.conversations for delete
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can select messages in own conversations"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

create policy "Users can insert messages in own conversations"
  on public.messages for insert
  to authenticated
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

create policy "Users can update messages in own conversations"
  on public.messages for update
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

create policy "Users can delete messages in own conversations"
  on public.messages for delete
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );
