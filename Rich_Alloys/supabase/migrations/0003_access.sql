-- Rich Alloys purchase portal v2: access.
-- The anonymous key reads nothing. Logged-in staff read; writes follow the permissions table.
-- Money tables (payments, TDS, ledger confirmations) are readable only with 'money_view'.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from public, anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- reads
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public'
           and tablename not in ('payments','tds','ledger_confirmations','audit_log') loop
    execute format('create policy staff_read on public.%I for select to authenticated using (public.is_staff())', t);
  end loop;
  foreach t in array array['payments','tds','ledger_confirmations'] loop
    execute format('create policy money_read on public.%I for select to authenticated using (public.can(''money_view''))', t);
  end loop;
end $$;
create policy admin_read on audit_log for select to authenticated using (public.can('admin'));

-- writes: table -> action needed
do $$ declare r record; begin
  for r in select * from (values
      ('suppliers','deal_edit'), ('deals','deal_edit'), ('deal_lines','deal_edit'),
      ('invoices','inward_edit'), ('invoice_lines','inward_edit'), ('lots','inward_edit'), ('lot_lines','inward_edit'),
      ('returns','inward_edit'), ('sorting_lines','sorting_edit'),
      ('payments','payment_enter'), ('tds','tax_edit'),
      ('production_runs','production_edit'), ('production_lines','production_edit'),
      ('stock_moves','stock_edit'), ('stock_tally_checks','stock_edit'),
      ('items','admin'), ('grades','admin'), ('sort_categories','admin'), ('doc_types','admin'),
      ('plants','admin'), ('permissions','admin'), ('profiles','admin')
    ) as x(tbl, act) loop
    execute format('create policy can_insert on public.%I for insert to authenticated with check (public.can(%L))', r.tbl, r.act);
    execute format('create policy can_update on public.%I for update to authenticated using (public.can(%L)) with check (public.can(%L))', r.tbl, r.act, r.act);
    execute format('create policy can_delete on public.%I for delete to authenticated using (public.can(%L))', r.tbl, r.act);
  end loop;
end $$;
-- admins can also fix supplier terms
create policy admin_update on suppliers for update to authenticated using (public.can('admin')) with check (public.can('admin'));
-- payment terms on a lot can be set by whoever can set deal terms
create policy terms_update on lots for update to authenticated using (public.can('deal_edit')) with check (public.can('deal_edit'));

-- documents: any staff member uploads, as themselves, as 'uploaded'. Status moves only through functions.
create policy staff_upload on documents for insert to authenticated
  with check (public.is_staff() and uploaded_by = auth.uid() and status = 'uploaded'
              and verified_by is null and approved_by is null);

-- notes, note_lines, tally_marks, ledger_confirmations, audit_log: no write rules; functions only.
