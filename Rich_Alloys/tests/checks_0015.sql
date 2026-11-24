-- Vendor compliance gate and password override, open (LME) pricing, trucks carrying several deals,
-- document checklist and the document index (migration 0015).
\set ON_ERROR_STOP 1
do $$
declare n numeric; t text; ok boolean; r record;
  facc uuid := '00000000-0000-0000-0000-0000000001e1';   -- Tinu
  own  uuid := '00000000-0000-0000-0000-0000000001e2';   -- Himanshu
  fac  uuid := '00000000-0000-0000-0000-0000000001e3';   -- Sanjay
  v_new uuid; v_ogo uuid; v_other uuid; v_open uuid; v_open2 uuid; v_lot uuid; v_lot2 uuid; v_lot3 uuid; v_a uuid; v_b uuid; v_x uuid; v_mix uuid;
  fresh text; stale text;
begin
  insert into profiles (id, full_name, role) values (facc, 'Tinu', 'factory_accounts'), (own, 'Himanshu', 'owner'), (fac, 'Sanjay', 'factory');
  select supplier_id into v_ogo from v_lots where deal_no = 'RA-082';
  fresh := jsonb_build_object('sub', own, 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)))::text;
  stale := jsonb_build_object('sub', own, 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 3600)))::text;

  -- ---- document checklist ----
  select name into t from doc_types where code = 'VAHAN_CHECK'; assert t like 'RC of vehicle%', 'Vahan check is now the RC';
  select count(*) into n from doc_types where code in ('FASTAG_HISTORY','QC_REPORT','SUPPLIER_CN','COMPLIANCE'); assert n = 4, 'new document types';
  select count(*) into n from v_doc_gaps where side = 'compliance'; assert n = 0, 'compliance files are not a deal gap';

  -- ---- compliance gate ----
  insert into suppliers (name) values ('New Scrap Traders') returning id into v_new;
  perform set_config('request.jwt.claim.sub', facc::text, true);
  ok := false; begin perform create_deal(jsonb_build_object('supplier_id', v_new, 'lines', jsonb_build_array(jsonb_build_object('grade', 'OC', 'qty_kg', 1000, 'rate_per_kg', 1200))));
  exception when others then ok := sqlerrm like 'New Scrap Traders is not onboarded%'; end;
  assert ok, 'no booking with a supplier that is not onboarded';
  ok := false; begin perform create_deal(jsonb_build_object('supplier_name', 'Brand New Co', 'lines', jsonb_build_array(jsonb_build_object('grade', 'OC', 'qty_kg', 1, 'rate_per_kg', 1))));
  exception when others then ok := sqlerrm like 'Brand New Co is not onboarded%'; end;
  assert ok, 'a supplier added while booking is not onboarded either';
  ok := false; begin perform override_compliance(v_new, 'Old supplier'); exception when insufficient_privilege then ok := true; end;
  assert ok, 'Tinu cannot override';
  -- Himanshu: password typed an hour ago is not enough
  perform set_config('request.jwt.claim.sub', own::text, true); perform set_config('request.jwt.claims', stale, true);
  ok := false; begin perform override_compliance(v_new, 'Old supplier'); exception when insufficient_privilege then ok := sqlerrm like '%password again%'; end;
  assert ok, 'override needs the password again';
  perform set_config('request.jwt.claims', fresh, true);
  ok := false; begin perform override_compliance(v_new, ' '); exception when others then ok := sqlerrm like 'Say why%'; end;
  assert ok, 'override needs a reason';
  perform override_compliance(v_new, 'Supplying since 2015; GST certificate pending');
  assert supplier_compliance(v_new) = 'overridden', 'overridden';
  select compliance_override_by into v_x from suppliers where id = v_new; assert v_x = own, 'who overrode';
  perform set_config('request.jwt.claim.sub', facc::text, true);
  v_x := create_deal(jsonb_build_object('supplier_id', v_new, 'lines', jsonb_build_array(jsonb_build_object('grade', 'OC', 'qty_kg', 1000, 'rate_per_kg', 1200))));
  assert v_x is not null, 'overridden supplier can be booked';
  perform set_config('request.jwt.claim.sub', own::text, true);
  perform clear_compliance_override(v_new);
  assert supplier_compliance(v_new) = 'pending', 'override removed';
  -- compliance files sit on the supplier
  insert into onboarding_steps (code, name) values ('GST_CERT', 'GST certificate');
  insert into documents (supplier_id, onboarding_step, doc_type, storage_path, uploaded_by) values (v_new, 'GST_CERT', 'COMPLIANCE', 'suppliers/x/gst.pdf', own);
  select supplier, step_name, deal_id into r from v_doc_index where storage_path = 'suppliers/x/gst.pdf';
  assert r.supplier = 'New Scrap Traders' and r.step_name = 'GST certificate' and r.deal_id is null, 'file indexed under the supplier';

  -- ---- open (LME) price ----
  update suppliers set onboarded_at = now() where id = v_ogo;
  v_open := create_deal(jsonb_build_object('supplier_id', v_ogo, 'open_price', true, 'price_basis', 'LME copper cash − 6%', 'price_fix_days', 10,
    'lines', jsonb_build_array(jsonb_build_object('grade', 'OC', 'qty_kg', 3000, 'rate_per_kg', ''))));
  select rate_per_kg into n from deal_lines where deal_id = v_open; assert n is null, 'booked with the price open';
  select count(*) into n from v_doc_gaps where code = 'FASTAG_HISTORY' and deal_id = v_open; assert n = 1, 'FASTag history is asked for';
  select count(*) into n from deal_rate_history where deal_id = v_open; assert n = 0, 'no rate to record yet';
  ok := false; begin perform create_deal(jsonb_build_object('supplier_id', v_ogo, 'lines', jsonb_build_array(jsonb_build_object('grade', 'OC', 'qty_kg', 1, 'rate_per_kg', ''))));
  exception when others then ok := sqlerrm like 'Enter the rate for OC, or choose open price.'; end;
  assert ok, 'a missing rate is a mistake unless open price is chosen';
  perform set_config('request.jwt.claim.sub', facc::text, true);
  v_lot := create_lot(jsonb_build_object('deal_id', v_open, 'invoice_no', 'OP-1', 'received_on', current_date - 12,
    'lines', jsonb_build_array(jsonb_build_object('grade', 'OC', 'billed_net_kg', 1000, 'billed_rate', 1200, 'factory_gross_kg', 990))));
  select price_open, price_fix_by into r from v_lots where lot_id = v_lot;
  assert r.price_open and r.price_fix_by = current_date - 2, 'truck price open, fix by arrival + 10 days';
  select count(*) into n from v_price_diffs where lot_id = v_lot; assert n = 0, 'nothing to compare while open';
  select count(*) into n from v_tasks where kind = 'price_to_fix'; assert n = 0, 'not Tinu''s to fix';
  ok := false; begin perform approve_dn(v_lot, 'weight_short', current_date, true); exception when others then ok := sqlerrm like '%still open%'; end;
  assert ok, 'debit notes wait for the price';
  -- Tinu sets the deal price: the truck already in stays open (only Himanshu fixes a truck's price)
  perform set_deal_rate(v_open, 'OC', 1210, null);
  select deal_rate into n from v_lot_lines where lot_id = v_lot; assert n is null, 'truck still open';
  perform set_config('request.jwt.claim.sub', own::text, true);
  select count(*) into n from v_tasks where kind = 'price_to_fix' and ref_id = v_lot; assert n = 1, 'Himanshu: fix the price (due)';
  perform set_lot_rate(v_lot, 'OC', 1190, 'LME fixed 20 Nov');
  select source, old_rate, new_rate into r from deal_rate_history where lot_id = v_lot order by changed_at desc limit 1;
  assert r.source = 'price_fixed' and r.old_rate is null and r.new_rate = 1190, 'fixing logged';
  select price_open into ok from v_lots where lot_id = v_lot; assert not ok, 'fixed';
  select status, direction into r from v_price_diffs where lot_id = v_lot; assert r.status = 'kept_agreed' and r.direction = 'over', 'invoice above the fixed price: debited';
  select taxable into n from v_dn_calc where lot_id = v_lot and dn_type = 'price_diff'; assert n = 10000, '1,000 kg x 10';
  perform set_config('request.jwt.claim.sub', facc::text, true);
  perform approve_dn(v_lot, 'weight_short', current_date, true);
  select total into n from notes where lot_id = v_lot and dn_type = 'weight_short'; assert n = 14042, '10 kg at the fixed 1,190 + GST';
  -- Himanshu fixes a whole open deal: every open truck on it takes the price
  perform set_config('request.jwt.claim.sub', own::text, true);
  v_open2 := create_deal(jsonb_build_object('supplier_id', v_ogo, 'open_price', true, 'lines', jsonb_build_array(jsonb_build_object('grade', 'LAL', 'qty_kg', 2000))));
  perform set_config('request.jwt.claim.sub', facc::text, true);
  v_lot2 := create_lot(jsonb_build_object('deal_id', v_open2, 'invoice_no', 'OP-2', 'lines', jsonb_build_array(jsonb_build_object('grade', 'LAL', 'billed_net_kg', 500, 'billed_rate', 1300, 'factory_gross_kg', 500))));
  v_lot3 := create_lot(jsonb_build_object('deal_id', v_open2, 'invoice_no', 'OP-3', 'lines', jsonb_build_array(jsonb_build_object('grade', 'LAL', 'billed_net_kg', 400, 'billed_rate', 1300, 'factory_gross_kg', 400))));
  select price_fix_by into r from lots where id = v_lot2; assert r.price_fix_by is null, 'no fix-by days given: no date';
  perform set_config('request.jwt.claim.sub', own::text, true);
  select count(*) into n from v_tasks where kind = 'price_to_fix' and ref_id in (v_lot2, v_lot3); assert n = 2, 'no date: on the list at once';
  perform set_deal_rate(v_open2, 'LAL', 1300, 'Fixed on call');
  select count(*) into n from lot_lines where lot_id in (v_lot2, v_lot3) and agreed_rate = 1300; assert n = 2, 'both trucks fixed with the deal';
  select count(*) into n from v_tasks where kind = 'price_to_fix'; assert n = 0, 'nothing left to fix';

  -- ---- one truck, two deals ----
  v_a := create_deal(jsonb_build_object('supplier_id', v_ogo, 'lines', jsonb_build_array(jsonb_build_object('grade', 'OC', 'qty_kg', 2000, 'rate_per_kg', 1220))));
  v_b := create_deal(jsonb_build_object('supplier_id', v_ogo, 'lines', jsonb_build_array(jsonb_build_object('grade', 'LAL', 'qty_kg', 1000, 'rate_per_kg', 1330))));
  perform set_config('request.jwt.claim.sub', facc::text, true);
  v_mix := create_lot(jsonb_build_object('deal_id', v_a, 'invoice_no', 'MIX-1', 'lines', jsonb_build_array(
    jsonb_build_object('grade', 'OC', 'billed_net_kg', 1500, 'billed_rate', 1220, 'factory_gross_kg', 1500),
    jsonb_build_object('grade', 'LAL', 'deal_id', v_b, 'billed_net_kg', 600, 'billed_rate', 1330, 'factory_gross_kg', 600))));
  select deal_nos, deal_ids into r from v_lots where lot_id = v_mix;
  assert array_length(r.deal_ids, 1) = 2 and v_a = any (r.deal_ids) and v_b = any (r.deal_ids) and r.deal_nos like '% + %', 'the truck shows both deals';
  select deal_rate into n from v_lot_lines where lot_id = v_mix and grade = 'LAL'; assert n = 1330, 'Lal at deal B''s rate';
  select received_kg into n from v_deals_incoming where deal_id = v_b; assert n = 600, 'deal B received 600 kg on this truck';
  select received_kg into n from v_deals_incoming where deal_id = v_a; assert n = 1500, 'deal A received 1,500 kg';
  select count(*) into n from v_lots where v_b = any (deal_ids); assert n = 1, 'deal B lists the truck';
  select count(*) into n from v_price_diffs where lot_id = v_mix; assert n = 0, 'both at their deals'' rates';
  perform set_config('request.jwt.claim.sub', own::text, true);
  insert into suppliers (name, onboarded_at) values ('Other Seller', now()) returning id into v_other;
  v_x := create_deal(jsonb_build_object('supplier_id', v_other, 'lines', jsonb_build_array(jsonb_build_object('grade', 'LAL', 'qty_kg', 1, 'rate_per_kg', 1))));
  perform set_config('request.jwt.claim.sub', facc::text, true);
  ok := false; begin perform create_lot(jsonb_build_object('deal_id', v_a, 'invoice_no', 'MIX-2', 'lines', jsonb_build_array(
    jsonb_build_object('grade', 'LAL', 'deal_id', v_x, 'billed_net_kg', 1, 'billed_rate', 1, 'factory_gross_kg', 1))));
  exception when others then ok := sqlerrm like '%same supplier%'; end;
  assert ok, 'another supplier''s deal cannot ride on this truck';
  ok := false; begin perform create_lot(jsonb_build_object('deal_id', v_a, 'invoice_no', 'MIX-3', 'lines', jsonb_build_array(
    jsonb_build_object('grade', 'OC', 'billed_net_kg', 1, 'billed_rate', 1, 'factory_gross_kg', 1),
    jsonb_build_object('grade', 'OC', 'deal_id', v_b, 'billed_net_kg', 1, 'billed_rate', 1, 'factory_gross_kg', 1))));
  exception when others then ok := sqlerrm like 'Each grade once%'; end;
  assert ok, 'one grade once per truck';

  raise exception '0015 CHECKS PASSED (rolled back)' using errcode = 'RA000';
exception when sqlstate 'RA000' then
  raise notice '%', sqlerrm;
end $$;
