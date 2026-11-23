-- Depesh, 23 Nov:
--  1. Payment hold: pay up to (100 - hold)% of a lot (or of a supplier overall), hold the rest for Y days.
--     Alert when the limit is reached; alert again when the held balance is due.
--  2. TDS: income-tax TDS and GST TDS kept apart.
--  3. Supplier onboarding: a checklist (steps to be defined by Depesh; empty for now), onboarded or not,
--     and recurring reminders that alert Himanshu.
--  4. One table of every lot: supplier, weights, rates, each debit note, GST, TDS, paid, pending.
--  5. A PO is issued after the deal is booked (not typed at booking), numbered, printable as PDF.
--  6. Production can be started and closed later; stock position: in the factory, in production, booked.

-- ================= 1. payment hold =================
alter table suppliers add column hold_pct numeric(5,2) check (hold_pct between 0 and 100),
                      add column hold_days int check (hold_days >= 0),
                      add column hold_scope text not null default 'lot' check (hold_scope in ('lot','supplier'));
alter table deals add column hold_pct numeric(5,2) check (hold_pct between 0 and 100),
                  add column hold_days int check (hold_days >= 0);
alter table lots add column hold_pct numeric(5,2) check (hold_pct between 0 and 100),
                 add column hold_days int check (hold_days >= 0);

create table payment_hold_acks (
  scope text not null check (scope in ('lot','supplier')),
  ref_id uuid not null,
  reached_on date not null,
  acked_by uuid references profiles(id) default auth.uid(),
  acked_at timestamptz not null default now(),
  primary key (scope, ref_id, reached_on)
);
alter table payment_hold_acks enable row level security;
create policy staff_read on payment_hold_acks for select to authenticated using (public.is_staff());
revoke all on payment_hold_acks from anon;
grant select on payment_hold_acks to authenticated;

-- per lot (supplier scope 'lot') or per supplier overall (scope 'supplier'). Paid counts every payment not rejected:
-- the money has gone once it is entered, reconciled or not.
create view v_payment_holds with (security_invoker = true) as
with lot_rows as (
  select 'lot'::text as scope, l.id as ref_id, l.lot_no as ref_no, s.id as supplier_id, s.name as supplier,
         coalesce(l.hold_pct, d.hold_pct, s.hold_pct) as hold_pct, coalesce(l.hold_days, d.hold_days, s.hold_days) as hold_days,
         p.total - p.notes - p.tds as net, p.invoice_id
  from v_payable p join lots l on l.id = p.lot_id join deals d on d.id = l.deal_id join suppliers s on s.id = d.supplier_id
  where s.hold_scope = 'lot' and not d.cancelled
), lot_pays as (
  select r.scope, r.ref_id, r.ref_no, r.supplier_id, r.supplier, r.hold_pct, r.hold_days, r.net,
         round(r.net * (100 - r.hold_pct) / 100, 2) as pay_limit,
         coalesce((select sum(x.amount) from payments x where x.invoice_id = r.invoice_id and x.status <> 'rejected'), 0) as paid,
         (select min(c.paid_on) from (select x.paid_on, sum(x.amount) over (order by x.paid_on, x.entered_at, x.id) as cum
                                      from payments x where x.invoice_id = r.invoice_id and x.status <> 'rejected') c
          where c.cum >= round(r.net * (100 - r.hold_pct) / 100, 2) - 0.005) as reached_on
  from lot_rows r where r.hold_pct is not null
), sup_rows as (
  select 'supplier'::text as scope, s.id as ref_id, null::text as ref_no, s.id as supplier_id, s.name as supplier,
         s.hold_pct, s.hold_days, sum(p.total - p.notes - p.tds) as net
  from suppliers s join v_payable p on p.supplier_id = s.id
  where s.hold_scope = 'supplier' and s.hold_pct is not null
  group by s.id
), sup_pays as (
  select r.*, round(r.net * (100 - r.hold_pct) / 100, 2) as pay_limit,
         coalesce((select sum(x.amount) from payments x where x.supplier_id = r.supplier_id and x.status <> 'rejected'), 0) as paid,
         (select min(c.paid_on) from (select x.paid_on, sum(x.amount) over (order by x.paid_on, x.entered_at, x.id) as cum
                                      from payments x where x.supplier_id = r.supplier_id and x.status <> 'rejected') c
          where c.cum >= round(r.net * (100 - r.hold_pct) / 100, 2) - 0.005) as reached_on
  from sup_rows r
), allp as (select * from lot_pays union all select * from sup_pays)
select scope, ref_id, ref_no, supplier_id, supplier, hold_pct, hold_days, net, pay_limit, paid,
       greatest(net - paid, 0) as held, greatest(pay_limit - paid, 0) as can_pay_now,
       paid > pay_limit + 0.005 and reached_on + coalesce(hold_days, 0) > current_date as over_limit,
       reached_on, reached_on + coalesce(hold_days, 0) as release_on,
       case when net - paid <= 0.005 then 'cleared'
            when reached_on is null then 'paying'
            when current_date >= reached_on + coalesce(hold_days, 0) then 'release_due'
            else 'holding' end as status
from allp
where public.can('money_view');
revoke all on v_payment_holds from anon;
grant select on v_payment_holds to authenticated;

create function ack_payment_hold(p_scope text, p_ref uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v date;
begin
  perform require('payment_enter');
  select reached_on into v from v_payment_holds where scope = p_scope and ref_id = p_ref;
  if v is null then raise exception 'This payment limit has not been reached.'; end if;
  insert into payment_hold_acks (scope, ref_id, reached_on) values (p_scope, p_ref, v) on conflict do nothing;
end $$;

-- ================= 2. TDS: income tax or GST =================
alter table tds add column kind text not null default 'it' check (kind in ('it','gst'));

-- ================= 3. supplier onboarding and reminders =================
create table onboarding_steps (                 -- the checklist; Depesh will define it (empty until then)
  code text primary key,
  name text not null,
  name_hi text,
  sort int not null default 0,
  required boolean not null default true,
  active boolean not null default true
);
create table supplier_onboarding (
  supplier_id uuid not null references suppliers(id) on delete cascade,
  step text not null references onboarding_steps(code),
  done_at timestamptz not null default now(),
  done_by uuid references profiles(id) default auth.uid(),
  note text,
  primary key (supplier_id, step)
);
alter table suppliers add column onboarded_at timestamptz, add column onboarded_by uuid references profiles(id);

create table reminders (                          -- recurring: every N days / weeks / months / years
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  note text,
  every_n int not null default 1 check (every_n > 0),
  every_unit text not null default 'month' check (every_unit in ('day','week','month','year')),
  next_due date not null,
  for_role text not null default 'owner',
  active boolean not null default true,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create table reminder_log (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references reminders(id) on delete cascade,
  due_date date not null,
  done_by uuid references profiles(id) default auth.uid(),
  done_at timestamptz not null default now(),
  note text
);

do $$ declare t text; begin
  foreach t in array array['onboarding_steps','supplier_onboarding','reminders','reminder_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy staff_read on public.%I for select to authenticated using (public.is_staff())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;
grant insert, update, delete on onboarding_steps, reminders to authenticated;
create policy can_insert on onboarding_steps for insert to authenticated with check (public.can('admin'));
create policy can_update on onboarding_steps for update to authenticated using (public.can('admin')) with check (public.can('admin'));
create policy can_delete on onboarding_steps for delete to authenticated using (public.can('admin'));
create policy can_insert on reminders for insert to authenticated with check (public.can('supplier_onboard'));
create policy can_update on reminders for update to authenticated using (public.can('supplier_onboard')) with check (public.can('supplier_onboard'));
create policy can_delete on reminders for delete to authenticated using (public.can('supplier_onboard'));

insert into permissions (action, role) values
  ('supplier_onboard', 'owner'), ('supplier_onboard', 'vbog_admin'), ('supplier_onboard', 'factory_accounts'), ('supplier_onboard', 'ho_accounts'),
  ('reminder', 'owner'), ('reminder', 'deal_desk'), ('reminder', 'gate'), ('reminder', 'factory'),
  ('reminder', 'factory_accounts'), ('reminder', 'ho_accounts'), ('reminder', 'vbog_admin')
on conflict do nothing;

create function set_onboarding_step(p_supplier uuid, p_step text, p_done boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require('supplier_onboard');
  if p_done then
    insert into supplier_onboarding (supplier_id, step, note) values (p_supplier, p_step, nullif(trim(p_note), ''))
    on conflict (supplier_id, step) do update set done_at = now(), done_by = auth.uid(), note = excluded.note;
  else
    delete from supplier_onboarding where supplier_id = p_supplier and step = p_step;
  end if;
end $$;

create function set_supplier_onboarded(p_supplier uuid, p_onboarded boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_missing text;
begin
  perform require('supplier_onboard');
  if p_onboarded then
    select string_agg(s.name, ', ' order by s.sort) into v_missing from onboarding_steps s
    where s.active and s.required
      and not exists (select 1 from supplier_onboarding o where o.supplier_id = p_supplier and o.step = s.code);
    if v_missing is not null then raise exception 'Steps still to do: %.', v_missing; end if;
    update suppliers set onboarded_at = now(), onboarded_by = auth.uid() where id = p_supplier;
  else
    update suppliers set onboarded_at = null, onboarded_by = null where id = p_supplier;
  end if;
  insert into audit_log (actor, table_name, row_id, action) values (auth.uid(), 'suppliers', p_supplier,
    case when p_onboarded then 'onboarded' else 'onboarding_reopened' end);
end $$;

create function next_due(p_from date, p_n int, p_unit text) returns date
language sql immutable as $$
  select (p_from + case p_unit when 'day' then make_interval(days => p_n) when 'week' then make_interval(weeks => p_n)
                               when 'month' then make_interval(months => p_n) else make_interval(years => p_n) end)::date
$$;

-- done: logged, and the next date moves on by the interval (past today, if it was missed for a while)
create function complete_reminder(p_id uuid, p_note text default null) returns date
language plpgsql security definer set search_path = public as $$
declare r reminders; v date;
begin
  select * into r from reminders where id = p_id and active;
  if not found then raise exception 'Reminder not found.'; end if;
  if not (public.my_role() = r.for_role or public.can('supplier_onboard')) then
    raise exception 'This reminder is for someone else.' using errcode = 'insufficient_privilege';
  end if;
  insert into reminder_log (reminder_id, due_date, note) values (p_id, r.next_due, nullif(trim(p_note), ''));
  v := next_due(r.next_due, r.every_n, r.every_unit);
  while v <= current_date loop v := next_due(v, r.every_n, r.every_unit); end loop;
  update reminders set next_due = v where id = p_id;
  return v;
end $$;

-- ================= 5. PO after booking =================
alter table deals add column po_issued_at timestamptz, add column po_issued_by uuid references profiles(id),
                  add column po_revision int not null default 0;
update deals set po_issued_at = created_at, po_revision = 1 where po_no is not null;
-- a deal saved with a PO number (data loads, old screens) counts as issued
create function po_on_insert() returns trigger language plpgsql as $$
begin
  if new.po_no is not null and new.po_issued_at is null then new.po_issued_at := now(); new.po_revision := 1; end if;
  return new;
end $$;
create trigger po_on_insert before insert on deals for each row execute function po_on_insert();

-- next number in the PO/RA/082/26-27 series, financial year April-March
create function suggest_po_no() returns text
language sql stable security definer set search_path = public as $$
  select 'PO/RA/' || lpad((coalesce(max((regexp_match(po_no, '^PO/RA/([0-9]+)/'))[1]::int), 0) + 1)::text, 3, '0') || '/' ||
         to_char(case when extract(month from current_date) >= 4 then current_date else current_date - interval '1 year' end, 'YY') || '-' ||
         to_char(case when extract(month from current_date) >= 4 then current_date + interval '1 year' else current_date end, 'YY')
  from deals
$$;

create function issue_po(p_deal uuid, p_po_no text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  perform require('deal_edit');
  if not exists (select 1 from deals where id = p_deal and not cancelled) then raise exception 'Deal not found or cancelled.'; end if;
  v := coalesce(nullif(trim(p_po_no), ''), (select po_no from deals where id = p_deal), suggest_po_no());
  if exists (select 1 from deals where po_no = v and id <> p_deal) then raise exception 'PO number % is already used.', v; end if;
  update deals set po_no = v, po_date = current_date, po_issued_at = now(), po_issued_by = auth.uid(), po_revision = po_revision + 1
  where id = p_deal;
  insert into audit_log (actor, table_name, row_id, action, detail) values (auth.uid(), 'deals', p_deal, 'po_issued', jsonb_build_object('po_no', v));
  return v;
end $$;

-- ================= 6. production: started, then closed when the output is weighed =================
alter table production_runs add column status text not null default 'closed' check (status in ('open','closed')),
                            add column closed_on date;
update production_runs set closed_on = run_date;

create or replace function save_production(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_run uuid; v_line jsonb; v_made boolean;
begin
  perform require('production_edit');
  if jsonb_array_length(coalesce(p->'lines', '[]')) = 0 then raise exception 'Add what was used and what was made.'; end if;
  v_made := exists (select 1 from jsonb_array_elements(p->'lines') x where x->>'direction' = 'produced');
  insert into production_runs (run_date, plant_id, notes, status, closed_on)
  values (coalesce(nullif(p->>'run_date', '')::date, current_date),
          (select coalesce(plant_id, (select id from plants order by name limit 1)) from profiles where id = auth.uid()),
          nullif(trim(p->>'notes'), ''),
          case when v_made then 'closed' else 'open' end,
          case when v_made then coalesce(nullif(p->>'run_date', '')::date, current_date) end)
  returning id into v_run;
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    insert into production_lines (run_id, item, direction, kg)
    values (v_run, v_line->>'item', v_line->>'direction', (v_line->>'kg')::numeric);
  end loop;
  return v_run;
end $$;

-- production done: what came out is weighed and entered; the run closes
create function close_production(p_run uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_line jsonb;
begin
  perform require('production_edit');
  if not exists (select 1 from production_runs where id = p_run and status = 'open') then raise exception 'This production is already closed.'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]')) = 0 then raise exception 'Enter what was made.'; end if;
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    insert into production_lines (run_id, item, direction, kg) values (p_run, v_line->>'item', 'produced', (v_line->>'kg')::numeric);
  end loop;
  update production_runs set status = 'closed', closed_on = coalesce(nullif(p->>'closed_on', '')::date, current_date),
         notes = coalesce(nullif(trim(p->>'notes'), ''), notes)
  where id = p_run;
end $$;

-- what made it out of production lands in stock on the day it closed
create or replace view v_stock_moves with (security_invoker = true) as
with raw as (
  select g.stock_item as item, l.received_on as move_date,
         (case s.supplier_type when 'branch' then 'branch_in' when 'job_work' then 'job_work_in' else 'inward' end)::text as kind,
         coalesce(il.billed_net_kg, ll.factory_net_kg) as kg, l.lot_no as ref
  from lot_lines ll join lots l on l.id = ll.lot_id join grades g on g.code = ll.grade
  join deals d on d.id = l.deal_id join suppliers s on s.id = d.supplier_id
  left join invoice_lines il on il.invoice_id = l.invoice_id and il.grade = ll.grade
  where not d.cancelled
  union all
  select g.stock_item, n.note_date, 'note', -nl.stock_kg, coalesce(n.tally_no, l.lot_no || ' ' || n.dn_type)
  from note_lines nl join notes n on n.id = nl.note_id join lots l on l.id = n.lot_id join grades g on g.code = nl.grade
  where n.status <> 'cancelled' and nl.stock_kg <> 0
  union all
  select pl.item, case when pl.direction = 'produced' then coalesce(r.closed_on, r.run_date) else r.run_date end,
         pl.direction, case when pl.direction = 'consumed' then -pl.kg else pl.kg end,
         'Production ' || to_char(r.run_date, 'DD Mon')
  from production_lines pl join production_runs r on r.id = pl.run_id
  union all
  select item, move_date, kind, kg, coalesce(nullif(concat_ws(' · ', party, doc_no, reason), ''), kind) from stock_moves
), starts as (
  select item, max(move_date) as start_date from stock_moves where kind = 'opening' group by item
)
select r.item, r.move_date, r.kind, r.kg, r.ref
from raw r left join starts s on s.item = r.item
where s.start_date is null
   or (r.move_date >= s.start_date and (r.kind <> 'opening' or r.move_date = s.start_date));

-- where the metal is today: in the factory (stock), in the furnace (production not closed), booked (still to come)
create view v_stock_position with (security_invoker = true) as
with fac as (select item, sum(kg) as kg from v_stock_moves where move_date <= current_date group by item),
wip as (select pl.item, sum(pl.kg) as kg, count(distinct r.id) as runs
        from production_lines pl join production_runs r on r.id = pl.run_id
        where r.status = 'open' and pl.direction = 'consumed' group by pl.item),
booked as (
  select g.stock_item as item, sum(greatest(dl.qty_kg - coalesce(r.kg, 0), 0)) as kg, count(distinct d.id) as deals
  from deals d join deal_lines dl on dl.deal_id = d.id join grades g on g.code = dl.grade
  left join (select l.deal_id, il.grade, sum(il.billed_net_kg) as kg
             from lots l join invoice_lines il on il.invoice_id = l.invoice_id group by 1, 2) r
         on r.deal_id = d.id and r.grade = dl.grade
  where not d.cancelled and not d.receiving_complete
  group by g.stock_item having sum(greatest(dl.qty_kg - coalesce(r.kg, 0), 0)) > 0)
select i.code as item, i.name, i.name_hi, i.kind, i.sort,
       coalesce(fac.kg, 0) as in_factory, coalesce(wip.kg, 0) as in_production, coalesce(wip.runs, 0) as open_runs,
       coalesce(booked.kg, 0) as booked, coalesce(booked.deals, 0) as booked_deals
from items i
left join fac on fac.item = i.code left join wip on wip.item = i.code left join booked on booked.item = i.code
where coalesce(fac.kg, 0) <> 0 or coalesce(wip.kg, 0) <> 0 or coalesce(booked.kg, 0) <> 0;
revoke all on v_stock_position from anon;
grant select on v_stock_position to authenticated;

-- ================= 4. every lot in one table =================
create view v_lot_register with (security_invoker = true) as
with ln as (
  select v.lot_id, string_agg(v.grade_name, ', ' order by v.grade) as grades,
         sum(v.billed_net_kg) as billed_kg, sum(v.factory_net_kg) as factory_kg, sum(v.weight_short_kg) as weight_short_kg,
         string_agg(v.grade_name || ' ' || to_char(v.billed_rate, 'FM999G999D00'), ' · ' order by v.grade) as invoice_rates,
         string_agg(v.grade_name || ' ' || to_char(v.deal_rate, 'FM999G999D00'), ' · ' order by v.grade) as our_rates
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
       case when m.ok then i.total - coalesce(nt.dn_total, 0) - coalesce(tx.tds_it, 0) - coalesce(tx.tds_gst, 0) - coalesce(pay.paid, 0) end as balance
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
revoke all on v_lot_register from anon;
grant select on v_lot_register to authenticated;

-- ================= to-do lists =================
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
  -- booked, PO not issued yet
  select 'po_missing', 'deal_edit', 'deal', d.id, d.deal_no, s.name, null, null, d.deal_date, null
  from deals d join suppliers s on s.id = d.supplier_id
  where d.po_issued_at is null and not d.cancelled and not d.unbooked and s.supplier_type = 'domestic'
  union all
  -- payment limit reached: stop paying, hold the rest (until acknowledged)
  select 'hold_reached', 'payment_enter', h.scope, h.ref_id, h.ref_no, h.supplier, to_char(h.release_on, 'YYYY-MM-DD'), null, h.reached_on, h.held
  from v_payment_holds h
  where h.status = 'holding'
    and not exists (select 1 from payment_hold_acks a where a.scope = h.scope and a.ref_id = h.ref_id and a.reached_on = h.reached_on)
  union all
  -- the held balance is due now
  select 'hold_release', 'payment_enter', h.scope, h.ref_id, h.ref_no, h.supplier, null, null, h.release_on, h.held
  from v_payment_holds h where h.status = 'release_due'
  union all
  -- supplier with a deal, not onboarded yet
  select 'supplier_onboard', 'supplier_onboard', 'supplier', s.id, null, s.name, null, null, s.created_at::date, null
  from suppliers s
  where s.onboarded_at is null and s.active and s.supplier_type = 'domestic'
    and exists (select 1 from deals d where d.supplier_id = s.id and not d.cancelled)
  union all
  -- recurring reminders that are due, for the role they are meant for
  select 'reminder_due', 'reminder', 'reminder', r.id, r.title, s.name, r.note, null, r.next_due, null
  from reminders r left join suppliers s on s.id = r.supplier_id
  where r.active and r.next_due <= current_date
    and (r.for_role = public.my_role() or (public.my_role() = 'vbog_admin' and r.for_role = 'owner'))
) t
where public.can(t.action);

revoke execute on function ack_payment_hold(text, uuid), set_onboarding_step(uuid, text, boolean, text), set_supplier_onboarded(uuid, boolean),
  complete_reminder(uuid, text), suggest_po_no(), issue_po(uuid, text), close_production(uuid, jsonb) from public, anon;
grant execute on function ack_payment_hold(text, uuid), set_onboarding_step(uuid, text, boolean, text), set_supplier_onboarded(uuid, boolean),
  complete_reminder(uuid, text), suggest_po_no(), issue_po(uuid, text), close_production(uuid, jsonb) to authenticated;
