-- Fails loudly if the system stops reproducing the Ogo documents or the access rules leak.
\set ON_ERROR_STOP 1
do $$
declare n numeric; t text; ok boolean;
  gate uuid := '00000000-0000-0000-0000-000000000001';
  fac  uuid := '00000000-0000-0000-0000-000000000002';
  facc uuid := '00000000-0000-0000-0000-000000000003';
  hoac uuid := '00000000-0000-0000-0000-000000000004';
  own  uuid := '00000000-0000-0000-0000-000000000005';
  v_lot uuid; v_deal uuid; v_sup uuid; v_inv uuid; v_pay uuid; v_line uuid; v_deal2 uuid; v_lot2 uuid;
begin
  insert into profiles (id, full_name, role) values
    (gate,'Test gate','gate'), (fac,'Test factory','factory'), (facc,'Test factory accounts','factory_accounts'),
    (hoac,'Test HO accounts','ho_accounts'), (own,'Test owner','owner');
  perform set_config('request.jwt.claim.sub', own::text, true);   -- read the numbers as the owner
  select lot_id, deal_id, supplier_id, invoice_id into v_lot, v_deal, v_sup, v_inv from v_lots where deal_no = 'RA-082';

  -- ---- numbers (Ogo, PO/RA/082/26-27) ----
  select weight_short_kg into n from v_lot_lines where lot_id = v_lot and grade = 'OC';  assert n = 14.350, 'OC weight short';
  select weight_short_kg into n from v_lot_lines where lot_id = v_lot and grade = 'LAL'; assert n = 11.050, 'Lal weight short';
  select total into n from notes where tally_no = 'RAI/DN/26-27/114'; assert n = 38094.00,  'DN 114';
  select total into n from notes where tally_no = 'RAI/DN/26-27/115'; assert n = 31921.95,  'DN 115';
  select total into n from notes where tally_no = 'RAI/DN/26-27/116'; assert n = 257745.00, 'DN 116';
  select total - notes into n from v_payable where invoice_id = v_inv; assert n = 14682999.40, 'invoice less DNs';
  select balance into n from v_payable where invoice_id = v_inv; assert n = 682999.40, 'balance after reconciled payment';
  select balance into n from v_supplier_balance where supplier_id = v_sup; assert n = 682999.40, 'supplier ledger balance';
  select kg_not_debited into n from v_sorting_exceptions where lot_id = v_lot; assert n = 18.700, 'mitti gap flagged';
  select value_not_recovered into n from v_sorting_exceptions where lot_id = v_lot; assert n = 27229.44, 'mitti gap value';
  select count(*) into n from v_doc_gaps where deal_id = v_deal; assert n = 4, 'four factory-side documents missing';
  select closing into n from stock_summary('2026-10-01','2026-11-30') where item = 'COPPER_SCRAP';
  assert n = 9757.200, 'stock = billed 9957.900 less weight short 25.400 less returned 175.300';
  select sum(amount) into n from v_cash_plan where deal_id = v_deal; assert n = 682999.40, 'cash still needed for Ogo';
  select bool_and(terms_missing) into ok from v_cash_plan where deal_id = v_deal; assert ok, 'missing terms are flagged';
  select stage into t from v_lots where lot_id = v_lot; assert t = 'tally_pending', 'office Tally not yet marked';

  -- ---- terms and incoming deals (cash plan) ----
  update suppliers set provisional_pct = 90, provisional_days = 0, balance_days = 20 where id = v_sup;
  select count(*) into n from v_cash_plan where deal_id = v_deal and tranche = 'balance' and due_date = '2026-11-12';
  assert n = 1, 'balance due 20 days after invoice';
  update suppliers set provisional_pct = null, provisional_days = null, balance_days = null where id = v_sup;

  -- ---- access ----
  select id into v_line from lot_lines where lot_id = v_lot and grade = 'OC';

  set local role anon;
  ok := false; begin perform count(*) from deals; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon: no tables';
  ok := false; begin perform count(*) from v_payable; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon: no views';

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '', true);
  select count(*) into n from deals; assert n = 0, 'no profile: sees nothing';

  perform set_config('request.jwt.claim.sub', gate::text, true);
  select count(*) into n from deals; assert n = 1, 'gate reads deals';
  select count(*) into n from payments; assert n = 0, 'gate cannot see payments';
  select count(*) into n from v_cash_plan; assert n = 0, 'gate cannot see cash plan';
  ok := false; begin insert into sorting_lines (lot_line_id, category, sorted_kg, action, dn_kg) values (v_line,'IRON',1,'return',1);
  exception when others then ok := true; end;
  assert ok, 'gate cannot enter sorting';

  perform set_config('request.jwt.claim.sub', fac::text, true);
  ok := false; begin insert into sorting_lines (lot_line_id, category, sorted_kg, action, dn_kg) values (v_line,'IRON',1,'return',1);
  exception when others then ok := sqlerrm like '%closed%'; end;
  assert ok, 'closed lot refuses sorting';
  ok := false; begin insert into sort_categories (code, name, default_action) values ('BRASS','Brass','return');
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'factory cannot edit categories';
  ok := false; begin perform approve_dn(v_lot, 'weight_short', current_date, true); exception when insufficient_privilege then ok := true; end;
  assert ok, 'factory cannot approve DNs';
  ok := false; begin update lot_lines set factory_bag_kg = 0 where id = v_line; exception when others then ok := sqlerrm like '%Debit notes%'; end;
  assert ok, 'weights locked once DNs exist';
  perform set_config('request.jwt.claim.sub', gate::text, true);
  update lot_lines set factory_bag_kg = 0 where id = v_line;
  perform set_config('request.jwt.claim.sub', own::text, true);
  select factory_bag_kg into n from lot_lines where id = v_line; assert n = 24.700, 'gate cannot change weights';

  -- new deal and lot, the way the app does it
  perform set_config('request.jwt.claim.sub', facc::text, true);
  v_deal2 := create_deal(jsonb_build_object('supplier_id', v_sup, 'expected_date', current_date + 3,
              'lines', jsonb_build_array(jsonb_build_object('grade','OC','qty_kg',1000,'rate_per_kg',1000))));
  select count(*) into n from v_deals_incoming where deal_id = v_deal2; assert n = 1, 'new deal is incoming';
  select remaining_value into n from v_deals_incoming where deal_id = v_deal2; assert n = 1180000.00, 'incoming value incl. GST';
  v_lot2 := create_lot(jsonb_build_object('deal_id', v_deal2, 'invoice_no','T-1', 'completes_deal', true,
              'lines', jsonb_build_array(jsonb_build_object('grade','OC','billed_net_kg',1000,'billed_rate',1000,
                       'factory_gross_kg',1005,'bag_count',10,'factory_bag_kg',10))));
  select weight_short_kg into n from v_lot_lines where lot_id = v_lot2; assert n = 5, 'weight short on new lot';
  select stage into t from v_lots where lot_id = v_lot2; assert t = 'received', 'new lot starts as received';
  perform set_config('request.jwt.claim.sub', gate::text, true);
  select stage into t from v_lots where lot_id = v_lot; assert t = 'tally_pending', 'gate sees stage without amounts';
  select balance into n from v_lots where lot_id = v_lot; assert n = 0, 'gate sees no balance';
  perform set_config('request.jwt.claim.sub', facc::text, true);
  ok := false; begin perform approve_dn(v_lot2, 'return', current_date, true); exception when others then ok := true; end;
  assert ok, 'no return DN before sorting closes';
  perform approve_dn(v_lot2, 'weight_short', current_date, true);
  select total into n from notes where lot_id = v_lot2; assert n = 5900, 'weight short DN on new lot';

  -- Tally ticks remember the amount; a change afterwards asks for a correction in Tally
  select count(*) into n from v_tally_queue where state = 'pending' and book = 'factory' and lot_id = v_lot2; assert n = 2, 'invoice and DN waiting for factory Tally';
  perform mark_tally('note', (select id from notes where lot_id = v_lot2), 'factory', 'DN-9');
  select count(*) into n from v_tally_changes; assert n = 0, 'fresh tick is clean';
  perform cancel_note((select id from notes where lot_id = v_lot2), 'test reversal');
  select count(*) into n from v_tally_queue where state = 'changed' and book = 'factory'; assert n = 1, 'cancelled DN shows as changed after entry';
  perform clear_tally_change((select mark_id from v_tally_changes limit 1));
  select count(*) into n from v_tally_changes; assert n = 0, 'cleared once reversed in Tally';
  perform approve_dn(v_lot2, 'weight_short', current_date, true);
  select count(*) into n from v_invoice_register where lot_id = v_lot2 and not in_factory and not has_scan; assert n = 1, 'invoice register shows gaps';

  -- TDS recorded with a payment reduces what is owed
  insert into tds (invoice_id, section, amount) values ((select invoice_id from lots where id = v_lot2), '194Q', 1000);
  select balance into n from v_payable where invoice_id = (select invoice_id from lots where id = v_lot2);
  assert n = 1180000.00 - 5900 - 1000, 'TDS reduces the balance';

  -- payments: anyone allowed enters, Niti reconciles
  insert into payments (supplier_id, invoice_id, amount, paid_on, status) values (v_sup, v_inv, 100, current_date, 'reconciled') returning id into v_pay;
  select status into t from payments where id = v_pay; assert t = 'entered', 'new payments always wait for reconciliation';
  ok := false; begin perform reconcile_payment(v_pay); exception when insufficient_privilege then ok := true; end;
  assert ok, 'factory accounts cannot reconcile';
  ok := false; begin perform mark_tally('payment', v_pay, 'office', null); exception when insufficient_privilege then ok := true; end;
  assert ok, 'factory accounts cannot tick office Tally';

  perform set_config('request.jwt.claim.sub', hoac::text, true);
  perform reject_payment(v_pay, 'Amount differs from bank statement');
  perform set_config('request.jwt.claim.sub', facc::text, true);
  update payments set amount = 120 where id = v_pay;
  select status into t from payments where id = v_pay; assert t = 'entered', 'corrected payment goes back for reconciliation';
  perform set_config('request.jwt.claim.sub', hoac::text, true);
  perform reconcile_payment(v_pay);
  ok := false; begin update payments set amount = 1 where id = v_pay; exception when others then ok := sqlerrm like '%reconciled%'; end;
  assert ok, 'reconciled payment is frozen';
  select confirm_ledger(v_sup, current_date, 0, null) into n;
  select portal_balance into n from ledger_confirmations order by confirmed_at desc limit 1;
  assert n = 682999.40 + 1180000.00 - 5900 - 1000 - 120, 'ledger snapshot: Ogo balance + new invoice - its DN - TDS - reconciled payment';

  -- GSTR-2B is off by default
  ok := false; begin perform import_gstr2b('{"period":"2026-10","lines":[{"supplier_gstin":"X","doc_no":"1"}]}'::jsonb);
  exception when insufficient_privilege then ok := true; end;
  assert ok, '2B upload is off until switched on';
  -- switched on for HO accounts by the owner: matches by GSTIN + invoice number, ignoring punctuation
  perform set_config('request.jwt.claim.sub', own::text, true);
  insert into permissions (action, role) values ('gst_2b', 'ho_accounts');
  perform set_config('request.jwt.claim.sub', hoac::text, true);
  select import_gstr2b(jsonb_build_object('period','2026-10','file_name','test.json','lines', jsonb_build_array(
    jsonb_build_object('supplier_gstin','36aaeco5492p1zo','doc_type','invoice','doc_no','OGO-ES/15','doc_date','2026-10-23','taxable',12720983.35,'tax',2289777,'total',15010760.35),
    jsonb_build_object('supplier_gstin','27AAAAA0000A1Z5','supplier_name','Power company','doc_type','invoice','doc_no','E-1','total',5000)))) into t;
  select in_2b and gstr2b_period = '2026-10' into ok from invoices where id = v_inv; assert ok, '2B match ticks the invoice';
  select count(*) into n from v_gstr2b_recon where status = 'not_in_portal'; assert n = 1, 'unmatched 2B line listed';
  select difference into n from v_gstr2b_recon where status = 'matched' and invoice_id = v_inv; assert n = 0, 'amounts agree';
  select import_gstr2b(jsonb_build_object('period','2026-10','lines', jsonb_build_array(
    jsonb_build_object('supplier_gstin','27AAAAA0000A1Z5','doc_no','E-1','total',5000)))) into t;
  select in_2b into ok from invoices where id = v_inv; assert not ok, 're-upload of a month replaces its ticks';

  -- admin: owner adds a sorting category
  perform set_config('request.jwt.claim.sub', own::text, true);
  insert into sort_categories (code, name, default_action) values ('BRASS','Brass','return');
  update sort_categories set active = false where code = 'BRASS';
  ok := false; begin update profiles set role = 'gate' where id = own; exception when others then ok := true; end;
  assert ok, 'owner cannot demote themselves';

  -- staff management and upload retries (0007)
  assert can('staff_manage'), 'owner manages staff';
  perform set_config('request.jwt.claim.sub', hoac::text, true);
  assert not can('staff_manage'), 'HO accounts cannot manage staff';
  perform set_config('request.jwt.claim.sub', gate::text, true);
  assert not can('staff_manage'), 'gate cannot manage staff';
  ok := false; begin update profiles set role = 'owner' where id = gate; exception when others then ok := true; end;
  select role into t from profiles where id = gate; assert t = 'gate', 'nobody promotes themselves';
  insert into documents (deal_id, doc_type, storage_path, uploaded_by) values (v_deal, 'RECEIPT_PHOTOS', 'RA-082/RECEIPT_PHOTOS/retry.jpg', gate);
  ok := false;
  begin insert into documents (deal_id, doc_type, storage_path, uploaded_by) values (v_deal, 'RECEIPT_PHOTOS', 'RA-082/RECEIPT_PHOTOS/retry.jpg', gate);
  exception when unique_violation then ok := true; end;
  assert ok, 'a retried upload cannot create a second row for the same file';

  reset role;
  select count(*) into n from storage.buckets where id = 'deal-docs' and not public; assert n = 1, 'private bucket exists';
  select count(*) into n from pg_policies where schemaname = 'storage' and tablename = 'objects'; assert n = 2, 'storage rules exist';
  select count(*) into n from doc_types where name_hi is null; assert n = 0, 'every document has a Hindi label';
  select count(*) into n from audit_log where table_name = 'sort_categories'; assert n >= 2, 'master changes are audited';
  select count(*) into n from information_schema.columns where table_name = 'profiles' and column_name in ('email','created_at');
  assert n = 2, 'profiles carry login email and created date';
  raise exception 'ALL CHECKS PASSED (rolled back)' using errcode = 'RA000';
exception when sqlstate 'RA000' then
  raise notice '%', sqlerrm;
end $$;
