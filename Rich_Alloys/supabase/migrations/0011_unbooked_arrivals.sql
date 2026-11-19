-- Bookings and trucks that arrive without one.
-- Himanshu books a supply (deal: rate, quantity, expected arrival); the team logs trucks against it.
-- A domestic truck that arrives with no booking is still recorded and tallied in full: lot, tax invoice, debit notes,
-- payable, cash plan, ledger, both Tally queues and stock. Its deal is marked unbooked and its rate is taken from the
-- invoice until someone with 'rate_confirm' (owner, vbog_admin) confirms it, correcting it first if the phone deal differs.
-- A booked supply past its expected arrival date shows as late.

alter table deals
  add column unbooked boolean not null default false,
  add column rate_confirmed_at timestamptz,
  add column rate_confirmed_by uuid references profiles(id);

insert into permissions (action, role) values ('rate_confirm', 'owner'), ('rate_confirm', 'vbog_admin')
on conflict do nothing;

-- One step for a truck that came without a booking: supplier (existing or new), deal from the invoice, lot.
create function create_unbooked_lot(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sup uuid; v_type text; v_deal uuid; v_plant uuid; v_line jsonb;
begin
  perform require('inward_edit');
  if jsonb_array_length(coalesce(p->'lines', '[]')) = 0 then raise exception 'Add at least one grade.'; end if;
  v_sup := nullif(p->>'supplier_id', '')::uuid;
  if v_sup is null then
    if nullif(trim(p->>'supplier_name'), '') is null then raise exception 'Choose or add the supplier.'; end if;
    insert into suppliers (name, gstin, state, supplier_type)
    values (trim(p->>'supplier_name'), nullif(upper(trim(p->>'supplier_gstin')), ''), nullif(trim(p->>'supplier_state'), ''), 'domestic')
    returning id into v_sup;
  end if;
  select supplier_type into v_type from suppliers where id = v_sup and active;
  if v_type is null then raise exception 'Supplier not found.'; end if;
  if v_type <> 'domestic' then raise exception 'Material from the branch, an import seller or a job worker is recorded with its own form.'; end if;
  v_plant := coalesce((select plant_id from profiles where id = auth.uid()), (select id from plants order by name limit 1));
  insert into deals (supplier_id, plant_id, deal_date, gst_rate, receiving_complete, unbooked, notes)
  values (v_sup, v_plant, coalesce(nullif(p->>'received_on', '')::date, current_date),
          coalesce(nullif(p->>'gst_rate', '')::numeric, 18), true, true, 'Arrived without a booking; rate from the invoice')
  returning id into v_deal;
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    insert into deal_lines (deal_id, grade, qty_kg, rate_per_kg)
    values (v_deal, v_line->>'grade', (v_line->>'billed_net_kg')::numeric, (v_line->>'billed_rate')::numeric);
  end loop;
  return create_lot(p || jsonb_build_object('deal_id', v_deal));
end $$;

-- Himanshu confirms the rate of an unbooked truck, correcting it first if the phone deal was different.
-- p_rates: {"OC": 1234, "LAL": 1319} (optional). A corrected rate drives the debit notes, and the invoice rate
-- then shows as different from the deal on the lot, as for any booked deal.
create function confirm_deal_rate(p_deal uuid, p_rates jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v numeric;
begin
  perform require('rate_confirm');
  if not exists (select 1 from deals where id = p_deal and unbooked and not cancelled) then
    raise exception 'Only a truck that arrived without a booking needs its rate confirmed.';
  end if;
  if p_rates is not null and jsonb_typeof(p_rates) = 'object' then
    for k, v in select key, value::numeric from jsonb_each_text(p_rates) loop
      if v <= 0 then raise exception 'Enter the agreed rate for %.', k; end if;
      if exists (select 1 from deal_lines where deal_id = p_deal and grade = k and rate_per_kg <> v)
         and exists (select 1 from notes n join lots l on l.id = n.lot_id where l.deal_id = p_deal and n.status <> 'cancelled') then
        raise exception 'Debit notes are approved for this truck. Cancel them before changing the rate.';
      end if;
      update deal_lines set rate_per_kg = v where deal_id = p_deal and grade = k;
    end loop;
  end if;
  update deals set rate_confirmed_at = now(), rate_confirmed_by = auth.uid() where id = p_deal;
  insert into audit_log (actor, table_name, row_id, action, detail)
  values (auth.uid(), 'deals', p_deal, 'rate_confirmed', coalesce(p_rates, '{}'::jsonb));
end $$;

revoke execute on function create_unbooked_lot(jsonb), confirm_deal_rate(uuid, jsonb) from public, anon;
grant execute on function create_unbooked_lot(jsonb), confirm_deal_rate(uuid, jsonb) to authenticated;

-- deals on the way: the same columns, plus how many days late
create or replace view v_deals_incoming with (security_invoker = true) as
select d.id as deal_id, d.deal_no, d.po_no, s.id as supplier_id, s.name as supplier, d.deal_date, d.expected_date, d.gst_rate,
       sum(dl.qty_kg) as ordered_kg,
       sum(least(coalesce(r.kg, 0), dl.qty_kg)) as received_kg,
       sum(greatest(dl.qty_kg - coalesce(r.kg, 0), 0)) as remaining_kg,
       round(sum(greatest(dl.qty_kg - coalesce(r.kg, 0), 0) * dl.rate_per_kg) * (1 + d.gst_rate / 100), 2) as remaining_value,
       (select count(*) from lots l where l.deal_id = d.id) as lots,
       case when d.expected_date < current_date then current_date - d.expected_date else 0 end as days_late
from deals d
join suppliers s on s.id = d.supplier_id
join deal_lines dl on dl.deal_id = d.id
left join (select l.deal_id, il.grade, sum(il.billed_net_kg) as kg
           from lots l join invoice_lines il on il.invoice_id = l.invoice_id group by 1, 2) r
       on r.deal_id = d.id and r.grade = dl.grade
where not d.cancelled and not d.receiving_complete
group by d.id, s.id;

-- lots: the same columns, plus whether the truck came without a booking and whether its rate is confirmed
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
         when exists (select 1 from v_dn_calc c where c.lot_id = l.id and not c.approved) then 'dn_pending'
         when exists (select 1 from v_tally_missing m where m.lot_id = l.id and m.entity in ('invoice','note')) then 'tally_pending'
         when not lot_is_paid(l.invoice_id) then 'payment_pending'
         else 'settled'
       end as stage,
       s.supplier_type, i.doc_kind, l.sent_by,
       d.unbooked, d.rate_confirmed_at
from lots l
join deals d on d.id = l.deal_id
join suppliers s on s.id = d.supplier_id
left join invoices i on i.id = l.invoice_id
left join v_payable p on p.invoice_id = l.invoice_id
where not d.cancelled;

-- to-do lists: as before, plus rates to confirm and late supplies
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
  from v_lots where stage = 'dn_pending'
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
  -- a truck that came without a booking: the rate is the invoice's until Himanshu confirms it
  select 'rate_confirm', 'rate_confirm', 'deal', d.id, d.deal_no, s.name, null, null, d.deal_date, null
  from deals d join suppliers s on s.id = d.supplier_id
  where d.unbooked and d.rate_confirmed_at is null and not d.cancelled
  union all
  -- a booked supply past its expected date with material still to come
  select 'arrival_late', 'deal_edit', 'deal', g.deal_id, g.deal_no, g.supplier, null, null, g.expected_date, g.remaining_kg
  from v_deals_incoming g where g.days_late > 0
) t
where public.can(t.action);
