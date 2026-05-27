-- Allow any authenticated user (including anonymous) to read public conversations by ID.
alter table public.conversations
  add column if not exists is_public boolean not null default true;

drop policy if exists "Users can select own conversations" on public.conversations;

create policy "Users can select conversations"
  on public.conversations for select
  to authenticated
  using (auth.uid() = user_id or is_public = true);

drop policy if exists "Users can select messages in own conversations" on public.messages;

create policy "Users can select messages in accessible conversations"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.user_id = auth.uid() or c.is_public = true)
    )
  );
