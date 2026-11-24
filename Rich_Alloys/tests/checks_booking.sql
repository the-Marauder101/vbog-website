-- Bookings and unbooked trucks (migration 0011). Runs on Ogo data plus the 1 Nov opening.
\set ON_ERROR_STOP 1
do $$
declare n numeric; t text; ok boolean; r record;
  facc uuid := '00000000-0000-0000-0000-0000000000d1';
  own  uuid := '00000000-0000-0000-0000-0000000000d2';
  v_lot uuid; v_deal uuid; v_inv uuid; v_dom uuid; v_branch uuid; v_late uuid;
begin
  insert into profiles (id, full_name, role) values (facc, 'Test factory accounts', 'factory_accounts'), (own, 'Test owner', 'owner');
  update suppliers set onboarded_at = now() where supplier_type = 'domestic';   -- booking needs an onboarded supplier (0015)
  select supplier_id into v_dom from v_lots where deal_no = 'RA-082';
  insert into suppliers (name, supplier_type) values ('Test branch', 'branch') returning id into v_branch;

  -- Tinu records a truck nobody booked: new supplier, rate from the invoice
  perform set_config('request.jwt.claim.sub', facc::text, true);
  v_lot := create_unbooked_lot(jsonb_build_object('supplier_name', 'Test unbooked supplier', 'supplier_gstin', '27aaaaa0000a1z5',
    'gst_rate', 18, 'invoice_no', 'UB-1', 'received_on', current_date,
    'lines', jsonb_build_array(jsonb_build_object('grade', 'OC', 'billed_net_kg', 1000, 'billed_rate', 1200,
                                                  'factory_gross_kg', 995, 'factory_bag_kg', 0))));
  select deal_id, invoice_id into v_deal, v_inv from lots where id = v_lot;
  select unbooked, rate_confirmed_at, receiving_complete into r from deals where id = v_deal;
  assert r.unbooked and r.rate_confirmed_at is null and r.receiving_complete, 'unbooked deal made from the truck, nothing more expected';
  select total, doc_kind into r from invoices where id = v_inv;
  assert r.total = 1416000 and r.doc_kind = 'tax_invoice', 'tax invoice from weights x invoice rate + 18% GST';
  select string_agg(book, ',' order by book) into t from v_tally_missing where entity = 'invoice' and entity_id = v_inv;
  assert t = 'factory,office', 'an unbooked truck goes to both Tally queues like any purchase';
  select count(*) into n from v_tasks where kind = 'rate_confirm'; assert n = 0, 'Tinu is not asked to confirm the rate';
  ok := false; begin perform confirm_deal_rate(v_deal, null); exception when insufficient_privilege then ok := true; end;
  assert ok, 'factory accounts cannot confirm a rate';
  ok := false;
  begin perform create_unbooked_lot(jsonb_build_object('supplier_id', v_branch, 'invoice_no', 'X',
    'lines', jsonb_build_array(jsonb_build_object('grade', 'OC', 'billed_net_kg', 1, 'billed_rate', 1, 'factory_gross_kg', 1))));
  exception when others then ok := sqlerrm like '%its own form%'; end;
  assert ok, 'branch, import and job work use their own form';

  -- Himanshu sees it, money and all
  perform set_config('request.jwt.claim.sub', own::text, true);
  select balance into n from v_payable where invoice_id = v_inv; assert n = 1416000, 'unbooked truck is owed like any purchase';
  select count(*) into n from v_tasks where kind = 'rate_confirm' and ref_id = v_deal; assert n = 1, 'Himanshu is asked to confirm the rate';
  select purchase into n from stock_summary(date_trunc('month', current_date)::date, current_date) where item = 'COPPER_SCRAP';
  assert n >= 1000, 'unbooked truck is in stock as a purchase';
  -- the phone deal was 1,150 not 1,200: he corrects it, and the debit notes use his rate
  perform confirm_deal_rate(v_deal, '{"OC": 1150}'::jsonb);
  select rate_vs_deal, weight_short_kg into r from v_lot_lines where lot_id = v_lot;
  assert r.rate_vs_deal = 50 and r.weight_short_kg = 5, 'invoice rate shows 50 over the agreed rate; 5 kg short';
  select taxable into n from v_dn_calc where lot_id = v_lot and dn_type = 'weight_short'; assert n = 5750, 'weight short at the confirmed rate';
  select count(*) into n from v_tasks where kind = 'rate_confirm' and ref_id = v_deal; assert n = 0, 'confirmed: off his list';
  perform approve_dn(v_lot, 'weight_short', current_date, true);
  -- the truck's price cannot change under its approved debit note; the deal rate can, for trucks still to come
  ok := false; begin perform confirm_deal_rate(v_deal, '{"OC": 1100}'::jsonb); exception when others then ok := sqlerrm like '%Cancel it first%'; end;
  assert ok, 'no truck price change under an approved debit note';
  perform set_deal_rate(v_deal, 'OC', 1100, null);
  select rate_per_kg into n from deal_lines where deal_id = v_deal; assert n = 1100, 'deal rate changed';
  select deal_rate into n from v_lot_lines where lot_id = v_lot; assert n = 1150, 'the truck keeps its confirmed price';
  select count(*) into n from deal_rate_history where deal_id = v_deal; assert n = 3, 'history: booked 1200, 1150, 1100';

  -- a booked supply three days past its expected date
  v_late := create_deal(jsonb_build_object('supplier_id', v_dom, 'expected_date', current_date - 3,
    'lines', jsonb_build_array(jsonb_build_object('grade', 'OC', 'qty_kg', 1000, 'rate_per_kg', 1000))));
  select days_late into n from v_deals_incoming where deal_id = v_late; assert n = 3, 'late by 3 days';
  select count(*) into n from v_tasks where kind = 'arrival_late' and ref_id = v_late; assert n = 1, 'late supply on the to-do list';
  select count(*) into n from v_deals_incoming where days_late > 0 and deal_id <> v_late; assert n = 0, 'nothing else late';

  raise exception 'BOOKING CHECKS PASSED (rolled back)' using errcode = 'RA000';
exception when sqlstate 'RA000' then
  raise notice '%', sqlerrm;
end $$;
