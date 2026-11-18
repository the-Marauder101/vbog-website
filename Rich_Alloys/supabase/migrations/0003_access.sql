-- Access rules for slice 1 (documents). Everything else stays service-role only
-- until its own slice ships.
-- Who may verify and who may approve is a PLACEHOLDER until Himanshu confirms.

create function my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() $$;

create function is_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid()) $$;

revoke execute on function approve_dn(uuid, text, date, boolean, uuid) from public, anon, authenticated;

revoke execute on function my_role(), is_staff() from public, anon;
grant execute on function my_role(), is_staff() to authenticated;

-- explicit grants: logged-in users only, never the anonymous key
do $$ declare t text; begin
  foreach t in array array['plants','profiles','suppliers','grades','sort_categories','deals','deal_lines','invoices','invoice_lines','receipts','receipt_lines','sorting_lines','debit_notes','debit_note_lines','returns','payments','deductions','doc_types','documents','audit_log'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    -- any logged-in staff member can read everything; writes need their own rule below
    execute format('create policy staff_read on public.%I for select to authenticated using (public.is_staff())', t);
  end loop;
  foreach t in array array['v_inward','v_dn_calc_lines','v_dn_calc','v_sorting_exceptions','v_payable','v_doc_gaps','v_tally_dn_export'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- deal desk: create and edit suppliers, deals and deal lines
create policy deal_desk_write on suppliers for all to authenticated
  using (my_role() in ('owner','deal_desk','ho_accounts','vbog_admin'))
  with check (my_role() in ('owner','deal_desk','ho_accounts','vbog_admin'));
create policy deal_desk_write on deals for all to authenticated
  using (my_role() in ('owner','deal_desk','ho_accounts','vbog_admin'))
  with check (my_role() in ('owner','deal_desk','ho_accounts','vbog_admin'));
create policy deal_desk_write on deal_lines for all to authenticated
  using (my_role() in ('owner','deal_desk','ho_accounts','vbog_admin'))
  with check (my_role() in ('owner','deal_desk','ho_accounts','vbog_admin'));

-- documents: any staff member can upload, always as themselves, always as 'uploaded'.
-- No update or delete policy: status only moves through the functions below.
create policy staff_upload on documents for insert to authenticated
  with check (is_staff() and uploaded_by = auth.uid() and status = 'uploaded'
              and verified_by is null and approved_by is null);

create function verify_document(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(my_role(),'') not in ('factory_accounts','ho_accounts','owner','vbog_admin') then
    raise exception 'Your role cannot verify documents';
  end if;
  update documents set status = 'verified', verified_by = auth.uid()
   where id = p_id and status = 'uploaded';
  if not found then raise exception 'Only an uploaded document can be verified'; end if;
  insert into audit_log (actor, table_name, row_id, action) values (auth.uid(), 'documents', p_id, 'verified');
end $$;

create function approve_document(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(my_role(),'') not in ('ho_accounts','owner','vbog_admin') then
    raise exception 'Your role cannot approve documents';
  end if;
  update documents set status = 'approved', approved_by = auth.uid()
   where id = p_id and status = 'verified';
  if not found then raise exception 'Only a verified document can be approved'; end if;
  insert into audit_log (actor, table_name, row_id, action) values (auth.uid(), 'documents', p_id, 'approved');
end $$;

create function reject_document(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(my_role(),'') not in ('factory_accounts','ho_accounts','owner','vbog_admin') then
    raise exception 'Your role cannot reject documents';
  end if;
  if nullif(trim(p_note), '') is null then raise exception 'A reason is required to reject'; end if;
  update documents set status = 'rejected', note = p_note
   where id = p_id and status in ('uploaded','verified');
  if not found then raise exception 'This document can no longer be rejected'; end if;
  insert into audit_log (actor, table_name, row_id, action, detail)
  values (auth.uid(), 'documents', p_id, 'rejected', jsonb_build_object('note', p_note));
end $$;

revoke execute on function verify_document(uuid), approve_document(uuid), reject_document(uuid, text) from public, anon;
grant execute on function verify_document(uuid), approve_document(uuid), reject_document(uuid, text) to authenticated;
