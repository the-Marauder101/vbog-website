-- Rates on the deal with history; every invoice rate difference decided (migration 0012).
\set ON_ERROR_STOP 1
do $$
declare n numeric; t text; ok boolean; r record;
  facc uuid := '00000000-0000-0000-0000-0000000000e1';   -- Tinu
  own  uuid := '00000000-0000-0000-0000-0000000000e2';   -- Himanshu
  fac  uuid := '00000000-0000-0000-0000-0000000000e3';   -- Sanjay
  v_dom uuid; v_deal uuid; v_lot1 uuid; v_lot2 uuid; v_lot3 uuid; v_inv uuid;
begin
  insert into profiles (id, full_name, role) values (facc, 'Tinu', 'factory_accounts'), (own, 'Himanshu', 'owner'), (fac, 'Sanjay', 'factory');
  select supplier_id into v_dom from v_lots where deal_no = 'RA-082';
  perform set_config('request.jwt.claim.sub', own::text, true);
  select count(*) into n from v_price_diffs where deal_no = 'RA-082'; assert n = 0, 'Ogo was invoiced at the agreed rates';

  -- one call, two materials, tentative rates
  v_deal := create_deal(jsonb_build_object('supplier_id', v_dom, 'expected_date', current_date,
    'lines', jsonb_build_array(jsonb_build_object('grade', 'OC', 'qty_kg', 4000, 'rate_per_kg', 1200),
                               jsonb_build_object('grade', 'LAL', 'qty_kg', 1000, 'rate_per_kg', 1300))));
  select count(*) into n from deal_rate_history where deal_id = v_deal and source = 'booked'; assert n = 2, 'booking recorded per grade';

  -- truck 1: OC invoiced at 1,250 (50 over), Lal at the agreed 1,300
  perform set_config('request.jwt.claim.sub', facc::text, true);
  v_lot1 := create_lot(jsonb_build_object('deal_id', v_deal, 'invoice_no', 'P-1', 'lines', jsonb_build_array(
    jsonb_build_object('grade', 'OC', 'billed_net_kg', 2000, 'billed_rate', 1250, 'factory_gross_kg', 2000),
    jsonb_build_object('grade', 'LAL', 'billed_net_kg', 1000, 'billed_rate', 1300, 'factory_gross_kg', 1000))));
  select * into r from v_price_diffs where lot_id = v_lot1;
  assert r.grade = 'OC' and r.direction = 'over' and r.status = 'open' and r.amount = 100000 and r.total = 118000,
    'OC flagged: 2,000 kg x 50 = 1,00,000 + 18% GST';
  select count(*) into n from v_price_diffs where lot_id = v_lot1; assert n = 1, 'Lal matches: not flagged';
  select stage into t from v_lots where lot_id = v_lot1; assert t <> 'settled', 'an open difference keeps the lot from settling';
  select count(*) into n from v_tasks where kind = 'price_decide' and ref_id = v_lot1; assert n = 1, 'on Tinu''s list';
  perform set_config('request.jwt.claim.sub', fac::text, true);
  select count(*) into n from v_tasks where kind = 'price_decide'; assert n = 0, 'not on Sanjay''s list';
  ok := false; begin perform decide_price(v_lot1, 'keep_agreed'); exception when insufficient_privilege then ok := true; end;
  assert ok, 'Sanjay cannot decide prices';
  ok := false; begin perform set_deal_rate(v_deal, 'OC', 1, null); exception when insufficient_privilege then ok := true; end;
  assert ok, 'Sanjay cannot change rates';

  -- Tinu keeps the agreed rate: a price debit note for the excess, approvable before sorting
  perform set_config('request.jwt.claim.sub', facc::text, true);
  perform decide_price(v_lot1, 'keep_agreed');
  select status into t from v_price_diffs where lot_id = v_lot1; assert t = 'kept_agreed', 'decided';
  perform approve_dn(v_lot1, 'price_diff', current_date, true);
  select total, (select sum(stock_kg) from note_lines where note_id = notes.id) as kg into r from notes where lot_id = v_lot1 and dn_type = 'price_diff';
  assert r.total = 118000 and r.kg = 0, 'price debit note 1,18,000; no stock effect';
  perform set_config('request.jwt.claim.sub', own::text, true);
  select balance into n from v_payable where invoice_id = (select invoice_id from lots where id = v_lot1);
  assert n = (2000 * 1250 + 1000 * 1300) * 1.18 - 118000, 'owed at the agreed rate';

  -- truck 2: OC again at 1,250; Himanshu accepts (he agreed it on the phone)
  perform set_config('request.jwt.claim.sub', facc::text, true);
  v_lot2 := create_lot(jsonb_build_object('deal_id', v_deal, 'invoice_no', 'P-2', 'lines', jsonb_build_array(
    jsonb_build_object('grade', 'OC', 'billed_net_kg', 1000, 'billed_rate', 1250, 'factory_gross_kg', 1000))));
  perform set_config('request.jwt.claim.sub', own::text, true);
  perform decide_price(v_lot2, 'accept_invoice');
  select rate_per_kg into n from deal_lines where deal_id = v_deal and grade = 'OC'; assert n = 1250, 'deal now at the invoice rate';
  select count(*) into n from v_price_diffs where lot_id = v_lot2; assert n = 0, 'truck 2: no difference left';
  select source, old_rate, new_rate, lot_id into r from deal_rate_history where deal_id = v_deal and grade = 'OC' order by changed_at desc limit 1;
  assert r.source = 'accepted_invoice' and r.old_rate = 1200 and r.new_rate = 1250 and r.lot_id = v_lot2, 'history: 1,200 -> 1,250, from truck 2';
  select agreed_rate, status into r from v_price_diffs where lot_id = v_lot1;
  assert r.agreed_rate = 1200 and r.status = 'kept_agreed', 'truck 1 (settled) keeps 1,200 and its decision';

  -- truck 3: under-billed at 1,240; kept at the agreed 1,250: flagged, decided, nothing debited
  perform set_config('request.jwt.claim.sub', facc::text, true);
  v_lot3 := create_lot(jsonb_build_object('deal_id', v_deal, 'invoice_no', 'P-3', 'lines', jsonb_build_array(
    jsonb_build_object('grade', 'OC', 'billed_net_kg', 1000, 'billed_rate', 1240, 'factory_gross_kg', 1000))));
  select direction into t from v_price_diffs where lot_id = v_lot3; assert t = 'under', 'under-billing is flagged too';
  perform decide_price(v_lot3, 'keep_agreed');
  select count(*) into n from v_dn_calc where lot_id = v_lot3 and dn_type = 'price_diff'; assert n = 0, 'no debit note for under-billing';

  -- a direct rate change, with a note, is in the history
  perform set_deal_rate(v_deal, 'LAL', 1310, 'Revised on call');
  select note, changed_by into r from deal_rate_history where deal_id = v_deal and grade = 'LAL' order by changed_at desc limit 1;
  assert r.note = 'Revised on call' and r.changed_by = facc, 'who and why recorded';
  select deal_rate into n from v_lot_lines where lot_id = v_lot1 and grade = 'LAL'; assert n = 1300, 'settled truck 1 keeps Lal at 1,300';
  ok := false; begin perform decide_price(v_lot1, 'keep_agreed'); exception when others then ok := sqlerrm like '%Nothing to decide%'; end;
  assert ok, 'nothing left to decide on truck 1';

  raise exception 'PRICE CHECKS PASSED (rolled back)' using errcode = 'RA000';
exception when sqlstate 'RA000' then
  raise notice '%', sqlerrm;
end $$;
