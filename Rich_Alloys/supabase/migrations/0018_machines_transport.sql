-- Depesh, 24 Nov:
--  1. Machine purchases: what Himanshu ordered, from whom, value, the payment schedule (advance, dispatch,
--     installation...) and what has been paid; its own cash projection (paid / to be paid by date).
--  2. Transport: when Rich Alloys arranges the truck, a booking (transporter, vehicle, booked price) against a deal.
--     When the truck arrives the booking is attached to the lot and locked; the transporter's bill is compared
--     with the booked price and any difference is an alert. (Most deals are delivered at the factory gate: no booking.)

create sequence machine_seq;
create sequence transport_seq;
grant usage, select on sequence machine_seq, transport_seq to authenticated;   -- numbers are drawn by direct inserts from the app

-- ================= 1. machines =================
create table machine_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique default ('M-' || lpad(nextval('machine_seq')::text, 3, '0')),
  vendor text not null check (length(trim(vendor)) > 0),
  vendor_gstin text,
  description text not null check (length(trim(description)) > 0),
  ref_no text,                                         -- vendor's quotation / our PO reference
  ordered_on date not null default current_date,
  expected_on date,
  value numeric(14,2) not null check (value >= 0),    -- excluding GST
  gst_rate numeric(5,2) not null default 18 check (gst_rate between 0 and 40),
  status text not null default 'ordered' check (status in ('ordered','delivered','installed','cancelled')),
  delivered_on date,
  notes text,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create table machine_milestones (                     -- the payment schedule; amounts include GST
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references machine_orders(id) on delete cascade,
  label text not null check (length(trim(label)) > 0),
  due_on date not null,
  amount numeric(14,2) not null check (amount > 0),
  sort int not null default 0
);
create table machine_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references machine_orders(id) on delete cascade,
  paid_on date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  mode text not null default 'neft' check (mode in ('neft','rtgs','imps','cheque','cash','other')),
  bank_ref text,
  entered_by uuid references profiles(id) default auth.uid(),
  entered_at timestamptz not null default now()
);

-- ================= 2. transport =================
create table transport_bookings (
  id uuid primary key default gen_random_uuid(),
  booking_no text not null unique default ('T-' || lpad(nextval('transport_seq')::text, 4, '0')),
  deal_id uuid references deals(id),
  lot_id uuid unique references lots(id),             -- the truck it brought (one booking per lot)
  transporter text not null check (length(trim(transporter)) > 0),
  transporter_phone text,
  vehicle_no text,
  driver_phone text,
  from_place text,
  booked_on date not null default current_date,
  pickup_on date,
  booked_price numeric(12,2) not null check (booked_price >= 0),
  bill_no text,
  bill_date date,
  bill_amount numeric(12,2) check (bill_amount >= 0),
  paid_amount numeric(12,2) check (paid_amount >= 0),
  paid_on date,
  status text not null default 'booked' check (status in ('booked','cancelled')),
  locked_at timestamptz,                               -- set when attached to a lot: booked price and truck are fixed
  note text,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

insert into permissions (action, role) values
  ('machine_edit', 'owner'), ('machine_edit', 'vbog_admin'), ('machine_edit', 'ho_accounts'),
  ('transport_edit', 'owner'), ('transport_edit', 'vbog_admin'), ('transport_edit', 'factory_accounts'),
  ('transport_edit', 'ho_accounts'), ('transport_edit', 'deal_desk')
on conflict do nothing;

do $$ declare t text; begin
  foreach t in array array['machine_orders','machine_milestones','machine_payments','transport_bookings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
  foreach t in array array['machine_orders','machine_milestones','machine_payments'] loop
    execute format('create policy money_read on public.%I for select to authenticated using (public.can(''money_view'') or public.can(''machine_edit''))', t);
    execute format('create policy can_insert on public.%I for insert to authenticated with check (public.can(''machine_edit''))', t);
    execute format('create policy can_update on public.%I for update to authenticated using (public.can(''machine_edit'')) with check (public.can(''machine_edit''))', t);
    execute format('create policy can_delete on public.%I for delete to authenticated using (public.can(''machine_edit''))', t);
  end loop;
end $$;
create policy staff_read on transport_bookings for select to authenticated using (public.is_staff());
create policy can_insert on transport_bookings for insert to authenticated with check (public.can('transport_edit') and lot_id is null and locked_at is null);
create policy can_update on transport_bookings for update to authenticated using (public.can('transport_edit')) with check (public.can('transport_edit'));
create policy can_delete on transport_bookings for delete to authenticated using (public.can('transport_edit') and lot_id is null);

-- a locked booking keeps its truck and price; attaching and detaching go through the functions below
create function guard_transport() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not via_fn() and (new.lot_id is distinct from old.lot_id or new.locked_at is distinct from old.locked_at) then
    raise exception 'Attach or detach a truck from the lot.';
  end if;
  if old.locked_at is not null and not via_fn()
     and (new.booked_price is distinct from old.booked_price or new.vehicle_no is distinct from old.vehicle_no
          or new.transporter is distinct from old.transporter or new.deal_id is distinct from old.deal_id) then
    raise exception 'This booking is locked to its lot. Detach it first to change the booked price or truck.';
  end if;
  return new;
end $$;
create trigger guard before update on transport_bookings for each row execute function guard_transport();

-- the truck that brought this lot: attach (and lock). Whoever records the arrival can do it.
create function attach_transport(p_booking uuid, p_lot uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b transport_bookings;
begin
  if not (public.can('transport_edit') or public.can('inward_edit')) then
    raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
  end if;
  select * into b from transport_bookings where id = p_booking;
  if not found or b.status = 'cancelled' then raise exception 'Transport booking not found.'; end if;
  if b.lot_id is not null and b.lot_id <> p_lot then raise exception 'This booking already brought another lot.'; end if;
  if exists (select 1 from transport_bookings where lot_id = p_lot and id <> p_booking) then raise exception 'This lot already has a truck booking.'; end if;
  perform set_config('ra.via_fn', 'on', true);
  update transport_bookings set lot_id = p_lot, locked_at = coalesce(locked_at, now()) where id = p_booking;
  perform set_config('ra.via_fn', 'off', true);
  update lots set vehicle_no = coalesce(vehicle_no, upper(b.vehicle_no)) where id = p_lot;
end $$;

create function detach_transport(p_booking uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require('transport_edit');
  perform set_config('ra.via_fn', 'on', true);
  update transport_bookings set lot_id = null, locked_at = null where id = p_booking;
  perform set_config('ra.via_fn', 'off', true);
end $$;

create view v_transport with (security_invoker = true) as
select b.*, d.deal_no, s.name as supplier, l.lot_no, i.invoice_no,
       b.bill_amount - b.booked_price as bill_diff,
       (b.bill_amount is not null and abs(b.bill_amount - b.booked_price) > 0.005) as bill_differs,
       coalesce(b.bill_amount, b.booked_price) - coalesce(b.paid_amount, 0) as to_pay
from transport_bookings b
left join deals d on d.id = b.deal_id
left join suppliers s on s.id = d.supplier_id
left join lots l on l.id = b.lot_id
left join invoices i on i.id = l.invoice_id;
revoke all on v_transport from anon;
grant select on v_transport to authenticated;

-- ================= machine views =================
create view v_machine_orders with (security_invoker = true) as
select o.*, round(o.value * (1 + o.gst_rate / 100), 2) as total,
       coalesce((select sum(amount) from machine_milestones m where m.order_id = o.id), 0) as scheduled,
       coalesce((select sum(amount) from machine_payments p where p.order_id = o.id), 0) as paid,
       round(o.value * (1 + o.gst_rate / 100), 2) - coalesce((select sum(amount) from machine_payments p where p.order_id = o.id), 0) as balance
from machine_orders o
where public.can('money_view') or public.can('machine_edit');
revoke all on v_machine_orders from anon;
grant select on v_machine_orders to authenticated;

-- payments fill the schedule in date order; what is left of each milestone is still to pay.
-- Any part of the order value not in the schedule shows as one line without a date.
create view v_machine_cash with (security_invoker = true) as
with o as (select * from v_machine_orders where status <> 'cancelled'),
ms as (
  select m.order_id, m.id as milestone_id, m.label, m.due_on, m.amount,
         sum(m.amount) over (partition by m.order_id order by m.due_on, m.sort, m.id) as cum
  from machine_milestones m join o on o.id = m.order_id
)
select o.id as order_id, o.order_no, o.vendor, o.description, ms.milestone_id, ms.label, ms.due_on, ms.amount,
       greatest(least(ms.amount, ms.cum - o.paid), 0) as outstanding
from ms join o on o.id = ms.order_id
union all
select o.id, o.order_no, o.vendor, o.description, null, 'Not scheduled', null, o.total - o.scheduled,
       greatest(least(o.total - o.scheduled, o.total - greatest(o.paid, o.scheduled)), 0)
from o where o.total - o.scheduled > 0.005;
revoke all on v_machine_cash from anon;
grant select on v_machine_cash to authenticated;

-- ================= lot table: freight =================
create or replace view v_lot_register with (security_invoker = true) as
with ln as (
  select v.lot_id, string_agg(v.grade_name, ', ' order by v.grade) as grades,
         sum(v.billed_net_kg) as billed_kg, sum(v.factory_net_kg) as factory_kg, sum(v.weight_short_kg) as weight_short_kg,
         string_agg(v.grade_name || ' ' || to_char(v.billed_rate, 'FM999G999D00'), ' · ' order by v.grade) as invoice_rates,
         string_agg(v.grade_name || ' ' || to_char(v.deal_rate, 'FM999G999D00'), ' · ' order by v.grade) as our_rates,
         sum(v.bag_count) as bags, sum(v.factory_bag_kg) as bag_kg
  from v_lot_lines v group by v.lot_id
), nt as (
  select lot_id,
         sum(total) filter (where dn_type = 'weight_short') as dn_weight_short,
         sum(total) filter (where dn_type = 'rate_diff') as dn_quality,
         sum(total) filter (where dn_type = 'return') as dn_return,
         sum(total) filter (where dn_type = 'price_diff') as dn_price,
         sum(total) as dn_total
  from notes where status <> 'cancelled' group by lot_id
), todo as (
  select lot_id, sum(total_exact) as dn_to_approve from v_dn_calc where not approved group by lot_id
), tx as (
  select invoice_id, sum(amount) filter (where kind = 'it') as tds_it, sum(amount) filter (where kind = 'gst') as tds_gst
  from tds group by invoice_id
), pay as (
  select invoice_id, sum(amount) filter (where status = 'reconciled') as paid, sum(amount) filter (where status = 'entered') as paid_unreconciled
  from payments group by invoice_id
)
select l.id as lot_id, l.lot_no, l.received_on, s.id as supplier_id, s.name as supplier, s.supplier_type,
       d.deal_no, d.po_no, i.invoice_no, i.invoice_date, v.stage,
       ln.grades, ln.billed_kg, ln.factory_kg, ln.weight_short_kg, ln.invoice_rates, ln.our_rates,
       case when m.ok then round(i.taxable_value / nullif(ln.billed_kg, 0), 2) end as avg_rate,
       case when m.ok then i.taxable_value end as taxable,
       case when m.ok then i.gst_amount end as gst,
       case when m.ok then i.total end as invoice_total,
       case when m.ok then coalesce(nt.dn_weight_short, 0) end as dn_weight_short,
       case when m.ok then coalesce(nt.dn_quality, 0) end as dn_quality,
       case when m.ok then coalesce(nt.dn_return, 0) end as dn_return,
       case when m.ok then coalesce(nt.dn_price, 0) end as dn_price,
       case when m.ok then coalesce(nt.dn_total, 0) end as dn_total,
       case when m.ok then coalesce(todo.dn_to_approve, 0) end as dn_to_approve,
       case when m.ok then coalesce(tx.tds_it, 0) end as tds_it,
       case when m.ok then coalesce(tx.tds_gst, 0) end as tds_gst,
       case when m.ok then coalesce(pay.paid, 0) end as paid,
       case when m.ok then coalesce(pay.paid_unreconciled, 0) end as paid_unreconciled,
       case when m.ok then i.total - coalesce(nt.dn_total, 0) - coalesce(tx.tds_it, 0) - coalesce(tx.tds_gst, 0) - coalesce(pay.paid, 0) end as balance,
       ln.bags, ln.bag_kg,
       case when public.can('money_view') then (select coalesce(t.bill_amount, t.booked_price) from transport_bookings t where t.lot_id = l.id) end as freight
from lots l
join deals d on d.id = l.deal_id join suppliers s on s.id = d.supplier_id
left join invoices i on i.id = l.invoice_id
left join v_lots v on v.lot_id = l.id
left join ln on ln.lot_id = l.id
left join nt on nt.lot_id = l.id
left join todo on todo.lot_id = l.id
left join tx on tx.invoice_id = l.invoice_id
left join pay on pay.invoice_id = l.invoice_id
cross join lateral (select public.can('money_view') and i.doc_kind = 'tax_invoice' as ok) m
where not d.cancelled;

-- ================= to-do lists: + machine payments due, transport bill differences =================
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
  union all
  -- machine payments due within a week (or overdue)
  select 'machine_due', 'machine_edit', 'machine', c.order_id, c.order_no, c.vendor, c.label, null, c.due_on, c.outstanding
  from v_machine_cash c where c.outstanding > 0.005 and c.due_on <= current_date + 7
  union all
  -- the transporter billed a different amount than was booked
  select 'transport_bill_diff', 'transport_edit', 'transport', t.id, t.booking_no, coalesce(t.supplier, t.transporter), t.transporter, null, t.bill_date, t.bill_diff
  from v_transport t where t.bill_differs and t.status <> 'cancelled'
) t
where public.can(t.action);

revoke execute on function attach_transport(uuid, uuid), detach_transport(uuid) from public, anon;
grant execute on function attach_transport(uuid, uuid), detach_transport(uuid) to authenticated;
revoke execute on function guard_transport() from public, anon, authenticated;
