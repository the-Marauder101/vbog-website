-- A truck's price is fixed when it enters the factory (Depesh, 20 Nov; replaces the debit-note lock of 0012).
-- * When a lot is logged, each grade takes the deal's rate at that moment (lot_lines.agreed_rate). Later changes to
--   the deal rate apply only to trucks still to come.
-- * If the invoice rate differs, Himanshu or Tinu (price_decide) confirms the price: accept the invoice rate (this
--   truck, and the deal for trucks still to come) or keep the agreed rate (debit note for any excess).
--   An unbooked truck's price is confirmed by Himanshu (rate_confirm).
-- * After that only Himanshu (rate_confirm: owner, vbog_admin) changes a truck's price, on the lot, with history.
-- * Debit notes wait for the price: none can be approved while the truck's price is still to be confirmed.
--   A truck's price cannot change under an approved debit note (cancel it first).

alter table deal_rate_history drop constraint deal_rate_history_source_check;
alter table deal_rate_history add constraint deal_rate_history_source_check
  check (source in ('booked','changed','accepted_invoice','confirmed_unbooked','truck_changed'));

-- every truck already in: fix its price at today's deal rate (what it is settled at now)
select set_config('ra.via_fn', 'on', true);
update lot_lines ll set agreed_rate = dl.rate_per_kg
from lots l join deal_lines dl on dl.deal_id = l.deal_id
where l.id = ll.lot_id and dl.grade = ll.grade and ll.agreed_rate is null;
select set_config('ra.via_fn', 'off', true);

-- a new truck takes the deal rate; nobody types a truck's price directly
create function pin_truck_price() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.agreed_rate is null or not via_fn() then
      select dl.rate_per_kg into new.agreed_rate
      from lots l join deal_lines dl on dl.deal_id = l.deal_id and dl.grade = new.grade where l.id = new.lot_id;
    end if;
  elsif new.agreed_rate is distinct from old.agreed_rate and not via_fn() then
    raise exception 'Only Himanshu can change a truck''s price, from the lot.';
  end if;
  return new;
end $$;
create trigger pin_price before insert or update of agreed_rate on lot_lines for each row execute function pin_truck_price();

-- the deal rate: only the deal changes; trucks already in keep their price
create or replace function apply_deal_rate(p_deal uuid, p_grade text, p_rate numeric, p_source text, p_lot uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old numeric;
begin
  if p_rate is null or p_rate <= 0 then raise exception 'Enter the rate for %.', p_grade; end if;
  select rate_per_kg into v_old from deal_lines where deal_id = p_deal and grade = p_grade;
  if not found then raise exception 'Grade % is not on this deal.', p_grade; end if;
  if v_old = p_rate then return; end if;
  perform set_config('ra.rate_source', p_source, true);
  perform set_config('ra.rate_lot', coalesce(p_lot::text, ''), true);
  perform set_config('ra.rate_note', coalesce(p_note, ''), true);
  update deal_lines set rate_per_kg = p_rate where deal_id = p_deal and grade = p_grade;
  perform set_config('ra.rate_source', '', true); perform set_config('ra.rate_lot', '', true); perform set_config('ra.rate_note', '', true);
end $$;

-- the one place a truck's price changes (internal). p_log: write a truck history row
create function apply_truck_price(p_lot uuid, p_grade text, p_rate numeric, p_source text, p_note text, p_log boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_old numeric; v_deal uuid; v_billed numeric; v_kind text;
begin
  if p_rate is null or p_rate <= 0 then raise exception 'Enter the price for %.', p_grade; end if;
  select ll.agreed_rate, l.deal_id, il.billed_rate, i.doc_kind into v_old, v_deal, v_billed, v_kind
  from lot_lines ll join lots l on l.id = ll.lot_id
  left join invoices i on i.id = l.invoice_id
  left join invoice_lines il on il.invoice_id = l.invoice_id and il.grade = ll.grade
  where ll.lot_id = p_lot and ll.grade = p_grade;
  if not found then raise exception 'Grade % is not on this truck.', p_grade; end if;
  if v_old = p_rate then return; end if;
  if lot_has_notes(p_lot) then
    raise exception 'This truck has an approved debit note. Cancel it first, then change the price.';
  end if;
  perform set_config('ra.via_fn', 'on', true);
  update lot_lines set agreed_rate = p_rate where lot_id = p_lot and grade = p_grade;
  perform set_config('ra.via_fn', 'off', true);
  if p_log then
    insert into deal_rate_history (deal_id, grade, old_rate, new_rate, source, lot_id, note)
    values (v_deal, p_grade, v_old, p_rate, p_source, p_lot, p_note);
  end if;
  -- a price set by Himanshu that still differs from the invoice is his decision: no second question
  if v_kind = 'tax_invoice' and v_billed is not null and v_billed <> p_rate then
    insert into price_decisions (lot_id, grade, invoice_rate, agreed_rate, decision)
    values (p_lot, p_grade, v_billed, p_rate, 'kept_agreed');
  end if;
end $$;

create function set_lot_rate(p_lot uuid, p_grade text, p_rate numeric, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require('rate_confirm');
  perform apply_truck_price(p_lot, p_grade, p_rate, 'truck_changed', nullif(trim(p_note), ''), true);
  insert into audit_log (actor, table_name, row_id, action, detail)
  values (auth.uid(), 'lots', p_lot, 'price_changed', jsonb_build_object('grade', p_grade, 'rate', p_rate));
end $$;

-- confirming the invoice rate difference
create or replace function decide_price(p_lot uuid, p_choice text) returns void
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  perform require('price_decide');
  if p_choice not in ('accept_invoice','keep_agreed') then raise exception 'Choose accept the invoice rate or keep the agreed rate.'; end if;
  for r in select * from v_price_diffs where lot_id = p_lot and status = 'open' loop
    n := n + 1;
    insert into price_decisions (lot_id, grade, invoice_rate, agreed_rate, decision)
    values (p_lot, r.grade, r.invoice_rate, r.agreed_rate,
            case when p_choice = 'accept_invoice' then 'accepted_invoice' else 'kept_agreed' end);
    if p_choice = 'accept_invoice' then
      -- this truck at the invoice rate; the deal too, for trucks still to come (one history row, tied to this truck)
      perform apply_truck_price(p_lot, r.grade, r.invoice_rate, 'accepted_invoice', r.invoice_no, false);
      if (select rate_per_kg from deal_lines where deal_id = r.deal_id and grade = r.grade) is distinct from r.invoice_rate then
        perform apply_deal_rate(r.deal_id, r.grade, r.invoice_rate, 'accepted_invoice', p_lot, r.invoice_no);
      else
        insert into deal_rate_history (deal_id, grade, old_rate, new_rate, source, lot_id, note)
        values (r.deal_id, r.grade, r.agreed_rate, r.invoice_rate, 'accepted_invoice', p_lot, r.invoice_no);
      end if;
    end if;
  end loop;
  if n = 0 then raise exception 'Nothing to decide on this lot.'; end if;
  insert into audit_log (actor, table_name, row_id, action, detail)
  values (auth.uid(), 'lots', p_lot, 'price_' || p_choice, jsonb_build_object('grades', n));
end $$;

-- unbooked truck: Himanshu's confirmation is the truck's price, and the deal's
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
      for l in select ll.lot_id from lot_lines ll join lots x on x.id = ll.lot_id where x.deal_id = p_deal and ll.grade = k loop
        perform apply_truck_price(l, k, v, 'confirmed_unbooked', null, false);
      end loop;
      perform apply_deal_rate(p_deal, k, v, 'confirmed_unbooked', null, null);
    end loop;
  end if;
  update deals set rate_confirmed_at = now(), rate_confirmed_by = auth.uid() where id = p_deal;
  insert into audit_log (actor, table_name, row_id, action, detail)
  values (auth.uid(), 'deals', p_deal, 'rate_confirmed', coalesce(p_rates, '{}'::jsonb));
end $$;

-- debit notes wait for the truck's price
create or replace function approve_dn(p_lot uuid, p_type text, p_date date, p_round boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare c record; v_id uuid; v_total numeric;
begin
  perform require('dn_approve');
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

revoke execute on function apply_truck_price(uuid, text, numeric, text, text, boolean) from public, anon, authenticated;
revoke execute on function pin_truck_price() from public, anon, authenticated;
revoke execute on function set_lot_rate(uuid, text, numeric, text) from public, anon;
grant execute on function set_lot_rate(uuid, text, numeric, text) to authenticated;
