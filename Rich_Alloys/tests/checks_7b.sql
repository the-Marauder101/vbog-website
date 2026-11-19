-- PRD 7b: every source is a supplier. Runs on Ogo data plus the 1 Nov opening.
\set ON_ERROR_STOP 1
do $$
declare n numeric; t text; ok boolean; r record;
  own uuid := '00000000-0000-0000-0000-0000000000c1';
  v_branch uuid; v_jw uuid; v_dom uuid; v_lot uuid; v_inv uuid; v_lot2 uuid;
begin
  insert into profiles (id, full_name, role) values (own, 'Test owner', 'owner');
  perform set_config('request.jwt.claim.sub', own::text, true);
  insert into suppliers (name, supplier_type) values ('Rich Alloys India Pvt Ltd (Mumbai)', 'branch') returning id into v_branch;
  insert into suppliers (name, supplier_type) values ('Test job worker', 'job_work') returning id into v_jw;
  select supplier_id into v_dom from v_lots where deal_no = 'RA-082';

  -- branch transfer: Tinu's delivery note 37 of 30 Oct, 2,505 kg dispatched from Mumbai; 2,500 kg on our weighbridge
  v_lot := create_receipt(jsonb_build_object('supplier_id', v_branch, 'invoice_no', '37', 'invoice_date', '2026-11-12',
    'received_on', '2026-11-12', 'vehicle_no', 'mh04ab1234', 'sent_by', 'Vinod',
    'lines', jsonb_build_array(jsonb_build_object('grade', 'OC', 'billed_net_kg', 2505, 'factory_gross_kg', 2500, 'factory_bag_kg', 0))));
  select invoice_id into v_inv from lots where id = v_lot;
  select doc_kind, supplier_type into r from v_lots where lot_id = v_lot;
  assert r.doc_kind = 'delivery_note' and r.supplier_type = 'branch', 'branch arrival comes on a delivery note';
  select total into n from invoices where id = v_inv; assert n = 0, 'a delivery note carries no money';
  select weight_short_kg into n from v_lot_lines where lot_id = v_lot; assert n = 5, 'transfer shortage shows: 2,505 sent, 2,500 received';
  select count(*) into n from v_payable where invoice_id = v_inv; assert n = 0, 'no payable for own branch';
  select count(*) into n from v_cash_plan where supplier_id = v_branch; assert n = 0, 'no cash needed for own branch';
  select count(*) into n from v_invoice_register where invoice_id = v_inv; assert n = 0, 'not in the purchase invoice register';
  select count(*) into n from v_supplier_balance where supplier_id = v_branch; assert n = 0, 'no supplier ledger for own branch';
  select string_agg(book, ',') into t from v_tally_missing where entity = 'invoice' and entity_id = v_inv;
  assert t = 'factory', 'branch inward goes to factory Tally only';

  perform approve_dn(v_lot, 'weight_short', '2026-11-13', true);
  select total, (select sum(stock_kg) from note_lines where note_id = notes.id) as kg into r from notes where lot_id = v_lot;
  assert r.total = 0 and r.kg = 5, 'shortage note: kg only, no rupees';
  select string_agg(book, ',') into t from v_tally_missing m join notes x on x.id = m.entity_id where m.entity = 'note' and x.lot_id = v_lot;
  assert t = 'factory', 'shortage note goes to factory Tally only';
  select closing into n from stock_summary('2026-11-01','2026-11-30') where item = 'COPPER_SCRAP';
  assert n = 105179.960 + 2505 - 5, 'branch delivery adds stock at the delivery-note weight, the shortage note takes 5 kg off';

  select string_agg(code, ',' order by code) into t from v_doc_gaps g join lots l on l.deal_id = g.deal_id
   where l.id = v_lot and g.code in ('PO','TAX_INVOICE','E_INVOICE','DELIVERY_NOTE','BILL_OF_ENTRY','CHALLAN');
  assert t = 'DELIVERY_NOTE', 'a branch transfer needs its delivery note, not a PO, tax invoice or e-invoice';
  select count(*) into n from v_doc_gaps where deal_no = 'RA-082' and code in ('DELIVERY_NOTE','BILL_OF_ENTRY','CHALLAN');
  assert n = 0, 'a domestic purchase is not asked for branch, import or job-work documents';

  -- domestic purchases still start from a deal
  ok := false;
  begin perform create_receipt(jsonb_build_object('supplier_id', v_dom, 'invoice_no', 'X', 'lines',
    jsonb_build_array(jsonb_build_object('grade', 'OC', 'billed_net_kg', 1, 'factory_gross_kg', 1))));
  exception when others then ok := sqlerrm like '%start from a deal%'; end;
  assert ok, 'domestic purchases start from a deal';

  -- job work: sent vs came back
  insert into stock_moves (move_date, item, kind, kg, supplier_id, doc_no) values ('2026-11-14', 'COPPER_SCRAP', 'job_work_out', -1000, v_jw, 'JW-1');
  v_lot2 := create_receipt(jsonb_build_object('supplier_id', v_jw, 'invoice_no', 'CH-1', 'received_on', '2026-11-20',
    'lines', jsonb_build_array(jsonb_build_object('grade', 'OC', 'billed_net_kg', 950, 'factory_gross_kg', 950))));
  select doc_kind into t from v_lots where lot_id = v_lot2; assert t = 'challan', 'job work comes back on a challan';
  select * into r from v_job_work where supplier_id = v_jw;
  assert r.sent_kg = 1000 and r.returned_kg = 950 and r.with_job_worker_kg = 50, 'job work: sent 1,000, back 950, 50 kg unaccounted';

  -- the Ogo purchase is untouched
  select balance into n from v_payable where deal_no = 'RA-082'; assert n = 682999.40, 'Ogo balance unchanged';

  raise exception '7B CHECKS PASSED (rolled back)' using errcode = 'RA000';
exception when sqlstate 'RA000' then
  raise notice '%', sqlerrm;
end $$;
