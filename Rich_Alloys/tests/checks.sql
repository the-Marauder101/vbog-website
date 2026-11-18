-- Fails loudly if the system stops reproducing the Ogo documents or the access rules leak.
\set ON_ERROR_STOP 1
do $$
declare n numeric; t text; ok boolean;
  gate uuid := '00000000-0000-0000-0000-000000000001';
  facc uuid := '00000000-0000-0000-0000-000000000002';
  hoac uuid := '00000000-0000-0000-0000-000000000003';
  v_deal uuid; v_doc uuid;
begin
  -- ---- numbers ----
  select weight_short_kg into n from v_inward where grade='OC';  assert n = 14.350, 'OC weight short';
  select weight_short_kg into n from v_inward where grade='LAL'; assert n = 11.050, 'Lal weight short';
  select total into n from debit_notes where tally_dn_no='RAI/DN/26-27/114'; assert n = 38094.00,  'DN 114';
  select total into n from debit_notes where tally_dn_no='RAI/DN/26-27/115'; assert n = 31921.95,  'DN 115';
  select total into n from debit_notes where tally_dn_no='RAI/DN/26-27/116'; assert n = 257745.00, 'DN 116';
  select invoice_total - debit_notes into n from v_payable where deal_no='RA-082'; assert n = 14682999.40, 'invoice less DNs';
  select balance into n from v_payable where deal_no='RA-082'; assert n = 682999.40, 'balance after provisional';
  select kg_not_debited into n from v_sorting_exceptions; assert n = 18.700, 'mitti gap flagged';
  select count(*) into n from v_doc_gaps where deal_no='RA-082'; assert n = 4, 'four RA-side documents missing';

  -- ---- access ----
  select id into v_deal from deals where deal_no='RA-082';
  insert into profiles (id, full_name, role) values
    (gate,'Test gate','gate'), (facc,'Test factory accounts','factory_accounts'), (hoac,'Test HO accounts','ho_accounts');

  set local role anon;
  ok := false;
  begin perform count(*) from deals; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anonymous key has no access to tables';
  ok := false;
  begin perform count(*) from v_payable; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anonymous key has no access to views';

  set local role authenticated;

  perform set_config('request.jwt.claim.sub', '', true);            -- logged in, but no profile
  select count(*) into n from deals; assert n = 0, 'non-staff must see nothing';

  perform set_config('request.jwt.claim.sub', gate::text, true);    -- gate uploads
  select count(*) into n from deals; assert n = 1, 'staff can read deals';
  insert into documents (deal_id, doc_type, storage_path, uploaded_by)
    values (v_deal,'WEIGHBRIDGE_FACTORY','RA-082/WEIGHBRIDGE_FACTORY/test.jpg', gate) returning id into v_doc;

  ok := false;
  begin insert into documents (deal_id, doc_type, storage_path, uploaded_by, status)
        values (v_deal,'RECEIPT_PHOTOS','x', gate, 'approved');
  exception when others then ok := true; end;
  assert ok, 'upload cannot arrive pre-approved';

  ok := false;
  begin perform verify_document(v_doc); exception when others then ok := true; end;
  assert ok, 'gate cannot verify';

  update documents set status='approved' where id = v_doc;          -- direct edit must do nothing
  select status into t from documents where id = v_doc; assert t = 'uploaded', 'no direct status edits';

  perform set_config('request.jwt.claim.sub', facc::text, true);    -- factory accounts verifies
  perform verify_document(v_doc);
  ok := false;
  begin perform approve_document(v_doc); exception when others then ok := true; end;
  assert ok, 'factory accounts cannot approve';

  perform set_config('request.jwt.claim.sub', hoac::text, true);    -- HO accounts approves
  perform approve_document(v_doc);
  select status into t from documents where id = v_doc; assert t = 'approved', 'approved by HO accounts';

  ok := false;
  begin perform approve_dn((select id from invoices limit 1), 'weight_short', current_date, true);
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'DN approval is closed until its slice ships';

  reset role;
  select count(*) into n from storage.buckets where id = 'deal-docs' and not public; assert n = 1, 'private bucket exists';
  select count(*) into n from pg_policies where schemaname = 'storage' and tablename = 'objects'; assert n = 2, 'storage rules exist';
  select count(*) into n from doc_types where name_hi is null; assert n = 0, 'every document has a Hindi label';
  select count(*) into n from v_doc_gaps where deal_no='RA-082'; assert n = 3, 'gap closes on approval';
  raise exception 'ALL CHECKS PASSED (rolled back)' using errcode = 'P0001';
exception when sqlstate 'P0001' then
  raise notice '%', sqlerrm;
end $$;
