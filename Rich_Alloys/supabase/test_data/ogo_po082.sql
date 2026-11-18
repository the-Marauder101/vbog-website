-- TEST DATA: verified purchase PO/RA/082/26-27 (Ogo Enviro Solutions, invoice OGOES15).
-- Every figure is from the PO, invoice bundle, notebook pages or DNs 114-116.
-- Load into a test project only. It runs through the same functions the app uses,
-- acting as an inactive "Seed data" admin profile.

do $$
declare
  v_seed uuid := '00000000-0000-0000-0000-000000005eed';
  v_plant uuid; v_sup uuid; v_deal uuid; v_lot uuid; v_inv uuid; v_oc uuid; v_lal uuid; v_n uuid; v_pay uuid;
begin
  select id into v_plant from plants where name = 'Palghar';
  insert into profiles (id, full_name, role, plant_id) values (v_seed, 'Seed data', 'vbog_admin', v_plant)
  on conflict (id) do update set active = true, role = 'vbog_admin';
  perform set_config('request.jwt.claim.sub', v_seed::text, true);

  v_deal := create_deal(jsonb_build_object(
    'supplier_name','Ogo Enviro Solutions Private Limited','supplier_gstin','36AAECO5492P1ZO','supplier_state','Telangana',
    'deal_date','2026-10-22','expected_date','2026-10-25','po_no','PO/RA/082/26-27','po_date','2026-10-22','gst_rate',18,
    'lines', jsonb_build_array(
      jsonb_build_object('grade','OC','qty_kg',5000,'rate_per_kg',1234),
      jsonb_build_object('grade','LAL','qty_kg',5000,'rate_per_kg',1319))));
  update deals set deal_no = 'RA-082' where id = v_deal;
  select supplier_id into v_sup from deals where id = v_deal;
  update suppliers set kyc_status = 'verified' where id = v_sup;

  v_lot := create_lot(jsonb_build_object(
    'deal_id', v_deal, 'received_on','2026-10-25', 'invoice_no','OGOES15', 'invoice_date','2026-10-23',
    'completes_deal', true,
    'lines', jsonb_build_array(
      jsonb_build_object('grade','OC','billed_net_kg',4864.550,'billed_rate',1234,'slip_gross_kg',4884.550,'slip_bag_kg',20.200,
                         'factory_gross_kg',4874.900,'bag_count',120,'factory_bag_kg',24.700),
      jsonb_build_object('grade','LAL','billed_net_kg',5093.350,'billed_rate',1319,'slip_gross_kg',5104.100,'slip_bag_kg',10.750,
                         'factory_gross_kg',5100.100,'bag_count',74,'factory_bag_kg',17.800))));
  select invoice_id into v_inv from lots where id = v_lot;
  select id into v_oc from lot_lines where lot_id = v_lot and grade = 'OC';
  select id into v_lal from lot_lines where lot_id = v_lot and grade = 'LAL';

  insert into sorting_lines (lot_line_id, sorted_on, category, sorted_kg, action, rate_cut, dn_kg, change_reason) values
    (v_oc,'2026-10-27','LEAD_COPPER',125.9,'rate_diff',80,125.9,null),
    (v_oc,'2026-10-27','DC',27.6,'rate_diff',185,27.6,null),
    (v_oc,'2026-10-28','ATTACHMENT',131.8,'return',null,131.8,null),
    (v_oc,'2026-10-28','MITTI',37.4,'return',null,18.7,'NOT RECORDED: ask Himanshu why DN 116 carries 18.7 kg'),
    (v_lal,'2026-10-28','LOW_QUALITY',139.7,'rate_diff',85,139.7,null),
    (v_lal,'2026-10-28','ATTACHMENT',24.8,'return',null,24.8,null);
  perform close_lot(v_lot);

  -- as issued on 5 Nov: 114 and 116 rounded to the rupee, 115 not
  v_n := approve_dn(v_lot, 'weight_short', '2026-11-05', true);  perform set_note_tally_no(v_n, 'RAI/DN/26-27/114');
  perform mark_tally('note', v_n, 'factory', 'RAI/DN/26-27/114');
  v_n := approve_dn(v_lot, 'rate_diff', '2026-11-05', false);    perform set_note_tally_no(v_n, 'RAI/DN/26-27/115');
  perform mark_tally('note', v_n, 'factory', 'RAI/DN/26-27/115');
  v_n := approve_dn(v_lot, 'return', '2026-11-05', true);        perform set_note_tally_no(v_n, 'RAI/DN/26-27/116');
  perform mark_tally('note', v_n, 'factory', 'RAI/DN/26-27/116');
  perform mark_tally('invoice', v_inv, 'factory', null);

  insert into returns (lot_id, dispatched_on, kg, packages, eway_bill_no, transporter, lr_no, freight, freight_paid_by)
  values (v_lot, '2026-11-06', 175.3, 6, '202325973829', 'VRL', '1079490402', 1900, 'rich_alloys');

  insert into payments (supplier_id, invoice_id, kind, amount, paid_on, mode)
  values (v_sup, v_inv, 'provisional', 14000000, '2026-10-24', 'rtgs') returning id into v_pay;
  perform reconcile_payment(v_pay);

  -- documents held in Project files: supplier pack and return pack
  insert into documents (deal_id, doc_type, storage_path, status, uploaded_by)
  select v_deal, code, 'RA-082/' || code || '/seed', 'approved', v_seed from doc_types where side in ('supplier','return');

  perform set_config('request.jwt.claim.sub', '', true);
  update profiles set active = false where id = v_seed;
end $$;
