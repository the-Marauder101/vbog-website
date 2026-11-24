-- Machine purchases and their cash projection; transport bookings attached to lots (migration 0018).
\set ON_ERROR_STOP 1
do $$
declare n numeric; t text; ok boolean; r record;
  facc uuid := '00000000-0000-0000-0000-0000000002e1';   -- Tinu
  own  uuid := '00000000-0000-0000-0000-0000000002e2';   -- Himanshu
  fac  uuid := '00000000-0000-0000-0000-0000000002e3';   -- Sanjay
  v_m uuid; v_deal uuid; v_lot uuid; v_lot2 uuid; v_t uuid; v_t2 uuid;
begin
  insert into profiles (id, full_name, role) values (facc, 'Tinu', 'factory_accounts'), (own, 'Himanshu', 'owner'), (fac, 'Sanjay', 'factory');
  update suppliers set onboarded_at = now() where supplier_type = 'domestic';

  -- ---- as the app does it: the logged-in role, row-level security on ----
  perform set_config('request.jwt.claim.sub', own::text, true);
  execute 'set local role authenticated';
  insert into machine_orders (vendor, description, value) values ('App test', 'App test', 1) returning id into v_m;
  insert into machine_milestones (order_id, label, due_on, amount) values (v_m, 'Advance', current_date, 1);
  insert into machine_payments (order_id, amount) values (v_m, 1);
  insert into transport_bookings (transporter, booked_price) values ('App test', 1) returning id into v_t;
  execute 'reset role';
  delete from machine_orders where id = v_m; delete from transport_bookings where id = v_t;

  -- ---- a machine: ₹10,00,000 + 18% = ₹11,80,000; 30% advance (overdue), 60% on dispatch, 10% after installation ----
  perform set_config('request.jwt.claim.sub', own::text, true);
  insert into machine_orders (vendor, description, value, gst_rate, ordered_on) values ('Induction Furnaces Pvt Ltd', '500 kg induction furnace', 1000000, 18, current_date - 15)
  returning id into v_m;
  insert into machine_milestones (order_id, label, due_on, amount, sort) values
    (v_m, 'Advance', current_date - 10, 354000, 1), (v_m, 'On dispatch', current_date + 20, 708000, 2), (v_m, 'After installation', current_date + 60, 118000, 3);
  select total, scheduled, paid, balance into r from v_machine_orders where id = v_m;
  assert r.total = 1180000 and r.scheduled = 1180000 and r.paid = 0 and r.balance = 1180000, 'order total incl. GST';
  insert into machine_payments (order_id, amount, paid_on) values (v_m, 300000, current_date - 9);
  select outstanding into n from v_machine_cash where order_id = v_m and label = 'Advance'; assert n = 54000, 'advance part paid: 54,000 left';
  select sum(outstanding) into n from v_machine_cash where order_id = v_m; assert n = 880000, 'to pay 8,80,000';
  select amount into n from v_tasks where kind = 'machine_due' and ref_id = v_m; assert n = 54000, 'overdue advance on Himanshu''s list';
  insert into machine_payments (order_id, amount) values (v_m, 500000);
  select outstanding into n from v_machine_cash where order_id = v_m and label = 'On dispatch'; assert n = 262000, 'payments fill the schedule in date order';
  select count(*) into n from v_tasks where kind = 'machine_due' and ref_id = v_m; assert n = 0, 'nothing due within a week';
  -- part of the value not scheduled shows without a date
  update machine_orders set value = 1100000 where id = v_m;
  select outstanding into n from v_machine_cash where order_id = v_m and label = 'Not scheduled'; assert n = 118000, '1,00,000 + GST not yet scheduled';
  perform set_config('request.jwt.claim.sub', fac::text, true);
  execute 'set local role authenticated';                -- as the app would: row-level security applies
  select count(*) into n from v_machine_orders; assert n = 0, 'Sanjay sees no machine money';
  select count(*) into n from machine_payments; assert n = 0, 'nor the payments';
  ok := false; begin insert into machine_orders (vendor, description, value) values ('x', 'y', 1); exception when insufficient_privilege then ok := true; end;
  assert ok, 'Sanjay cannot add machines';
  ok := false; begin insert into transport_bookings (deal_id, transporter, booked_price) values (null, 'x', 1); exception when insufficient_privilege then ok := true; end;
  assert ok, 'Sanjay does not book transport';
  execute 'reset role';

  -- ---- transport: booked ₹25,000 on a deal; the truck arrives and the booking locks to the lot ----
  perform set_config('request.jwt.claim.sub', own::text, true);
  v_deal := create_deal(jsonb_build_object('supplier_id', (select supplier_id from v_lots where deal_no = 'RA-082'),
    'lines', jsonb_build_array(jsonb_build_object('grade', 'OC', 'qty_kg', 2000, 'rate_per_kg', 1200))));
  insert into transport_bookings (deal_id, transporter, vehicle_no, from_place, booked_price) values (v_deal, 'Shree Roadlines', 'mh04xy9999', 'Hyderabad', 25000)
  returning id into v_t;
  perform set_config('request.jwt.claim.sub', fac::text, true);
  v_lot := create_lot(jsonb_build_object('deal_id', v_deal, 'invoice_no', 'TR-1', 'lines', jsonb_build_array(
    jsonb_build_object('grade', 'OC', 'billed_net_kg', 2000, 'billed_rate', 1200, 'factory_gross_kg', 2000))));
  perform attach_transport(v_t, v_lot);                 -- the arrival form does this when a booking is waiting
  select lot_id, locked_at is not null as locked into r from transport_bookings where id = v_t; assert r.lot_id = v_lot and r.locked, 'attached and locked';
  select vehicle_no into t from lots where id = v_lot; assert t = 'MH04XY9999', 'truck number filled from the booking';
  perform set_config('request.jwt.claim.sub', own::text, true);
  ok := false; begin update transport_bookings set booked_price = 20000 where id = v_t; exception when others then ok := sqlerrm like '%locked to its lot%'; end;
  assert ok, 'booked price fixed once the truck is in';
  ok := false; begin update transport_bookings set lot_id = null where id = v_t; exception when others then ok := sqlerrm like 'Attach or detach%'; end;
  assert ok, 'lot link changes only through attach/detach';
  -- the transporter bills ₹27,500
  perform set_config('request.jwt.claim.sub', facc::text, true);
  update transport_bookings set bill_no = 'SR-77', bill_date = current_date, bill_amount = 27500 where id = v_t;
  select bill_diff, bill_differs into r from v_transport where id = v_t; assert r.bill_diff = 2500 and r.bill_differs, 'bill 2,500 above the booking';
  perform set_config('request.jwt.claim.sub', own::text, true);
  select amount into n from v_tasks where kind = 'transport_bill_diff' and ref_id = v_t; assert n = 2500, 'alert for Himanshu';
  select freight into n from v_lot_register where lot_id = v_lot; assert n = 27500, 'freight in the lot table';
  -- one booking per truck, one truck per booking
  insert into transport_bookings (deal_id, transporter, booked_price) values (v_deal, 'Other', 1000) returning id into v_t2;
  ok := false; begin perform attach_transport(v_t2, v_lot); exception when others then ok := sqlerrm like '%already has a truck%'; end;
  assert ok, 'a lot has one truck';
  perform set_config('request.jwt.claim.sub', fac::text, true);
  v_lot2 := create_lot(jsonb_build_object('deal_id', v_deal, 'invoice_no', 'TR-2', 'lines', jsonb_build_array(
    jsonb_build_object('grade', 'OC', 'billed_net_kg', 1, 'billed_rate', 1200, 'factory_gross_kg', 1))));
  ok := false; begin perform attach_transport(v_t, v_lot2); exception when others then ok := sqlerrm like '%brought another lot%'; end;
  assert ok, 'a booking brings one lot';
  perform set_config('request.jwt.claim.sub', own::text, true);
  perform detach_transport(v_t);
  update transport_bookings set booked_price = 26000 where id = v_t;
  select booked_price into n from transport_bookings where id = v_t; assert n = 26000, 'detached: editable again';

  raise exception '0018 CHECKS PASSED (rolled back)' using errcode = 'RA000';
exception when sqlstate 'RA000' then
  raise notice '%', sqlerrm;
end $$;
