-- PRD 7a: stock as Tinu keeps it. Runs on Ogo data plus the 1 Nov opening (test_data/opening_2026_11.sql).
\set ON_ERROR_STOP 1
do $$
declare n numeric; ok boolean; r record;
  own uuid := '00000000-0000-0000-0000-0000000000b1';
begin
  insert into profiles (id, full_name, role) values (own, 'Test owner', 'owner');
  perform set_config('request.jwt.claim.sub', own::text, true);

  -- the opening equals Tinu's 31 Oct closing; the Ogo lot of 25 Oct is inside it and is not counted again
  select opening, notes_out, closing into r from stock_summary('2026-11-01','2026-11-30') where item = 'COPPER_SCRAP';
  assert r.opening = 105380.660, 'scrap opening = Tinu 31 Oct closing';
  assert r.notes_out = 200.700, 'Ogo DNs of 5 Nov take 25.400 + 175.300 kg off';
  assert r.closing = 105179.960, 'scrap closing 30 Nov = opening - DN kg';
  select closing into n from stock_summary('2026-11-01','2026-11-30') where item = 'COPPER_GROSS_SLAG'; assert n = 17457.000, 'dross opening';
  select closing into n from stock_summary('2026-11-01','2026-11-30') where item = 'COPPER_ASH'; assert n = 8051.640, 'ash opening';
  select closing into n from stock_summary('2026-11-01','2026-11-30') where item = 'COPPER_INGOT'; assert n = 10893.850, 'ingot opening';

  -- production keeps the actual figures; yield shown, nothing forced. 2 Oct 2026 from Tinu's production report.
  perform save_production('{"run_date":"2026-10-02","lines":[
    {"item":"COPPER_SCRAP","direction":"consumed","kg":13023},{"item":"PHOS_COPPER","direction":"consumed","kg":135},
    {"item":"COPPER_INGOT","direction":"produced","kg":12500},{"item":"COPPER_GROSS_SLAG","direction":"produced","kg":460},
    {"item":"COPPER_ASH","direction":"produced","kg":198}]}'::jsonb);
  select yield_pct, unaccounted_kg into r from v_production_runs where run_date = '2026-10-02';
  assert r.yield_pct = 95.00 and r.unaccounted_kg = 0, 'yield 12,500 / 13,158 = 95.00%; dross and ash balance the run in Tinu''s sheet';
  select closing into n from stock_summary('2026-11-01','2026-11-30') where item = 'COPPER_SCRAP';
  assert n = 105179.960, 'a run dated before the opening is inside the opening';
  perform save_production('{"run_date":"2026-11-10","lines":[
    {"item":"COPPER_SCRAP","direction":"consumed","kg":1000},{"item":"COPPER_INGOT","direction":"produced","kg":940}]}'::jsonb);
  select unaccounted_kg into n from v_production_runs where run_date = '2026-11-10'; assert n = 60, 'input need not equal output';

  -- movements beyond lots, quantity only, each in its own column
  insert into stock_moves (move_date, item, kind, kg, party, doc_no) values
    ('2026-11-12', 'COPPER_SCRAP', 'branch_in', 2000, 'Mumbai branch', 'DN 38'),
    ('2026-11-13', 'COPPER_SCRAP', 'dispatch', -1500, 'Test buyer', 'RAI/26-27/200'),
    ('2026-11-14', 'COPPER_SCRAP', 'import_receipt', 500, 'Test importer', 'B/E 1');
  perform transfer_stock('{"move_date":"2026-11-15","from_item":"COPPER_INGOT","to_item":"COPPER_INGOT_74031900","kg":300}'::jsonb);
  select * into r from stock_summary('2026-11-01','2026-11-30') where item = 'COPPER_SCRAP';
  assert r.branch_in = 2000 and r.sold = 1500 and r.purchased = 500 and r.consumed = 1000, 'each kind in its column';
  select closing into n from stock_summary('2026-11-01','2026-11-30') where item = 'COPPER_INGOT_74031900'; assert n = 300, 'transfer in';
  select closing into n from stock_summary('2026-11-01','2026-11-30') where item = 'COPPER_INGOT'; assert n = 10893.850 + 940 - 300, 'transfer out';
  for r in select * from stock_summary('2026-11-01','2026-11-30') loop
    assert r.opening + r.total_in - r.total_out = r.closing, format('opening + in - out = closing for %s', r.item);
  end loop;

  ok := false; begin insert into stock_moves (item, kind, kg) values ('COPPER_SCRAP', 'dispatch', 10); exception when check_violation then ok := true; end;
  assert ok, 'a sale cannot add stock';
  ok := false; begin insert into stock_moves (item, kind, kg) values ('COPPER_SCRAP', 'transfer_in', 10); exception when check_violation then ok := true; end;
  assert ok, 'a transfer cannot be one-sided';
  ok := false; begin perform transfer_stock('{"from_item":"COPPER_INGOT","to_item":"COPPER_INGOT","kg":5}'::jsonb); exception when others then ok := true; end;
  assert ok, 'transfer needs two different items';
  ok := false; begin insert into suppliers (name, gstin) values ('Bad GSTIN', 'ABC123'); exception when check_violation then ok := true; end;
  assert ok, 'GSTIN must look like a GSTIN';

  raise exception '7A CHECKS PASSED (rolled back)' using errcode = 'RA000';
exception when sqlstate 'RA000' then
  raise notice '%', sqlerrm;
end $$;
