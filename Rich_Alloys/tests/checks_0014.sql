-- Payment hold alerts, TDS kinds, lot register, supplier onboarding and reminders, PO after booking,
-- production start/close and the stock position (migration 0014).
\set ON_ERROR_STOP 1
do $$
declare n numeric; t text; d date; ok boolean; r record;
  facc uuid := '00000000-0000-0000-0000-0000000000f1';   -- Tinu
  own  uuid := '00000000-0000-0000-0000-0000000000f2';   -- Himanshu
  fac  uuid := '00000000-0000-0000-0000-0000000000f3';   -- Sanjay
  v_sup uuid; v_ogo uuid; v_ogo_inv uuid; v_deal uuid; v_deal2 uuid; v_lot uuid; v_inv uuid; v_rem uuid; v_run uuid; v_scrap numeric;
begin
  insert into profiles (id, full_name, role) values (facc, 'Tinu', 'factory_accounts'), (own, 'Himanshu', 'owner'), (fac, 'Sanjay', 'factory');
  select lot_id, supplier_id, invoice_id into v_ogo, v_sup, v_ogo_inv from v_lots where deal_no = 'RA-082';
  perform set_config('request.jwt.claim.sub', own::text, true);

  -- ---- lot register: Ogo in one row ----
  select * into r from v_lot_register where lot_id = v_ogo;
  assert r.invoice_total - r.dn_total = 14682999.40 and r.balance = 682999.40, 'Ogo: invoice less DNs, balance';
  assert r.dn_weight_short + r.dn_quality + r.dn_return + r.dn_price = r.dn_total, 'debit notes add up by type';
  assert r.supplier like 'Ogo%' and r.billed_kg > 0 and r.invoice_rates like '%OC%', 'supplier, weights, rates';
  perform set_config('request.jwt.claim.sub', fac::text, true);
  select invoice_total, balance into r from v_lot_register where lot_id = v_ogo;
  assert r.invoice_total is null and r.balance is null, 'Sanjay sees the lot but no money';

  -- ---- PO after booking ----
  perform set_config('request.jwt.claim.sub', own::text, true);
  select po_issued_at is not null into ok from deals where deal_no = 'RA-082'; assert ok, 'Ogo PO counts as issued';
  assert suggest_po_no() = 'PO/RA/083/' || to_char(case when extract(month from current_date) >= 4 then current_date else current_date - interval '1 year' end, 'YY')
                              || '-' || to_char(case when extract(month from current_date) >= 4 then current_date + interval '1 year' else current_date end, 'YY'),
    'next PO number follows PO/RA/082';
  v_deal := create_deal(jsonb_build_object('supplier_id', v_sup, 'expected_date', current_date + 5,
    'lines', jsonb_build_array(jsonb_build_object('grade', 'OC', 'qty_kg', 4000, 'rate_per_kg', 1200))));
  select count(*) into n from v_tasks where kind = 'po_missing' and ref_id = v_deal; assert n = 1, 'booked: PO to issue';
  t := issue_po(v_deal); assert t like 'PO/RA/083/%', 'first PO 083';
  select count(*) into n from v_tasks where kind = 'po_missing' and ref_id = v_deal; assert n = 0, 'PO issued: off the list';
  t := issue_po(v_deal); assert t like 'PO/RA/083/%', 'reissue keeps the number';
  select po_revision into n from deals where id = v_deal; assert n = 2, 'revision 2';
  v_deal2 := create_deal(jsonb_build_object('supplier_id', v_sup, 'lines', jsonb_build_array(jsonb_build_object('grade', 'LAL', 'qty_kg', 1000, 'rate_per_kg', 1300))));
  ok := false; begin perform issue_po(v_deal2, t); exception when others then ok := sqlerrm like '%already used%'; end;
  assert ok, 'a PO number is used once';
  perform set_config('request.jwt.claim.sub', fac::text, true);
  ok := false; begin perform issue_po(v_deal2); exception when insufficient_privilege then ok := true; end;
  assert ok, 'Sanjay cannot issue POs';

  -- ---- payment hold: pay 90%, hold 10% for 15 days ----
  perform set_config('request.jwt.claim.sub', own::text, true);
  update suppliers set hold_pct = 10, hold_days = 15 where id = v_sup;
  perform set_config('request.jwt.claim.sub', facc::text, true);
  v_lot := create_lot(jsonb_build_object('deal_id', v_deal, 'invoice_no', 'H-1', 'invoice_date', current_date - 30, 'received_on', current_date - 30,
    'lines', jsonb_build_array(jsonb_build_object('grade', 'OC', 'billed_net_kg', 1000, 'billed_rate', 1200, 'factory_gross_kg', 1000))));
  select invoice_id into v_inv from lots where id = v_lot;
  perform set_config('request.jwt.claim.sub', own::text, true);
  select * into r from v_payment_holds where scope = 'lot' and ref_id = v_lot;
  assert r.net = 1416000 and r.pay_limit = 1274400 and r.status = 'paying' and r.can_pay_now = 1274400, 'limit 90% of 14,16,000';
  insert into payments (supplier_id, invoice_id, amount, paid_on) values (v_sup, v_inv, 700000, current_date - 25);
  select status into t from v_payment_holds where ref_id = v_lot; assert t = 'paying', 'half paid: keep paying';
  insert into payments (supplier_id, invoice_id, amount, paid_on) values (v_sup, v_inv, 574400, current_date - 5);
  select * into r from v_payment_holds where ref_id = v_lot;
  assert r.status = 'holding' and r.reached_on = current_date - 5 and r.release_on = current_date + 10 and r.held = 141600, 'reached: hold 1,41,600 for 15 days';
  select count(*) into n from v_tasks where kind = 'hold_reached' and ref_id = v_lot; assert n = 1, 'alert 1: limit reached';
  perform set_config('request.jwt.claim.sub', fac::text, true);
  select count(*) into n from v_tasks where kind like 'hold%'; assert n = 0, 'not on Sanjay''s list';
  perform set_config('request.jwt.claim.sub', own::text, true);
  perform ack_payment_hold('lot', v_lot);
  select count(*) into n from v_tasks where kind = 'hold_reached' and ref_id = v_lot; assert n = 0, 'acknowledged';
  insert into payments (supplier_id, invoice_id, amount, paid_on) values (v_sup, v_inv, 1000, current_date);
  select over_limit into ok from v_payment_holds where ref_id = v_lot; assert ok, 'paying into the held part is flagged';
  -- the limit was reached 20 days ago: the balance is due
  update payments set paid_on = current_date - 20 where invoice_id = v_inv and amount = 574400;
  select status, release_on into r from v_payment_holds where ref_id = v_lot;
  assert r.status = 'release_due' and r.release_on = current_date - 5, 'released 5 days ago';
  select amount into n from v_tasks where kind = 'hold_release' and ref_id = v_lot; assert n = 140600, 'alert 2: pay the held 1,40,600';
  insert into payments (supplier_id, invoice_id, amount, paid_on) values (v_sup, v_inv, 140600, current_date);
  select status into t from v_payment_holds where ref_id = v_lot; assert t = 'cleared', 'paid in full';
  -- a lot can have its own figure
  update lots set hold_pct = 20 where id = v_lot;
  select pay_limit into n from v_payment_holds where ref_id = v_lot; assert n = 1132800, 'lot override: 80%';
  -- the supplier overall
  update suppliers set hold_scope = 'supplier' where id = v_sup;
  select count(*) into n from v_payment_holds where scope = 'lot' and supplier_id = v_sup; assert n = 0, 'overall: no per-lot rows';
  select * into r from v_payment_holds where scope = 'supplier' and ref_id = v_sup;
  assert r.net = 14682999.40 + 1416000 and r.pay_limit = round((14682999.40 + 1416000) * 0.9, 2), 'overall limit across all bills';
  update suppliers set hold_scope = 'lot', hold_pct = null, hold_days = null where id = v_sup;

  -- ---- TDS: income tax and GST apart ----
  insert into tds (invoice_id, section, amount, kind) values (v_inv, '194Q', 1200, 'it'), (v_inv, '51', 240, 'gst');
  select tds_it, tds_gst into r from v_lot_register where lot_id = v_lot; assert r.tds_it = 1200 and r.tds_gst = 240, 'both TDS columns';

  -- ---- onboarding ----
  select count(*) into n from v_tasks where kind = 'supplier_onboard' and ref_id = v_sup; assert n = 1, 'Ogo not onboarded yet';
  insert into onboarding_steps (code, name, sort) values ('KYC', 'KYC documents', 1), ('VISIT', 'Site visit', 2);
  ok := false; begin perform set_supplier_onboarded(v_sup, true); exception when others then ok := sqlerrm like '%KYC documents, Site visit%'; end;
  assert ok, 'steps still to do are named';
  perform set_onboarding_step(v_sup, 'KYC', true, 'PAN, GST, cheque');
  perform set_onboarding_step(v_sup, 'VISIT', true);
  perform set_supplier_onboarded(v_sup, true);
  select count(*) into n from v_tasks where kind = 'supplier_onboard' and ref_id = v_sup; assert n = 0, 'onboarded';
  perform set_config('request.jwt.claim.sub', fac::text, true);
  ok := false; begin perform set_onboarding_step(v_sup, 'KYC', false); exception when insufficient_privilege then ok := true; end;
  assert ok, 'Sanjay cannot change onboarding';

  -- ---- reminders ----
  perform set_config('request.jwt.claim.sub', own::text, true);
  insert into reminders (supplier_id, title, every_n, every_unit, next_due) values (v_sup, 'Renew KYC', 1, 'month', current_date - 65)
  returning id into v_rem;
  select count(*) into n from v_tasks where kind = 'reminder_due' and ref_id = v_rem; assert n = 1, 'due: on Himanshu''s list';
  perform set_config('request.jwt.claim.sub', facc::text, true);
  select count(*) into n from v_tasks where kind = 'reminder_due'; assert n = 0, 'not on Tinu''s list';
  perform set_config('request.jwt.claim.sub', own::text, true);
  d := complete_reminder(v_rem, 'Done');
  assert d > current_date and d <= (current_date + interval '1 month')::date, 'next date moves past today';
  select count(*) into n from reminder_log where reminder_id = v_rem; assert n = 1, 'logged';
  select count(*) into n from v_tasks where kind = 'reminder_due' and ref_id = v_rem; assert n = 0, 'off the list until next time';

  -- ---- production started, then closed; stock position ----
  select in_factory into v_scrap from v_stock_position where item = 'COPPER_SCRAP';
  select booked into n from v_stock_position where item = 'COPPER_SCRAP'; assert n >= 3000, 'booked kg still to come (4,000 less 1,000)';
  perform set_config('request.jwt.claim.sub', fac::text, true);
  v_run := save_production(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item', 'COPPER_SCRAP', 'direction', 'consumed', 'kg', 500))));
  select status into t from production_runs where id = v_run; assert t = 'open', 'only used: still in production';
  select in_factory, in_production into r from v_stock_position where item = 'COPPER_SCRAP';
  assert r.in_factory = v_scrap - 500 and r.in_production = 500, '500 kg out of stock, into the furnace';
  perform close_production(v_run, jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item', 'COPPER_INGOT', 'kg', 470))));
  select status into t from production_runs where id = v_run; assert t = 'closed', 'closed';
  select in_production into n from v_stock_position where item = 'COPPER_SCRAP'; assert coalesce(n, 0) = 0, 'nothing in the furnace';
  select yield_pct into n from v_production_runs where id = v_run; assert n = 94, 'yield 94%';
  ok := false; begin perform close_production(v_run, '{"lines":[{"item":"COPPER_INGOT","kg":1}]}'); exception when others then ok := sqlerrm like '%already closed%'; end;
  assert ok, 'closes once';

  raise exception '0014 CHECKS PASSED (rolled back)' using errcode = 'RA000';
exception when sqlstate 'RA000' then
  raise notice '%', sqlerrm;
end $$;
