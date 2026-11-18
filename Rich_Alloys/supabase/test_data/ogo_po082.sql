-- TEST DATA: verified transaction PO/RA/082/26-27 (Ogo, invoice OGOES15).
-- Every figure is from the PO, invoice bundle, notebook pages or DNs 114-116.
-- Load into a test project only, or delete before go-live.

do $$
declare v_plant uuid; v_sup uuid; v_deal uuid; v_inv uuid; v_rec uuid; v_oc uuid; v_lal uuid; v_dn uuid;
begin
  select id into v_plant from plants where name = 'Palghar';
  insert into suppliers (name, gstin, state, kyc_status)
    values ('Ogo Enviro Solutions Private Limited','36AAECO5492P1ZO','Telangana','verified') returning id into v_sup;

  insert into deals (deal_no, supplier_id, plant_id, deal_date, po_no, po_date, status)
    values ('RA-082', v_sup, v_plant, '2026-10-22', 'PO/RA/082/26-27', '2026-10-22', 'dn_approved') returning id into v_deal;
  insert into deal_lines (deal_id, grade, qty_kg, rate_per_kg) values
    (v_deal,'OC',5000,1234), (v_deal,'LAL',5000,1319);

  insert into invoices (deal_id, invoice_no, invoice_date, gst_rate, taxable_value, gst_amount, total)
    values (v_deal,'OGOES15','2026-10-23',18,12720983.35,2289777.00,15010760.35) returning id into v_inv;
  insert into invoice_lines (invoice_id, grade, billed_net_kg, billed_rate, slip_gross_kg, slip_bag_kg) values
    (v_inv,'OC',4864.550,1234,4884.550,20.200), (v_inv,'LAL',5093.350,1319,5104.100,10.750);

  insert into receipts (deal_id, invoice_id, received_on) values (v_deal, v_inv, '2026-10-25') returning id into v_rec;
  insert into receipt_lines (receipt_id, grade, factory_gross_kg, bag_count, factory_bag_kg)
    values (v_rec,'OC',4874.900,120,24.700) returning id into v_oc;
  insert into receipt_lines (receipt_id, grade, factory_gross_kg, bag_count, factory_bag_kg)
    values (v_rec,'LAL',5100.100,74,17.800) returning id into v_lal;

  insert into sorting_lines (receipt_line_id, category, sorted_kg, action, rate_cut, dn_kg, change_reason) values
    (v_oc,'LEAD_COPPER',125.9,'rate_diff',80,125.9,null),
    (v_oc,'DC',27.6,'rate_diff',185,27.6,null),
    (v_oc,'ATTACHMENT',131.8,'return',null,131.8,null),
    (v_oc,'MITTI',37.4,'return',null,18.7,'NOT RECORDED: ask Himanshu why DN 116 carries 18.7 kg'),
    (v_lal,'LOW_QUALITY',139.7,'rate_diff',85,139.7,null),
    (v_lal,'ATTACHMENT',24.8,'return',null,24.8,null);

  -- DNs as issued on 5 Nov: 114 and 116 rounded to the rupee, 115 not
  v_dn := approve_dn(v_inv,'weight_short','2026-11-05',true);
  update debit_notes set tally_dn_no='RAI/DN/26-27/114', status='booked_in_tally' where id = v_dn;
  v_dn := approve_dn(v_inv,'rate_diff','2026-11-05',false);
  update debit_notes set tally_dn_no='RAI/DN/26-27/115', status='booked_in_tally' where id = v_dn;
  v_dn := approve_dn(v_inv,'return','2026-11-05',true);
  update debit_notes set tally_dn_no='RAI/DN/26-27/116', status='booked_in_tally' where id = v_dn;

  insert into returns (deal_id, dispatched_on, kg, packages, eway_bill_no, transporter, lr_no, freight, freight_paid_by)
    values (v_deal,'2026-11-06',175.3,6,'202325973829','VRL','1079490402',1900,'rich_alloys');

  insert into payments (deal_id, invoice_id, kind, amount) values (v_deal, v_inv, 'provisional', 14000000);

  -- documents actually held in Project files: supplier pack and return pack
  insert into documents (deal_id, doc_type, storage_path, status)
  select v_deal, code, 'deals/RA-082/' || code || '/seed', 'approved'
  from doc_types where side in ('supplier','return');
end $$;
