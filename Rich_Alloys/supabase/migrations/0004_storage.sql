-- Private bucket for deal documents: photos and PDFs up to 20 MB, read through short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('deal-docs', 'deal-docs', false, 20971520, array['image/*','application/pdf'])
on conflict (id) do nothing;

create policy deal_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'deal-docs' and public.is_staff());
create policy deal_docs_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'deal-docs' and public.is_staff());
