-- Fails loudly if the system stops reproducing the Ogo documents or the access rules leak.
\set ON_ERROR_STOP 1
do $$
declare n numeric; t text; ok boolean;
  gate uuid := '00000000-0000-0000-0000-000000000001';
  facc uuid := '00000000-0000-0000-0000-000000000002';
  hoac uuid := '00000000-0000-0000-0000-000000000003';
  v_deal uuid; v_doc uuid; v_inv uuid;
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
  begin insert into documents (deal_id, doc_type, storage_path, uploaded_by)
        values (v_deal,'WEIGHBRIDGE_FACTORY','RA-082/WEIGHBRIDGE_FACTORY/test.jpg', gate);
  exception when unique_violation then ok := true; end;
  assert ok, 'a retried upload cannot create a second row for the same file';

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
  assert ok, 'raw approve_dn stays closed; staff use approve_debit_note';

  -- ---- slices 2-5 (any active staff writes for now; HO accounts here) ----
  select invoice_id into v_inv from v_payable where deal_no = 'RA-082';
  select taxable_gap + gst_gap + total_gap into n from v_invoice_check where invoice_id = v_inv;
  assert n = 0, 'Ogo invoice arithmetic agrees with its lines';
  select balance into n from v_payable_by_supplier; assert n = 682999.40, 'supplier balance';
  select count(*) into n from v_tally_pending where kind = 'payment'; assert n = 1, 'provisional payment waits for Tally';
  select count(*) into n from v_tally_pending where kind = 'debit_note'; assert n = 0, 'booked DNs are not pending';
  select count(*) into n from v_double_payment; assert n = 0, 'no double payment yet';

  ok := false;
  begin update receipt_lines set factory_bag_kg = 0 where grade = 'OC';
  exception when others then ok := sqlerrm like '%frozen%'; end;
  assert ok, 'weights frozen while DNs stand';
  ok := false;
  begin update deals set status = 'closed' where id = v_deal;
  exception when others then ok := sqlerrm like '%has not reached the supplier%'; end;
  assert ok, 'deal with an undelivered return cannot close';
  update returns set delivered_on = '2026-11-08' where deal_id = v_deal;
  ok := false;
  begin update deals set status = 'closed' where id = v_deal;
  exception when others then ok := sqlerrm like '%balance%'; end;
  assert ok, 'deal with a balance cannot close';

  ok := false;
  begin perform approve_debit_note(v_inv, 'weight_short', true); exception when others then ok := true; end;
  assert ok, 'cannot approve a DN twice';
  ok := false;
  begin perform cancel_debit_note((select id from debit_notes where tally_dn_no = 'RAI/DN/26-27/114'), ' ');
  exception when others then ok := true; end;
  assert ok, 'cancel needs a reason';
  perform cancel_debit_note((select id from debit_notes where tally_dn_no = 'RAI/DN/26-27/114'), 'test re-approval');
  select debit_notes into n from v_payable where invoice_id = v_inv; assert n = 31921.95 + 257745.00, 'cancelled DN leaves the payable';
  perform approve_debit_note(v_inv, 'weight_short', true);
  select total into n from debit_notes where invoice_id = v_inv and dn_type = 'weight_short' and status = 'approved';
  assert n = 38094.00, 're-approved weight-short DN reproduces DN 114';
  perform set_dn_tally_no((select id from debit_notes where invoice_id = v_inv and dn_type = 'weight_short' and status = 'approved'), 'RAI/DN/TEST');
  select status into t from debit_notes where tally_dn_no = 'RAI/DN/TEST'; assert t = 'booked_in_tally', 'Tally number books the DN';

  insert into payments (deal_id, invoice_id, kind, amount, paid_on, bank_ref) values (v_deal, v_inv, 'final', 100, current_date, 'UTR1');
  insert into payments (deal_id, invoice_id, kind, amount, paid_on, bank_ref) values (v_deal, v_inv, 'final', 100, current_date, 'UTR1');
  select count(*) into n from v_double_payment where issue in ('same_bank_ref', 'same_amount_same_day'); assert n = 2, 'double payment flagged';
  select count(*) into n from audit_log where table_name = 'payments' and action = 'insert' and actor = hoac; assert n = 2, 'payments audited with actor';

  -- ---- staff ----
  perform set_config('request.jwt.claim.sub', gate::text, true);
  update profiles set role = 'vbog_admin' where id = gate;          -- nobody promotes themselves
  select role into t from profiles where id = gate; assert t = 'gate', 'no direct role edits';
  assert not can_manage_staff(), 'gate cannot manage staff';
  perform set_config('request.jwt.claim.sub', hoac::text, true);
  assert not can_manage_staff(), 'HO accounts cannot manage staff (placeholder)';

  reset role;
  insert into profiles (id, full_name, role) values ('00000000-0000-0000-0000-000000000004','Test admin','vbog_admin');
  update profiles set active = false where id = gate;               -- switched off
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
  assert can_manage_staff(), 'vbog_admin can manage staff';
  perform set_config('request.jwt.claim.sub', gate::text, true);
  select count(*) into n from deals; assert n = 0, 'switched-off staff see nothing';
  ok := false;
  begin insert into documents (deal_id, doc_type, storage_path, uploaded_by) values (v_deal,'RECEIPT_PHOTOS','y', gate);
  exception when others then ok := true; end;
  assert ok, 'switched-off staff cannot upload';

  reset role;
  select count(*) into n from storage.buckets where id = 'deal-docs' and not public; assert n = 1, 'private bucket exists';
  select count(*) into n from pg_policies where schemaname = 'storage' and tablename = 'objects'; assert n = 2, 'storage rules exist';
  select count(*) into n from doc_types where name_hi is null; assert n = 0, 'every document has a Hindi label';
  select count(*) into n from v_doc_gaps where deal_no='RA-082'; assert n = 3, 'gap closes on approval';
  raise exception 'ALL CHECKS PASSED (rolled back)' using errcode = 'P0001';
exception when sqlstate 'P0001' then
  raise notice '%', sqlerrm;
end $$;
