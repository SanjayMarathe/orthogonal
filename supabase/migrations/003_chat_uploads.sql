-- Chat file uploads bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-uploads',
  'chat-uploads',
  false,
  5242880,
  array[
    'text/plain',
    'text/markdown',
    'text/csv',
    'text/html',
    'text/xml',
    'application/json',
    'application/csv',
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Owner: upload to own folder (first path segment = user id)
create policy "Chat uploads insert own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'chat-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Chat uploads select own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'chat-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Chat uploads delete own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'chat-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Shared conversation readers can download attachments referenced in public threads
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
