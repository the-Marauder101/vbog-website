-- Rates: adjustable on the deal with full history, and every invoice rate difference decided.
-- * A deal's rate per grade can be changed at any time (deal_edit). Every change is kept: old, new, who, when, why.
--   Trucks (lots) whose debit notes are already approved keep the rate they were settled at (pinned on the lot line);
--   the new rate applies to every other truck of the deal.
-- * Any invoice rate that differs from the agreed rate is flagged. Someone with price_decide (owner, vbog_admin,
--   factory_accounts: Himanshu or Tinu) chooses, per truck:
--     accept the invoice rate -> the deal rate becomes the invoice rate (Himanshu adjusted it on the phone)
--     keep the agreed rate    -> over-billed: a 'price_diff' debit note for the excess; under-billed: nothing owed now
--   Until then the lot stays at "DN to approve" and is on the decider's Home list.
-- * The arrival form no longer pre-fills the invoice rate (a pre-filled agreed rate would hide a real difference).

alter table lot_lines add column agreed_rate numeric(12,3);   -- pinned when the deal rate changes after this truck settled

create table deal_rate_history (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  grade text not null,
  old_rate numeric(12,3),
  new_rate numeric(12,3) not null,
  source text not null check (source in ('booked','changed','accepted_invoice','confirmed_unbooked')),
  lot_id uuid references lots(id),
  note text,
  changed_by uuid references profiles(id) default auth.uid(),
  changed_at timestamptz not null default clock_timestamp()
);

create table price_decisions (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references lots(id) on delete cascade,
  grade text not null,
  invoice_rate numeric(12,3) not null,
  agreed_rate numeric(12,3) not null,
  decision text not null check (decision in ('accepted_invoice','kept_agreed')),
  decided_by uuid references profiles(id) default auth.uid(),
  decided_at timestamptz not null default clock_timestamp()
);

alter table deal_rate_history enable row level security;
alter table price_decisions enable row level security;
create policy staff_read on deal_rate_history for select to authenticated using (public.is_staff());
create policy staff_read on price_decisions for select to authenticated using (public.is_staff());
revoke all on deal_rate_history, price_decisions from anon;
grant select on deal_rate_history, price_decisions to authenticated;

insert into permissions (action, role) values ('price_decide', 'owner'), ('price_decide', 'vbog_admin'), ('price_decide', 'factory_accounts')
on conflict do nothing;

alter table notes drop constraint notes_dn_type_check;
alter table notes add constraint notes_dn_type_check check (dn_type in ('weight_short','rate_diff','return','price_diff'));

-- every rate a deal line has had
create function log_rate_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.rate_per_kg is distinct from old.rate_per_kg then
    insert into deal_rate_history (deal_id, grade, old_rate, new_rate, source, lot_id, note)
    values (new.deal_id, new.grade, case when tg_op = 'UPDATE' then old.rate_per_kg end, new.rate_per_kg,
            case when tg_op = 'INSERT' then 'booked' else coalesce(nullif(current_setting('ra.rate_source', true), ''), 'changed') end,
            nullif(current_setting('ra.rate_lot', true), '')::uuid, nullif(current_setting('ra.rate_note', true), ''));
  end if;
  return new;
end $$;
create trigger rate_history after insert or update of rate_per_kg on deal_lines for each row execute function log_rate_change();
insert into deal_rate_history (deal_id, grade, old_rate, new_rate, source, changed_by, changed_at)
select dl.deal_id, dl.grade, null, dl.rate_per_kg, 'booked', d.created_by, d.created_at
from deal_lines dl join deals d on d.id = dl.deal_id;

-- the one place a deal rate changes. Trucks with approved debit notes keep the rate they were settled at.
create function apply_deal_rate(p_deal uuid, p_grade text, p_rate numeric, p_source text, p_lot uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old numeric;
begin
  if p_rate is null or p_rate <= 0 then raise exception 'Enter the rate for %.', p_grade; end if;
  select rate_per_kg into v_old from deal_lines where deal_id = p_deal and grade = p_grade;
  if not found then raise exception 'Grade % is not on this deal.', p_grade; end if;
  if v_old = p_rate then return; end if;
  perform set_config('ra.via_fn', 'on', true);
  update lot_lines ll set agreed_rate = v_old
  from lots l where l.id = ll.lot_id and l.deal_id = p_deal and ll.grade = p_grade and ll.agreed_rate is null
    and exists (select 1 from notes n where n.lot_id = l.id and n.status <> 'cancelled');
  perform set_config('ra.rate_source', p_source, true);
  perform set_config('ra.rate_lot', coalesce(p_lot::text, ''), true);
  perform set_config('ra.rate_note', coalesce(p_note, ''), true);
  update deal_lines set rate_per_kg = p_rate where deal_id = p_deal and grade = p_grade;
  perform set_config('ra.rate_source', '', true); perform set_config('ra.rate_lot', '', true); perform set_config('ra.rate_note', '', true);
  perform set_config('ra.via_fn', 'off', true);
end $$;

create function set_deal_rate(p_deal uuid, p_grade text, p_rate numeric, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require('deal_edit');
  perform apply_deal_rate(p_deal, p_grade, p_rate, 'changed', null, nullif(trim(p_note), ''));
end $$;

-- invoice vs agreed rate, per truck and grade (domestic purchases only), with the latest decision for these two rates
create view v_price_diffs with (security_invoker = true) as
select v.lot_id, v.lot_no, v.deal_id, v.deal_no, s.name as supplier, v.grade, v.grade_name, v.grade_name_hi,
       i.invoice_no, i.invoice_date, i.gst_rate, v.billed_net_kg,
       v.billed_rate as invoice_rate, v.deal_rate as agreed_rate, v.billed_rate - v.deal_rate as diff_per_kg,
       round(v.billed_net_kg * (v.billed_rate - v.deal_rate), 2) as amount,
       round(v.billed_net_kg * (v.billed_rate - v.deal_rate) * (1 + i.gst_rate / 100), 2) as total,
       case when v.billed_rate > v.deal_rate then 'over' else 'under' end as direction,
       coalesce((select pd.decision from price_decisions pd
                 where pd.lot_id = v.lot_id and pd.grade = v.grade
                   and pd.invoice_rate = v.billed_rate and pd.agreed_rate = v.deal_rate
                 order by pd.decided_at desc limit 1), 'open') as status
from v_lot_lines v
join lots l on l.id = v.lot_id
join invoices i on i.id = l.invoice_id
join deals d on d.id = l.deal_id
join suppliers s on s.id = d.supplier_id
where i.doc_kind = 'tax_invoice' and not d.cancelled
  and v.billed_rate is not null and v.deal_rate is not null and v.billed_rate <> v.deal_rate;
revoke all on v_price_diffs from anon;
grant select on v_price_diffs to authenticated;

-- one tap per truck: 'accept_invoice' or 'keep_agreed', for every open difference on the lot
create function decide_price(p_lot uuid, p_choice text) returns void
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
      perform apply_deal_rate(r.deal_id, r.grade, r.invoice_rate, 'accepted_invoice', p_lot, r.invoice_no);
      perform set_config('ra.via_fn', 'on', true);
      update lot_lines set agreed_rate = case when lot_has_notes(p_lot) then r.invoice_rate end
      where lot_id = p_lot and grade = r.grade;
      perform set_config('ra.via_fn', 'off', true);
    end if;
  end loop;
  if n = 0 then raise exception 'Nothing to decide on this lot.'; end if;
  insert into audit_log (actor, table_name, row_id, action, detail)
  values (auth.uid(), 'lots', p_lot, 'price_' || p_choice, jsonb_build_object('grades', n));
end $$;

-- unbooked trucks: confirming (or correcting) the rate goes through the same rate path, with history
create or replace function confirm_deal_rate(p_deal uuid, p_rates jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v numeric;
begin
  perform require('rate_confirm');
  if not exists (select 1 from deals where id = p_deal and unbooked and not cancelled) then
    raise exception 'Only a truck that arrived without a booking needs its rate confirmed.';
  end if;
  if p_rates is not null and jsonb_typeof(p_rates) = 'object' then
    for k, v in select key, value::numeric from jsonb_each_text(p_rates) loop
      perform apply_deal_rate(p_deal, k, v, 'confirmed_unbooked', null, null);
    end loop;
  end if;
  update deals set rate_confirmed_at = now(), rate_confirmed_by = auth.uid() where id = p_deal;
  insert into audit_log (actor, table_name, row_id, action, detail)
  values (auth.uid(), 'deals', p_deal, 'rate_confirmed', coalesce(p_rates, '{}'::jsonb));
end $$;

revoke execute on function apply_deal_rate(uuid, text, numeric, text, uuid, text) from public, anon, authenticated;
revoke execute on function set_deal_rate(uuid, text, numeric, text), decide_price(uuid, text) from public, anon;
grant execute on function set_deal_rate(uuid, text, numeric, text), decide_price(uuid, text) to authenticated;

-- lot lines: the agreed rate is the truck's pinned rate if it has one, else the deal's
create or replace view v_lot_lines with (security_invoker = true) as
select l.id as lot_id, l.lot_no, d.id as deal_id, d.deal_no, ll.id as lot_line_id, ll.grade,
       g.name as grade_name, g.name_hi as grade_name_hi, g.stock_item,
       coalesce(ll.agreed_rate, dl.rate_per_kg) as deal_rate, il.billed_rate, coalesce(ll.agreed_rate, dl.rate_per_kg, il.billed_rate) as dn_rate,
       il.slip_gross_kg, il.slip_bag_kg, (il.slip_gross_kg - il.slip_bag_kg) as slip_net_kg, il.billed_net_kg,
       ll.factory_gross_kg, ll.bag_count, ll.factory_bag_kg, ll.factory_net_kg,
       (il.billed_net_kg - ll.factory_net_kg) as weight_diff_kg,
       greatest(il.billed_net_kg - ll.factory_net_kg, 0) as weight_short_kg,
       greatest(ll.factory_net_kg - il.billed_net_kg, 0) as weight_excess_kg,
       (il.billed_net_kg - (il.slip_gross_kg - il.slip_bag_kg)) as slip_vs_invoice_kg,
       (il.billed_rate - coalesce(ll.agreed_rate, dl.rate_per_kg)) as rate_vs_deal,
       coalesce(s.sorted_kg, 0) as sorted_kg, coalesce(s.dn_kg, 0) as debit_kg
from lot_lines ll
join lots l on l.id = ll.lot_id
join deals d on d.id = l.deal_id
join grades g on g.code = ll.grade
left join invoice_lines il on il.invoice_id = l.invoice_id and il.grade = ll.grade
left join deal_lines dl on dl.deal_id = d.id and dl.grade = ll.grade
left join (select lot_line_id, sum(sorted_kg) as sorted_kg, sum(dn_kg) as dn_kg
           from sorting_lines group by lot_line_id) s on s.lot_line_id = ll.id;

-- debit note lines: as before, plus the excess when an over-billed rate is kept at the agreed rate
create or replace view v_dn_calc_lines with (security_invoker = true) as
select lot_id, 'weight_short'::text as dn_type, grade, 'WEIGHT_SHORT'::text as category,
       'Weight short'::text as description, weight_short_kg as qty_kg, dn_rate as rate,
       weight_short_kg * dn_rate as amount, weight_short_kg as stock_kg
from v_lot_lines where weight_short_kg > 0
union all
select v.lot_id, 'rate_diff', v.grade, c.code, c.name, sum(s.dn_kg), s.rate_cut, sum(s.dn_kg) * s.rate_cut, 0
from sorting_lines s join v_lot_lines v on v.lot_line_id = s.lot_line_id
join sort_categories c on c.code = s.category
where s.action = 'rate_diff'
group by v.lot_id, v.grade, c.code, c.name, s.rate_cut
having sum(s.dn_kg) > 0
union all
select v.lot_id, 'return', v.grade, c.code, c.name, sum(s.dn_kg), v.dn_rate, sum(s.dn_kg) * v.dn_rate, sum(s.dn_kg)
from sorting_lines s join v_lot_lines v on v.lot_line_id = s.lot_line_id
join sort_categories c on c.code = s.category
where s.action = 'return'
group by v.lot_id, v.grade, c.code, c.name, v.dn_rate
having sum(s.dn_kg) > 0
union all
-- invoice rate above the agreed rate, and the agreed rate was kept: debit the excess (no stock effect)
select p.lot_id, 'price_diff', p.grade, 'PRICE_DIFF', 'Invoice rate above agreed rate', p.billed_net_kg, p.diff_per_kg::numeric(12,3), p.amount, 0
from v_price_diffs p where p.status = 'kept_agreed' and p.direction = 'over';

-- approve: the price debit note does not wait for sorting
create or replace function approve_dn(p_lot uuid, p_type text, p_date date, p_round boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare c record; v_id uuid; v_total numeric;
begin
  perform require('dn_approve');
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

-- lots: an open rate difference keeps the lot at "DN to approve"
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
           or exists (select 1 from v_price_diffs pd where pd.lot_id = l.id and pd.status = 'open') then 'dn_pending'
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

-- to-do lists: plus rate differences to decide
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
  union all
  -- an invoice rate that differs from the agreed rate: accept the invoice rate or keep the agreed one
  select 'price_decide', 'price_decide', 'lot', p.lot_id, p.lot_no, p.supplier, null, null, min(p.invoice_date), sum(p.total)
  from v_price_diffs p where p.status = 'open' group by p.lot_id, p.lot_no, p.supplier
) t
where public.can(t.action);
