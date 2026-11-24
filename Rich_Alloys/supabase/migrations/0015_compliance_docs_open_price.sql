-- Depesh, 24 Nov:
--  1. Documents: one place to see and download everything per invoice and per supplier (screens), supplier compliance
--     files attached to the supplier (not a deal), document checklist: RC of vehicle, FASTag history, QA/QC report,
--     supplier credit note.
--  2. Vendor compliance: a supplier must be onboarded before a deal is booked with them, unless Himanshu overrides it
--     (long-standing suppliers); the override needs his password entered again.
--  3. Open pricing: a deal can be booked without a price (to be fixed against LME later); each truck of it carries a
--     "fix price by" date and an alert. Debit notes wait until the price is fixed.
--  4. A truck can carry material from more than one deal of the same supplier (each grade line names its deal).
--  All rates in the portal exclude GST; GST is always added on top (unchanged; labels only).

-- ================= 1. documents =================
alter table doc_types drop constraint doc_types_side_check;
alter table doc_types add constraint doc_types_side_check check (side in ('supplier','rich_alloys','return','compliance'));
update doc_types set name = 'RC of vehicle (registration certificate)', name_hi = 'गाड़ी की RC (रजिस्ट्रेशन सर्टिफिकेट)' where code = 'VAHAN_CHECK';
insert into doc_types (code, name, name_hi, side, sort, required, supplier_types) values
  ('FASTAG_HISTORY', 'FASTag history (toll trail)', 'FASTag हिस्ट्री (टोल रिकॉर्ड)', 'supplier', 13, true,
     (select supplier_types from doc_types where code = 'VAHAN_CHECK')),
  ('SUPPLIER_CN', 'Supplier credit note (against our debit note)', 'सप्लायर का क्रेडिट नोट (हमारे डेबिट नोट पर)', 'supplier', 14, false, '{domestic}'),
  ('QC_REPORT', 'QA / QC report', 'QA / QC रिपोर्ट', 'rich_alloys', 24, false, null),
  ('COMPLIANCE', 'Supplier compliance document', 'सप्लायर अनुपालन दस्तावेज़', 'compliance', 90, false, null)
on conflict (code) do nothing;

alter table documents alter column deal_id drop not null,
  add column supplier_id uuid references suppliers(id) on delete cascade,
  add column onboarding_step text references onboarding_steps(code) on delete set null,
  add constraint documents_owner check (deal_id is not null or supplier_id is not null);

create or replace view v_doc_gaps with (security_invoker = true) as
select d.id as deal_id, d.deal_no, t.side, t.code, t.name, t.name_hi,
       coalesce((select max(x.status) filter (where x.status <> 'rejected') from documents x
                 where x.deal_id = d.id and x.doc_type = t.code), 'missing') as state
from deals d join suppliers s on s.id = d.supplier_id cross join doc_types t
where t.required and t.active and not d.cancelled and t.side <> 'compliance'
  and (t.supplier_types is null or s.supplier_type = any (t.supplier_types))
  and (t.side <> 'return' or exists (select 1 from returns r join lots l on l.id = r.lot_id where l.deal_id = d.id))
  and not exists (select 1 from documents x where x.deal_id = d.id and x.doc_type = t.code and x.status = 'approved');

-- every file with where it belongs: supplier, deal, truck, invoice, onboarding step
create view v_doc_index with (security_invoker = true) as
select x.id, x.doc_type, t.name as type_name, t.name_hi as type_name_hi, t.side, x.status, x.note, x.storage_path, x.uploaded_at,
       coalesce(x.supplier_id, d.supplier_id) as supplier_id, s.name as supplier, x.deal_id, d.deal_no,
       x.lot_id, l.lot_no, l.invoice_id, i.invoice_no, x.onboarding_step, os.name as step_name
from documents x
join doc_types t on t.code = x.doc_type
left join deals d on d.id = x.deal_id
left join suppliers s on s.id = coalesce(x.supplier_id, d.supplier_id)
left join lots l on l.id = x.lot_id
left join invoices i on i.id = l.invoice_id
left join onboarding_steps os on os.code = x.onboarding_step
where x.status <> 'rejected';
revoke all on v_doc_index from anon;
grant select on v_doc_index to authenticated;

-- ================= 2. vendor compliance =================
alter table suppliers add column compliance_override_at timestamptz,
                      add column compliance_override_by uuid references profiles(id),
                      add column compliance_override_reason text;
insert into permissions (action, role) values ('compliance_override', 'owner') on conflict do nothing;

-- onboarded, overridden (allowed to trade though not fully compliant), or pending. Only domestic sellers are checked.
create function supplier_compliance(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when s.supplier_type <> 'domestic' then 'not_needed'
              when s.onboarded_at is not null then 'onboarded'
              when s.compliance_override_at is not null then 'overridden'
              else 'pending' end
  from suppliers s where s.id = p
$$;

-- the caller typed their password in the last 5 minutes (Supabase puts the sign-in method and time in the token)
create function signed_in_recently() returns boolean
language sql stable as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'amr', '[]'::jsonb)) a
    where a->>'method' = 'password' and (a->>'timestamp')::bigint >= extract(epoch from now())::bigint - 300)
$$;

create function override_compliance(p_supplier uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require('compliance_override');
  if nullif(trim(p_reason), '') is null then raise exception 'Say why this supplier may trade without full onboarding.'; end if;
  if not signed_in_recently() then
    raise exception 'Enter your password again to override.' using errcode = 'insufficient_privilege';
  end if;
  update suppliers set compliance_override_at = now(), compliance_override_by = auth.uid(), compliance_override_reason = trim(p_reason)
  where id = p_supplier;
  insert into audit_log (actor, table_name, row_id, action, detail)
  values (auth.uid(), 'suppliers', p_supplier, 'compliance_override', jsonb_build_object('reason', trim(p_reason)));
end $$;

create function clear_compliance_override(p_supplier uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require('compliance_override');
  update suppliers set compliance_override_at = null, compliance_override_by = null, compliance_override_reason = null where id = p_supplier;
  insert into audit_log (actor, table_name, row_id, action) values (auth.uid(), 'suppliers', p_supplier, 'compliance_override_removed');
end $$;

-- ================= 3 and 4. open price, several deals per truck =================
alter table deal_lines alter column rate_per_kg drop not null;          -- empty = price open (to be fixed later)
alter table deals add column price_basis text, add column price_fix_days int check (price_fix_days >= 0);
alter table lots add column price_fix_by date;
alter table lot_lines add column deal_id uuid references deals(id);
select set_config('ra.via_fn', 'on', true);
update lot_lines ll set deal_id = l.deal_id from lots l where l.id = ll.lot_id and ll.deal_id is null;
select set_config('ra.via_fn', 'off', true);
alter table lot_lines alter column deal_id set not null;

alter table deal_rate_history drop constraint deal_rate_history_source_check;
alter table deal_rate_history add constraint deal_rate_history_source_check
  check (source in ('booked','changed','accepted_invoice','confirmed_unbooked','truck_changed','price_fixed'));

-- a new truck line: its deal (the lot's unless named), and that deal's price at the moment (empty when open)
create or replace function pin_truck_price() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.deal_id := coalesce(new.deal_id, (select deal_id from lots where id = new.lot_id));
    if new.agreed_rate is null or not via_fn() then
      select dl.rate_per_kg into new.agreed_rate from deal_lines dl where dl.deal_id = new.deal_id and dl.grade = new.grade;
    end if;
  elsif new.agreed_rate is distinct from old.agreed_rate and not via_fn() then
    raise exception 'Only Himanshu can change a truck''s price, from the lot.';
  end if;
  return new;
end $$;

create or replace function log_rate_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.rate_per_kg is not null and (tg_op = 'INSERT' or new.rate_per_kg is distinct from old.rate_per_kg) then
    insert into deal_rate_history (deal_id, grade, old_rate, new_rate, source, lot_id, note)
    values (new.deal_id, new.grade, case when tg_op = 'UPDATE' then old.rate_per_kg end, new.rate_per_kg,
            case when tg_op = 'INSERT' then 'booked'
                 when old.rate_per_kg is null then 'price_fixed'
                 else coalesce(nullif(current_setting('ra.rate_source', true), ''), 'changed') end,
            nullif(current_setting('ra.rate_lot', true), '')::uuid, nullif(current_setting('ra.rate_note', true), ''));
  end if;
  return new;
end $$;

-- the deal rate. Trucks already in keep their price, except trucks whose price is still open: when Himanshu
-- (rate_confirm) fixes the deal's price, those trucks are fixed with it.
create or replace function apply_deal_rate(p_deal uuid, p_grade text, p_rate numeric, p_source text, p_lot uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old numeric; v_found boolean; r record;
begin
  if p_rate is null or p_rate <= 0 then raise exception 'Enter the rate for %.', p_grade; end if;
  select rate_per_kg, true into v_old, v_found from deal_lines where deal_id = p_deal and grade = p_grade;
  if v_found is null then raise exception 'Grade % is not on this deal.', p_grade; end if;
  if v_old is distinct from p_rate then
    perform set_config('ra.rate_source', p_source, true);
    perform set_config('ra.rate_lot', coalesce(p_lot::text, ''), true);
    perform set_config('ra.rate_note', coalesce(p_note, ''), true);
    update deal_lines set rate_per_kg = p_rate where deal_id = p_deal and grade = p_grade;
    perform set_config('ra.rate_source', '', true); perform set_config('ra.rate_lot', '', true); perform set_config('ra.rate_note', '', true);
  end if;
  if public.can('rate_confirm') then
    for r in select ll.lot_id from lot_lines ll where ll.deal_id = p_deal and ll.grade = p_grade and ll.agreed_rate is null
                                                  and not lot_has_notes(ll.lot_id) loop
      perform set_config('ra.via_fn', 'on', true);
      update lot_lines set agreed_rate = p_rate where lot_id = r.lot_id and grade = p_grade;
      perform set_config('ra.via_fn', 'off', true);
      insert into deal_rate_history (deal_id, grade, old_rate, new_rate, source, lot_id, note)
      values (p_deal, p_grade, null, p_rate, 'price_fixed', r.lot_id, p_note);
    end loop;
  end if;
end $$;

-- a truck's price (internal): fixing an open price, or Himanshu's change
create or replace function apply_truck_price(p_lot uuid, p_grade text, p_rate numeric, p_source text, p_note text, p_log boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_old numeric; v_deal uuid; v_billed numeric; v_kind text;
begin
  if p_rate is null or p_rate <= 0 then raise exception 'Enter the price for %.', p_grade; end if;
  select ll.agreed_rate, ll.deal_id, il.billed_rate, i.doc_kind into v_old, v_deal, v_billed, v_kind
  from lot_lines ll join lots l on l.id = ll.lot_id
  left join invoices i on i.id = l.invoice_id
  left join invoice_lines il on il.invoice_id = l.invoice_id and il.grade = ll.grade
  where ll.lot_id = p_lot and ll.grade = p_grade;
  if v_deal is null then raise exception 'Grade % is not on this truck.', p_grade; end if;
  if v_old = p_rate then return; end if;
  if lot_has_notes(p_lot) then
    raise exception 'This truck has an approved debit note. Cancel it first, then change the price.';
  end if;
  perform set_config('ra.via_fn', 'on', true);
  update lot_lines set agreed_rate = p_rate where lot_id = p_lot and grade = p_grade;
  perform set_config('ra.via_fn', 'off', true);
  if p_log then
    insert into deal_rate_history (deal_id, grade, old_rate, new_rate, source, lot_id, note)
    values (v_deal, p_grade, v_old, p_rate, case when v_old is null and p_source = 'truck_changed' then 'price_fixed' else p_source end, p_lot, p_note);
  end if;
  if v_kind = 'tax_invoice' and v_billed is not null and v_billed <> p_rate then
    insert into price_decisions (lot_id, grade, invoice_rate, agreed_rate, decision)
    values (p_lot, p_grade, v_billed, p_rate, 'kept_agreed');
  end if;
end $$;

create or replace function confirm_deal_rate(p_deal uuid, p_rates jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v numeric; l uuid;
begin
  perform require('rate_confirm');
  if not exists (select 1 from deals where id = p_deal and unbooked and not cancelled) then
    raise exception 'Only a truck that arrived without a booking needs its rate confirmed.';
  end if;
  if p_rates is not null and jsonb_typeof(p_rates) = 'object' then
    for k, v in select key, value::numeric from jsonb_each_text(p_rates) loop
      for l in select ll.lot_id from lot_lines ll where ll.deal_id = p_deal and ll.grade = k loop
        perform apply_truck_price(l, k, v, 'confirmed_unbooked', null, false);
      end loop;
      perform apply_deal_rate(p_deal, k, v, 'confirmed_unbooked', null, null);
    end loop;
  end if;
  update deals set rate_confirmed_at = now(), rate_confirmed_by = auth.uid() where id = p_deal;
  insert into audit_log (actor, table_name, row_id, action, detail)
  values (auth.uid(), 'deals', p_deal, 'rate_confirmed', coalesce(p_rates, '{}'::jsonb));
end $$;

-- booking: supplier must be onboarded or overridden (app users; data loads are not checked); price may be left open
create or replace function create_deal(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sup uuid; v_deal uuid; v_line jsonb; v_plant uuid; v_rate numeric;
begin
  perform require('deal_edit');
  if jsonb_array_length(coalesce(p->'lines', '[]')) = 0 then raise exception 'Add at least one grade.'; end if;
  v_sup := nullif(p->>'supplier_id', '')::uuid;
  if v_sup is null then
    if nullif(trim(p->>'supplier_name'), '') is null then raise exception 'Choose or add a supplier.'; end if;
    insert into suppliers (name, gstin, state)
    values (trim(p->>'supplier_name'), nullif(upper(trim(p->>'supplier_gstin')), ''), nullif(trim(p->>'supplier_state'), ''))
    returning id into v_sup;
  end if;
  if auth.uid() is not null and supplier_compliance(v_sup) = 'pending' then
    raise exception '% is not onboarded. Finish onboarding, or Himanshu can override it.', (select name from suppliers where id = v_sup)
      using errcode = 'P0001', hint = 'not_compliant';
  end if;
  v_plant := coalesce(nullif(p->>'plant_id', '')::uuid, (select plant_id from profiles where id = auth.uid()),
                      (select id from plants order by name limit 1));
  insert into deals (supplier_id, plant_id, deal_date, expected_date, po_no, po_date, gst_rate,
                     provisional_pct, provisional_days, balance_days, notes, price_basis, price_fix_days)
  values (v_sup, v_plant, coalesce(nullif(p->>'deal_date', '')::date, current_date), nullif(p->>'expected_date', '')::date,
          nullif(trim(p->>'po_no'), ''), nullif(p->>'po_date', '')::date, coalesce(nullif(p->>'gst_rate', '')::numeric, 18),
          nullif(p->>'provisional_pct', '')::numeric, nullif(p->>'provisional_days', '')::int, nullif(p->>'balance_days', '')::int,
          nullif(trim(p->>'notes'), ''), nullif(trim(p->>'price_basis'), ''), nullif(p->>'price_fix_days', '')::int)
  returning id into v_deal;
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    v_rate := nullif(v_line->>'rate_per_kg', '')::numeric;
    if v_rate is null and nullif(trim(p->>'price_basis'), '') is null and coalesce((p->>'open_price')::boolean, false) is false then
      raise exception 'Enter the rate for %, or choose open price.', v_line->>'grade';
    end if;
    insert into deal_lines (deal_id, grade, qty_kg, rate_per_kg)
    values (v_deal, v_line->>'grade', (v_line->>'qty_kg')::numeric, v_rate);
  end loop;
  return v_deal;
end $$;

-- a truck: each line may name another open deal of the same supplier; open-price trucks get a "fix price by" date
create or replace function create_lot(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_deal deals; v_type text; v_kind text; v_inv uuid; v_lot uuid; v_line jsonb; v_tax numeric; v_gst numeric; v_ld uuid; v_days int;
begin
  perform require('inward_edit');
  select * into v_deal from deals where id = (p->>'deal_id')::uuid;
  if not found or v_deal.cancelled then raise exception 'Deal not found.'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]')) = 0 then raise exception 'Add at least one grade.'; end if;
  if nullif(trim(p->>'invoice_no'), '') is null then raise exception 'Document number is required.'; end if;
  select supplier_type into v_type from suppliers where id = v_deal.supplier_id;
  v_kind := doc_kind_for(v_type);
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    v_ld := nullif(v_line->>'deal_id', '')::uuid;
    if v_ld is not null and v_ld <> v_deal.id and not exists
       (select 1 from deals d where d.id = v_ld and d.supplier_id = v_deal.supplier_id and not d.cancelled) then
      raise exception 'Material from another deal must be from the same supplier.';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p->'lines')) <> (select count(distinct x->>'grade') from jsonb_array_elements(p->'lines') x) then
    raise exception 'Each grade once per truck. Put the weights of one grade together.';
  end if;
  if v_type = 'domestic' then
    select round(sum((x->>'billed_net_kg')::numeric * (x->>'billed_rate')::numeric), 2) into v_tax
    from jsonb_array_elements(p->'lines') x;
    v_tax := coalesce(nullif(p->>'taxable_value', '')::numeric, v_tax);
    v_gst := coalesce(nullif(p->>'gst_amount', '')::numeric, round(v_tax * v_deal.gst_rate / 100, 2));
  else
    v_tax := 0; v_gst := 0;
  end if;
  insert into invoices (deal_id, invoice_no, invoice_date, gst_rate, taxable_value, gst_amount, total, doc_kind)
  values (v_deal.id, trim(p->>'invoice_no'), coalesce(nullif(p->>'invoice_date', '')::date, current_date),
          case when v_type = 'domestic' then v_deal.gst_rate else 0 end, v_tax, v_gst,
          case when v_type = 'domestic' then coalesce(nullif(p->>'total', '')::numeric, v_tax + v_gst) else 0 end, v_kind)
  returning id into v_inv;
  insert into lots (deal_id, invoice_id, received_on, vehicle_no, sent_by)
  values (v_deal.id, v_inv, coalesce(nullif(p->>'received_on', '')::date, current_date), nullif(upper(trim(p->>'vehicle_no')), ''),
          nullif(trim(p->>'sent_by'), ''))
  returning id into v_lot;
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    insert into invoice_lines (invoice_id, grade, billed_net_kg, billed_rate, slip_gross_kg, slip_bag_kg)
    values (v_inv, v_line->>'grade', (v_line->>'billed_net_kg')::numeric,
            case when v_type = 'domestic' then (v_line->>'billed_rate')::numeric else 0 end,
            nullif(v_line->>'slip_gross_kg', '')::numeric, nullif(v_line->>'slip_bag_kg', '')::numeric);
    insert into lot_lines (lot_id, deal_id, grade, factory_gross_kg, bag_count, factory_bag_kg)
    values (v_lot, coalesce(nullif(v_line->>'deal_id', '')::uuid, v_deal.id), v_line->>'grade', (v_line->>'factory_gross_kg')::numeric,
            nullif(v_line->>'bag_count', '')::int, coalesce(nullif(v_line->>'factory_bag_kg', '')::numeric, 0));
  end loop;
  if v_type = 'domestic' and exists (select 1 from lot_lines where lot_id = v_lot and agreed_rate is null) then
    select min(d.price_fix_days) into v_days from lot_lines ll join deals d on d.id = ll.deal_id where ll.lot_id = v_lot and ll.agreed_rate is null;
    update lots set price_fix_by = received_on + v_days where id = v_lot and v_days is not null;
  end if;
  if coalesce((p->>'completes_deal')::boolean, false) then
    update deals set receiving_complete = true
    where id in (select distinct ll.deal_id from lot_lines ll where ll.lot_id = v_lot);
  end if;
  return v_lot;
end $$;

-- debit notes wait for the truck's price
create or replace function approve_dn(p_lot uuid, p_type text, p_date date, p_round boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare c record; v_id uuid; v_total numeric;
begin
  perform require('dn_approve');
  if exists (select 1 from lot_lines ll join lots l on l.id = ll.lot_id join invoices i on i.id = l.invoice_id
             where ll.lot_id = p_lot and ll.agreed_rate is null and i.doc_kind = 'tax_invoice') then
    raise exception 'The price of this truck is still open. Himanshu fixes it first.';
  end if;
  if exists (select 1 from v_price_diffs where lot_id = p_lot and status = 'open') then
    raise exception 'The invoice rate differs from the deal. Himanshu or Tinu must confirm the price first.';
  end if;
  if exists (select 1 from lots l join deals d on d.id = l.deal_id where l.id = p_lot and d.unbooked and d.rate_confirmed_at is null) then
    raise exception 'This truck came without a booking. Himanshu must confirm its price first.';
  end if;
  if p_type in ('rate_diff','return') and (select sorting_closed_at from lots where id = p_lot) is null then
    raise exception 'Close sorting for this lot before approving this debit note.';
  end if;
  select * into c from v_dn_calc where lot_id = p_lot and dn_type = p_type;
  if not found then raise exception 'There is nothing to debit for this.'; end if;
  if c.approved then raise exception 'This debit note is already approved.'; end if;
  v_total := case when p_round then c.total_rounded else c.total_exact end;
  perform set_config('ra.via_fn', 'on', true);
  insert into notes (lot_id, invoice_id, dn_type, note_date, taxable, gst_amount, round_off, total, approved_by)
  values (p_lot, c.invoice_id, p_type, coalesce(p_date, current_date), c.taxable, c.gst_amount,
          v_total - (c.taxable + c.gst_amount), v_total, auth.uid())
  returning id into v_id;
  insert into note_lines (note_id, grade, description, qty_kg, rate, amount, stock_kg)
  select v_id, grade, description, qty_kg, rate, amount, stock_kg
  from v_dn_calc_lines where lot_id = p_lot and dn_type = p_type;
  perform set_config('ra.via_fn', 'off', true);
  insert into audit_log (actor, table_name, row_id, action) values (auth.uid(), 'notes', v_id, 'approved');
  return v_id;
end $$;

-- lot lines: each line's own deal; the truck's price is the price fixed on the line (empty = open)
create or replace view v_lot_lines with (security_invoker = true) as
select l.id as lot_id, l.lot_no, d.id as deal_id, d.deal_no, ll.id as lot_line_id, ll.grade,
       g.name as grade_name, g.name_hi as grade_name_hi, g.stock_item,
       ll.agreed_rate as deal_rate, il.billed_rate, coalesce(ll.agreed_rate, il.billed_rate) as dn_rate,
       il.slip_gross_kg, il.slip_bag_kg, (il.slip_gross_kg - il.slip_bag_kg) as slip_net_kg, il.billed_net_kg,
       ll.factory_gross_kg, ll.bag_count, ll.factory_bag_kg, ll.factory_net_kg,
       (il.billed_net_kg - ll.factory_net_kg) as weight_diff_kg,
       greatest(il.billed_net_kg - ll.factory_net_kg, 0) as weight_short_kg,
       greatest(ll.factory_net_kg - il.billed_net_kg, 0) as weight_excess_kg,
       (il.billed_net_kg - (il.slip_gross_kg - il.slip_bag_kg)) as slip_vs_invoice_kg,
       (il.billed_rate - ll.agreed_rate) as rate_vs_deal,
       coalesce(s.sorted_kg, 0) as sorted_kg, coalesce(s.dn_kg, 0) as debit_kg
from lot_lines ll
join lots l on l.id = ll.lot_id
join deals d on d.id = ll.deal_id
join grades g on g.code = ll.grade
left join invoice_lines il on il.invoice_id = l.invoice_id and il.grade = ll.grade
left join (select lot_line_id, sum(sorted_kg) as sorted_kg, sum(dn_kg) as dn_kg
           from sorting_lines group by lot_line_id) s on s.lot_line_id = ll.id;

create or replace view v_deals_incoming with (security_invoker = true) as
select d.id as deal_id, d.deal_no, d.po_no, s.id as supplier_id, s.name as supplier, d.deal_date, d.expected_date, d.gst_rate,
       sum(dl.qty_kg) as ordered_kg,
       sum(least(coalesce(r.kg, 0), dl.qty_kg)) as received_kg,
       sum(greatest(dl.qty_kg - coalesce(r.kg, 0), 0)) as remaining_kg,
       round(sum(greatest(dl.qty_kg - coalesce(r.kg, 0), 0) * coalesce(dl.rate_per_kg, 0)) * (1 + d.gst_rate / 100), 2) as remaining_value,
       (select count(distinct ll.lot_id) from lot_lines ll where ll.deal_id = d.id) as lots,
       case when d.expected_date < current_date then current_date - d.expected_date else 0 end as days_late,
       bool_or(dl.rate_per_kg is null) as price_open, d.price_basis
from deals d
join suppliers s on s.id = d.supplier_id
join deal_lines dl on dl.deal_id = d.id
left join (select ll.deal_id, il.grade, sum(il.billed_net_kg) as kg
           from lot_lines ll join lots l on l.id = ll.lot_id
           join invoice_lines il on il.invoice_id = l.invoice_id and il.grade = ll.grade group by 1, 2) r
       on r.deal_id = d.id and r.grade = dl.grade
where not d.cancelled and not d.receiving_complete
group by d.id, s.id;

create or replace view v_stock_position with (security_invoker = true) as
with fac as (select item, sum(kg) as kg from v_stock_moves where move_date <= current_date group by item),
wip as (select pl.item, sum(pl.kg) as kg, count(distinct r.id) as runs
        from production_lines pl join production_runs r on r.id = pl.run_id
        where r.status = 'open' and pl.direction = 'consumed' group by pl.item),
booked as (
  select g.stock_item as item, sum(greatest(dl.qty_kg - coalesce(r.kg, 0), 0)) as kg, count(distinct d.id) as deals
  from deals d join deal_lines dl on dl.deal_id = d.id join grades g on g.code = dl.grade
  left join (select ll.deal_id, il.grade, sum(il.billed_net_kg) as kg
             from lot_lines ll join lots l on l.id = ll.lot_id
             join invoice_lines il on il.invoice_id = l.invoice_id and il.grade = ll.grade group by 1, 2) r
         on r.deal_id = d.id and r.grade = dl.grade
  where not d.cancelled and not d.receiving_complete
  group by g.stock_item having sum(greatest(dl.qty_kg - coalesce(r.kg, 0), 0)) > 0)
select i.code as item, i.name, i.name_hi, i.kind, i.sort,
       coalesce(fac.kg, 0) as in_factory, coalesce(wip.kg, 0) as in_production, coalesce(wip.runs, 0) as open_runs,
       coalesce(booked.kg, 0) as booked, coalesce(booked.deals, 0) as booked_deals
from items i
left join fac on fac.item = i.code left join wip on wip.item = i.code left join booked on booked.item = i.code
where coalesce(fac.kg, 0) <> 0 or coalesce(wip.kg, 0) <> 0 or coalesce(booked.kg, 0) <> 0;

create or replace view v_lots with (security_invoker = true) as
select l.id as lot_id, l.lot_no, d.id as deal_id, d.deal_no, d.po_no, s.id as supplier_id, s.name as supplier,
       l.received_on, l.vehicle_no, (current_date - l.received_on) as days_open,
       l.invoice_id, i.invoice_no, i.invoice_date, i.total as invoice_total,
       l.sorting_closed_at,
       coalesce(p.notes, 0) as notes_total, coalesce(p.tds, 0) as tds_total, coalesce(p.paid, 0) as paid,
       coalesce(p.pending, 0) as pending, coalesce(p.balance, 0) as balance,
       (select count(*) from v_tally_missing m where m.lot_id = l.id and m.book = 'factory' and m.entity in ('invoice','note')) as tally_factory_missing,
       (select count(*) from v_tally_missing m where m.lot_id = l.id and m.book = 'office' and m.entity in ('invoice','note')) as tally_office_missing,
       (select count(*) from v_doc_gaps g where g.deal_id = d.id) as doc_gaps,
       (select count(*) from returns r where r.lot_id = l.id and r.delivered_on is null) as returns_open,
       coalesce((select sum(weight_short_kg) from v_lot_lines v where v.lot_id = l.id), 0) as weight_short_kg,
       coalesce((select sum(weight_excess_kg) from v_lot_lines v where v.lot_id = l.id), 0) as weight_excess_kg,
       case
         when l.sorting_closed_at is null and not exists
              (select 1 from sorting_lines x join lot_lines ll on ll.id = x.lot_line_id where ll.lot_id = l.id) then 'received'
         when l.sorting_closed_at is null then 'sorting'
         when exists (select 1 from v_dn_calc c where c.lot_id = l.id and not c.approved)
           or exists (select 1 from v_price_diffs pd where pd.lot_id = l.id and pd.status = 'open')
           or (i.doc_kind = 'tax_invoice' and exists (select 1 from lot_lines x where x.lot_id = l.id and x.agreed_rate is null)) then 'dn_pending'
         when exists (select 1 from v_tally_missing m where m.lot_id = l.id and m.entity in ('invoice','note')) then 'tally_pending'
         when not lot_is_paid(l.invoice_id) then 'payment_pending'
         else 'settled'
       end as stage,
       s.supplier_type, i.doc_kind, l.sent_by,
       d.unbooked, d.rate_confirmed_at,
       (i.doc_kind = 'tax_invoice' and exists (select 1 from lot_lines x where x.lot_id = l.id and x.agreed_rate is null)) as price_open,
       l.price_fix_by,
       (select string_agg(distinct d2.deal_no, ' + ') from lot_lines x join deals d2 on d2.id = x.deal_id where x.lot_id = l.id) as deal_nos,
       (select array_agg(distinct x.deal_id) from lot_lines x where x.lot_id = l.id) as deal_ids
from lots l
join deals d on d.id = l.deal_id
join suppliers s on s.id = d.supplier_id
left join invoices i on i.id = l.invoice_id
left join v_payable p on p.invoice_id = l.invoice_id
where not d.cancelled;

-- ================= to-do lists: + price to fix =================
create or replace view v_tasks with (security_invoker = true) as
select * from (
  select 'doc_verify'::text as kind, 'doc_verify'::text as action, 'deal'::text as ref_type, d.id as ref_id,
         d.deal_no as ref_no, s.name as supplier, t.name as detail, t.name_hi as detail_hi,
         x.uploaded_at::date as since, null::numeric as amount
  from documents x join deals d on d.id = x.deal_id join suppliers s on s.id = d.supplier_id
  join doc_types t on t.code = x.doc_type where x.status = 'uploaded'
  union all
  select 'doc_approve', 'doc_approve', 'deal', d.id, d.deal_no, s.name, t.name, t.name_hi, x.uploaded_at::date, null
  from documents x join deals d on d.id = x.deal_id join suppliers s on s.id = d.supplier_id
  join doc_types t on t.code = x.doc_type where x.status = 'verified'
  union all
  select 'sorting_open', 'sorting_edit', 'lot', lot_id, lot_no, supplier, null, null, received_on, null
  from v_lots where stage in ('received','sorting')
  union all
  select 'dn_pending', 'dn_approve', 'lot', lot_id, lot_no, supplier, null, null, received_on, null
  from v_lots where stage = 'dn_pending' and not price_open
  union all
  select 'tally_factory', 'tally_factory', 'lot', v.lot_id, v.lot_no, v.supplier, null, null, v.received_on, null
  from v_lots v where v.tally_factory_missing > 0
  union all
  select 'tally_office', 'tally_office', 'lot', v.lot_id, v.lot_no, v.supplier, null, null, v.received_on, null
  from v_lots v where v.tally_office_missing > 0
  union all
  select 'tally_factory', 'tally_factory', 'production', m.entity_id, to_char(m.entry_date, 'DD Mon'), null, 'production', null, m.entry_date, null
  from v_tally_missing m where m.entity = 'production'
  union all
  select 'tally_office', 'tally_office', 'money', m.entity_id, m.entity, null, m.entity, null, m.entry_date, null
  from v_tally_missing m where m.entity in ('payment','tds') and m.lot_id is null
  union all
  select 'payment_reco', 'payment_reconcile', 'money', p.id, coalesce(d.deal_no, ''), s.name, p.mode, null, p.paid_on, p.amount
  from payments p join suppliers s on s.id = p.supplier_id left join deals d on d.id = p.deal_id where p.status = 'entered'
  union all
  select 'payment_fix', 'payment_enter', 'money', p.id, coalesce(d.deal_no, ''), s.name, p.reject_note, null, p.paid_on, p.amount
  from payments p join suppliers s on s.id = p.supplier_id left join deals d on d.id = p.deal_id where p.status = 'rejected'
  union all
  select 'gst_2b', 'gst_2b', 'money', i.id, i.invoice_no, s.name, null, null, i.invoice_date, i.gst_amount
  from invoices i join deals d on d.id = i.deal_id join suppliers s on s.id = d.supplier_id
  where not i.in_2b and i.invoice_date < date_trunc('month', current_date) and i.doc_kind = 'tax_invoice'
  union all
  select 'tally_changed', case when c.book = 'factory' then 'tally_factory' else 'tally_office' end, 'tally', c.entity_id,
         c.entity, null, c.book, null, c.marked_at::date, c.amount_now
  from v_tally_changes c
  union all
  select 'ledger_confirm', 'ledger_confirm', 'supplier', b.supplier_id, null, b.supplier, null, null, b.last_confirmed_on, b.balance
  from v_supplier_balance b
  where abs(b.balance) > 0.005 and (b.last_confirmed_on is null or b.last_confirmed_on < current_date - 30)
  union all
  select distinct 'terms_missing', 'admin', 'supplier', c.supplier_id, null, c.supplier, null, null, null::date, null::numeric
  from v_cash_plan c where c.terms_missing
  union all
  select 'rate_confirm', 'rate_confirm', 'deal', d.id, d.deal_no, s.name, null, null, d.deal_date, null
  from deals d join suppliers s on s.id = d.supplier_id
  where d.unbooked and d.rate_confirmed_at is null and not d.cancelled
  union all
  select 'arrival_late', 'deal_edit', 'deal', g.deal_id, g.deal_no, g.supplier, null, null, g.expected_date, g.remaining_kg
  from v_deals_incoming g where g.days_late > 0
  union all
  select 'price_decide', 'price_decide', 'lot', p.lot_id, p.lot_no, p.supplier, null, null, min(p.invoice_date), sum(p.total)
  from v_price_diffs p where p.status = 'open' group by p.lot_id, p.lot_no, p.supplier
  union all
  select 'po_missing', 'deal_edit', 'deal', d.id, d.deal_no, s.name, null, null, d.deal_date, null
  from deals d join suppliers s on s.id = d.supplier_id
  where d.po_issued_at is null and not d.cancelled and not d.unbooked and s.supplier_type = 'domestic'
  union all
  select 'hold_reached', 'payment_enter', h.scope, h.ref_id, h.ref_no, h.supplier, to_char(h.release_on, 'YYYY-MM-DD'), null, h.reached_on, h.held
  from v_payment_holds h
  where h.status = 'holding'
    and not exists (select 1 from payment_hold_acks a where a.scope = h.scope and a.ref_id = h.ref_id and a.reached_on = h.reached_on)
  union all
  select 'hold_release', 'payment_enter', h.scope, h.ref_id, h.ref_no, h.supplier, null, null, h.release_on, h.held
  from v_payment_holds h where h.status = 'release_due'
  union all
  select 'supplier_onboard', 'supplier_onboard', 'supplier', s.id, null, s.name, null, null, s.created_at::date, null
  from suppliers s
  where s.onboarded_at is null and s.compliance_override_at is null and s.active and s.supplier_type = 'domestic'
    and exists (select 1 from deals d where d.supplier_id = s.id and not d.cancelled)
  union all
  select 'reminder_due', 'reminder', 'reminder', r.id, r.title, s.name, r.note, null, r.next_due, null
  from reminders r left join suppliers s on s.id = r.supplier_id
  where r.active and r.next_due <= current_date
    and (r.for_role = public.my_role() or (public.my_role() = 'vbog_admin' and r.for_role = 'owner'))
  union all
  -- open price: fix it (on or after the fix-by date; at once if no date was set)
  select 'price_to_fix', 'rate_confirm', 'lot', v.lot_id, v.lot_no, v.supplier, v.deal_nos, null, coalesce(v.price_fix_by, v.received_on), null
  from v_lots v where v.price_open and (v.price_fix_by is null or v.price_fix_by <= current_date)
) t
where public.can(t.action);

revoke execute on function supplier_compliance(uuid), override_compliance(uuid, text), clear_compliance_override(uuid) from public, anon;
grant execute on function supplier_compliance(uuid), override_compliance(uuid, text), clear_compliance_override(uuid) to authenticated;
