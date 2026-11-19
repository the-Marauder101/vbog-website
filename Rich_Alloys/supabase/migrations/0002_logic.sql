-- Rich Alloys purchase portal v2: permissions helpers, guards, calculations and actions.
-- All money and weight maths lives here. Screens only capture and display.

-- ================= who may do what =================
create function my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and active $$;

create function is_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and active) $$;

create function can(p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from permissions p join profiles u on u.role = p.role
                 where u.id = auth.uid() and u.active and p.action = p_action)
$$;

create function my_actions() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.action order by p.action), '{}')
  from permissions p join profiles u on u.role = p.role where u.id = auth.uid() and u.active
$$;

create function require(p_action text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not can(p_action) then
    raise exception 'You are not allowed to do this (%).', p_action using errcode = '42501';
  end if;
end $$;

-- inside our own functions, status changes are allowed past the guards below
create function via_fn() returns boolean language sql stable as
$$ select coalesce(current_setting('ra.via_fn', true), '') = 'on' $$;

-- ================= audit =================
create function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if tg_op = 'DELETE' then v := to_jsonb(old); else v := to_jsonb(new); end if;
  insert into audit_log (actor, table_name, row_id, action, detail)
  values (auth.uid(), tg_table_name,
          case when v ? 'id' and (v->>'id') ~ '^[0-9a-f-]{36}$' then (v->>'id')::uuid end,
          lower(tg_op), v);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['suppliers','deals','deal_lines','invoices','invoice_lines','lots','lot_lines',
    'sorting_lines','returns','payments','tds','production_runs','production_lines','stock_moves',
    'stock_tally_checks','items','grades','sort_categories','doc_types','profiles'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ================= guards =================
create function lot_has_notes(p_lot uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from notes where lot_id = p_lot and status <> 'cancelled') $$;

create function guard_sorting() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_line uuid; v_closed timestamptz;
begin
  v_line := case when tg_op = 'DELETE' then old.lot_line_id else new.lot_line_id end;
  select l.sorting_closed_at into v_closed from lot_lines ll join lots l on l.id = ll.lot_id where ll.id = v_line;
  if v_closed is not null and not via_fn() then
    raise exception 'Sorting for this lot is closed. Reopen it first.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger guard before insert or update or delete on sorting_lines for each row execute function guard_sorting();

create function guard_weights() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_lot uuid; v jsonb;
begin
  if tg_op = 'DELETE' then v := to_jsonb(old); else v := to_jsonb(new); end if;
  if tg_table_name = 'lot_lines' then v_lot := (v->>'lot_id')::uuid;
  elsif tg_table_name = 'invoice_lines' then select id into v_lot from lots where invoice_id = (v->>'invoice_id')::uuid;
  elsif tg_table_name = 'invoices' then select id into v_lot from lots where invoice_id = (v->>'id')::uuid;
  end if;
  if v_lot is not null and lot_has_notes(v_lot) and not via_fn() then
    raise exception 'Debit notes are approved for this lot. Cancel them before changing weights or the invoice.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger guard before update or delete on lot_lines for each row execute function guard_weights();
create trigger guard before update or delete on invoice_lines for each row execute function guard_weights();
create trigger guard before update or delete on invoices for each row execute function guard_weights();

create function guard_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'reconciled' then raise exception 'A reconciled payment cannot be deleted.'; end if;
    return old;
  end if;
  -- keep supplier, deal and invoice consistent
  if new.invoice_id is not null then select deal_id into new.deal_id from invoices where id = new.invoice_id; end if;
  if new.deal_id is not null then select supplier_id into new.supplier_id from deals where id = new.deal_id; end if;
  if via_fn() then return new; end if;
  if tg_op = 'INSERT' then
    new.status := 'entered'; new.reconciled_by := null; new.reconciled_at := null; new.reject_note := null;
    new.entered_by := coalesce(auth.uid(), new.entered_by); new.entered_at := now();
    return new;
  end if;
  if old.status = 'reconciled' then raise exception 'A reconciled payment cannot be changed.'; end if;
  -- any edit sends the payment back for reconciliation
  new.status := 'entered'; new.reject_note := null; new.reconciled_by := null; new.reconciled_at := null;
  new.entered_by := old.entered_by; new.entered_at := old.entered_at;
  return new;
end $$;
create trigger guard before insert or update or delete on payments for each row execute function guard_payment();

create function guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.id = auth.uid() and (new.role <> old.role or not new.active) then
    raise exception 'You cannot change your own role or switch yourself off.';
  end if;
  return new;
end $$;
create trigger guard before update on profiles for each row execute function guard_profile();

-- ================= calculations (views) =================

-- per lot and grade: supplier vs factory weights
create view v_lot_lines with (security_invoker = true) as
select l.id as lot_id, l.lot_no, d.id as deal_id, d.deal_no, ll.id as lot_line_id, ll.grade,
       g.name as grade_name, g.name_hi as grade_name_hi, g.stock_item,
       dl.rate_per_kg as deal_rate, il.billed_rate, coalesce(dl.rate_per_kg, il.billed_rate) as dn_rate,
       il.slip_gross_kg, il.slip_bag_kg, (il.slip_gross_kg - il.slip_bag_kg) as slip_net_kg, il.billed_net_kg,
       ll.factory_gross_kg, ll.bag_count, ll.factory_bag_kg, ll.factory_net_kg,
       (il.billed_net_kg - ll.factory_net_kg) as weight_diff_kg,
       greatest(il.billed_net_kg - ll.factory_net_kg, 0) as weight_short_kg,
       greatest(ll.factory_net_kg - il.billed_net_kg, 0) as weight_excess_kg,
       (il.billed_net_kg - (il.slip_gross_kg - il.slip_bag_kg)) as slip_vs_invoice_kg,
       (il.billed_rate - dl.rate_per_kg) as rate_vs_deal,
       coalesce(s.sorted_kg, 0) as sorted_kg, coalesce(s.dn_kg, 0) as debit_kg
from lot_lines ll
join lots l on l.id = ll.lot_id
join deals d on d.id = l.deal_id
join grades g on g.code = ll.grade
left join invoice_lines il on il.invoice_id = l.invoice_id and il.grade = ll.grade
left join deal_lines dl on dl.deal_id = d.id and dl.grade = ll.grade
left join (select lot_line_id, sum(sorted_kg) as sorted_kg, sum(dn_kg) as dn_kg
           from sorting_lines group by lot_line_id) s on s.lot_line_id = ll.id;

-- every DN line the lot should carry
create view v_dn_calc_lines with (security_invoker = true) as
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
having sum(s.dn_kg) > 0;

create view v_dn_calc with (security_invoker = true) as
select c.lot_id, c.dn_type, i.id as invoice_id, i.gst_rate,
       round(sum(c.amount), 2) as taxable,
       round(sum(c.amount) * i.gst_rate / 100, 3) as gst_amount,
       round(sum(c.amount) * (1 + i.gst_rate / 100), 2) as total_exact,
       round(sum(c.amount) * (1 + i.gst_rate / 100), 0) as total_rounded,
       exists (select 1 from notes n where n.lot_id = c.lot_id and n.dn_type = c.dn_type and n.status <> 'cancelled') as approved
from v_dn_calc_lines c
join lots l on l.id = c.lot_id
join invoices i on i.id = l.invoice_id
group by c.lot_id, c.dn_type, i.id, i.gst_rate;

-- sorted kg that was not debited in full, and what that cost
create view v_sorting_exceptions with (security_invoker = true) as
select v.lot_id, v.lot_no, v.grade, c.name as category, sum(s.sorted_kg) as sorted_kg, sum(s.dn_kg) as dn_kg,
       sum(s.sorted_kg - s.dn_kg) as kg_not_debited,
       round(sum((s.sorted_kg - s.dn_kg) * case when s.action = 'return' then v.dn_rate else s.rate_cut end)
             * (1 + d.gst_rate / 100), 2) as value_not_recovered,
       string_agg(distinct s.change_reason, '; ') as reasons
from sorting_lines s join v_lot_lines v on v.lot_line_id = s.lot_line_id
join sort_categories c on c.code = s.category
join deals d on d.id = v.deal_id
where s.dn_kg <> s.sorted_kg
group by v.lot_id, v.lot_no, v.grade, c.name, d.gst_rate;

-- bill by bill: what is owed. Only reconciled payments reduce the balance.
create view v_payable with (security_invoker = true) as
select i.id as invoice_id, i.invoice_no, i.invoice_date, d.id as deal_id, d.deal_no, l.id as lot_id, l.lot_no,
       s.id as supplier_id, s.name as supplier, i.taxable_value, i.gst_amount, i.total,
       coalesce(n.t, 0) as notes, coalesce(t.t, 0) as tds,
       coalesce(p.reconciled, 0) as paid, coalesce(p.pending, 0) as pending,
       i.total - coalesce(n.t, 0) - coalesce(t.t, 0) - coalesce(p.reconciled, 0) as balance
from invoices i
join deals d on d.id = i.deal_id
join suppliers s on s.id = d.supplier_id
left join lots l on l.invoice_id = i.id
left join (select invoice_id, sum(total) t from notes where status <> 'cancelled' group by 1) n on n.invoice_id = i.id
left join (select invoice_id, sum(amount) t from tds group by 1) t on t.invoice_id = i.id
left join (select invoice_id, sum(amount) filter (where status = 'reconciled') reconciled,
                  sum(amount) filter (where status = 'entered') pending
           from payments group by 1) p on p.invoice_id = i.id
where public.can('money_view');

-- what still has to be entered in which Tally
create view v_tally_missing with (security_invoker = true) as
select 'invoice'::text as entity, i.id as entity_id, b.book, l.id as lot_id, i.invoice_date as entry_date
from invoices i join lots l on l.invoice_id = i.id cross join (values ('factory'), ('office')) b(book)
where not exists (select 1 from tally_marks t where t.entity = 'invoice' and t.entity_id = i.id and t.book = b.book)
union all
select 'note', n.id, b.book, n.lot_id, n.note_date
from notes n cross join (values ('factory'), ('office')) b(book)
where n.status <> 'cancelled'
  and not exists (select 1 from tally_marks t where t.entity = 'note' and t.entity_id = n.id and t.book = b.book)
union all
select 'payment', p.id, 'office', l.id, p.paid_on
from payments p left join lots l on l.invoice_id = p.invoice_id
where p.status = 'reconciled'
  and not exists (select 1 from tally_marks t where t.entity = 'payment' and t.entity_id = p.id and t.book = 'office')
union all
select 'tds', x.id, 'office', l.id, x.deducted_on
from tds x left join lots l on l.invoice_id = x.invoice_id
where not exists (select 1 from tally_marks t where t.entity = 'tds' and t.entity_id = x.id and t.book = 'office')
union all
select 'production', r.id, 'factory', null::uuid, r.run_date
from production_runs r
where not exists (select 1 from tally_marks t where t.entity = 'production' and t.entity_id = r.id and t.book = 'factory');

-- the figure Tally holds for an entry; null when the entry no longer exists or was cancelled
create function entity_amount(p_entity text, p_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case p_entity
    when 'invoice' then (select total from invoices where id = p_id)
    when 'note' then (select total from notes where id = p_id and status <> 'cancelled')
    when 'payment' then (select amount from payments where id = p_id and status = 'reconciled')
    when 'tds' then (select amount from tds where id = p_id)
    when 'production' then (select sum(kg) from production_lines where run_id = p_id)
  end
$$;

-- ticked entries that changed (or were cancelled/deleted) after they were entered in Tally
create view v_tally_changes with (security_invoker = true) as
select m.id as mark_id, m.entity, m.entity_id, m.book, m.voucher_ref, m.amount_at_mark,
       entity_amount(m.entity, m.entity_id) as amount_now, m.marked_at
from tally_marks m
where entity_amount(m.entity, m.entity_id) is distinct from m.amount_at_mark;

-- one list per Tally of what to enter, with what is needed to find it
create view v_tally_queue with (security_invoker = true) as
with items as (
  select 'pending'::text as state, x.entity, x.entity_id, x.book, null::uuid as mark_id, null::text as voucher_ref,
         null::numeric as amount_at_mark from v_tally_missing x
  union all
  select 'changed', c.entity, c.entity_id, c.book, c.mark_id, c.voucher_ref, c.amount_at_mark from v_tally_changes c
)
select it.*, coalesce(i.invoice_date, n.note_date, p.paid_on, t.deducted_on, r.run_date) as entry_date,
       coalesce(l.id, nl.id, pl.id, tl.id) as lot_id, coalesce(l.lot_no, nl.lot_no, pl.lot_no, tl.lot_no) as lot_no,
       coalesce(s1.name, s2.name, s3.name, s4.name) as supplier, coalesce(s1.gstin, s2.gstin, s3.gstin, s4.gstin) as gstin,
       case it.entity when 'invoice' then i.invoice_no when 'note' then coalesce(n.tally_no, n.dn_type)
                      when 'payment' then coalesce(p.bank_ref, upper(p.mode)) when 'tds' then coalesce(t.section, 'TDS')
                      when 'production' then 'Production' end as ref,
       entity_amount(it.entity, it.entity_id) as amount, n.dn_type
from items it
left join invoices i on it.entity = 'invoice' and i.id = it.entity_id
left join lots l on l.invoice_id = i.id
left join deals d1 on d1.id = i.deal_id left join suppliers s1 on s1.id = d1.supplier_id
left join notes n on it.entity = 'note' and n.id = it.entity_id
left join lots nl on nl.id = n.lot_id left join deals d2 on d2.id = nl.deal_id left join suppliers s2 on s2.id = d2.supplier_id
left join payments p on it.entity = 'payment' and p.id = it.entity_id
left join lots pl on pl.invoice_id = p.invoice_id left join suppliers s3 on s3.id = p.supplier_id
left join tds t on it.entity = 'tds' and t.id = it.entity_id
left join invoices ti on ti.id = t.invoice_id left join lots tl on tl.invoice_id = ti.id
left join deals d4 on d4.id = ti.deal_id left join suppliers s4 on s4.id = d4.supplier_id
left join production_runs r on it.entity = 'production' and r.id = it.entity_id
where public.can(case when it.book = 'factory' then 'tally_factory' else 'tally_office' end) or public.can('admin');

-- every purchase invoice in one place (replaces the shared invoice-tracker Excel)
create view v_invoice_register with (security_invoker = true) as
select i.id as invoice_id, i.invoice_no, i.invoice_date, s.name as supplier, s.gstin, d.deal_no, l.id as lot_id, l.lot_no,
       l.received_on, i.taxable_value, i.gst_amount, i.total,
       exists (select 1 from documents x where x.doc_type = 'TAX_INVOICE' and x.status <> 'rejected'
               and (x.lot_id = l.id or (x.lot_id is null and x.deal_id = d.id))) as has_scan,
       (select voucher_ref from tally_marks m where m.entity = 'invoice' and m.entity_id = i.id and m.book = 'factory') as factory_ref,
       exists (select 1 from tally_marks m where m.entity = 'invoice' and m.entity_id = i.id and m.book = 'factory') as in_factory,
       (select voucher_ref from tally_marks m where m.entity = 'invoice' and m.entity_id = i.id and m.book = 'office') as office_ref,
       exists (select 1 from tally_marks m where m.entity = 'invoice' and m.entity_id = i.id and m.book = 'office') as in_office
from invoices i join deals d on d.id = i.deal_id join suppliers s on s.id = d.supplier_id
left join lots l on l.invoice_id = i.id
where not d.cancelled;

-- required documents not yet approved, per deal
create view v_doc_gaps with (security_invoker = true) as
select d.id as deal_id, d.deal_no, t.side, t.code, t.name, t.name_hi,
       coalesce((select max(x.status) filter (where x.status <> 'rejected') from documents x
                 where x.deal_id = d.id and x.doc_type = t.code), 'missing') as state
from deals d cross join doc_types t
where t.required and t.active and not d.cancelled
  and (t.side <> 'return' or exists (select 1 from returns r join lots l on l.id = r.lot_id where l.deal_id = d.id))
  and not exists (select 1 from documents x where x.deal_id = d.id and x.doc_type = t.code and x.status = 'approved');

-- balance for the stage only (no amounts exposed); payments are read past RLS here
create function lot_is_paid(p_invoice uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select i.total
     - coalesce((select sum(total) from notes where invoice_id = i.id and status <> 'cancelled'), 0)
     - coalesce((select sum(amount) from tds where invoice_id = i.id), 0)
     - coalesce((select sum(amount) from payments where invoice_id = i.id and status = 'reconciled'), 0)
     from invoices i where i.id = p_invoice) <= 0.005, false)
$$;

-- one row per lot with its stage
create view v_lots with (security_invoker = true) as
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
       end as stage
from lots l
join deals d on d.id = l.deal_id
join suppliers s on s.id = d.supplier_id
left join invoices i on i.id = l.invoice_id
left join v_payable p on p.invoice_id = l.invoice_id
where not d.cancelled;

-- deals still expecting material
create view v_deals_incoming with (security_invoker = true) as
select d.id as deal_id, d.deal_no, d.po_no, s.id as supplier_id, s.name as supplier, d.deal_date, d.expected_date, d.gst_rate,
       sum(dl.qty_kg) as ordered_kg,
       sum(least(coalesce(r.kg, 0), dl.qty_kg)) as received_kg,
       sum(greatest(dl.qty_kg - coalesce(r.kg, 0), 0)) as remaining_kg,
       round(sum(greatest(dl.qty_kg - coalesce(r.kg, 0), 0) * dl.rate_per_kg) * (1 + d.gst_rate / 100), 2) as remaining_value,
       (select count(*) from lots l where l.deal_id = d.id) as lots
from deals d
join suppliers s on s.id = d.supplier_id
join deal_lines dl on dl.deal_id = d.id
left join (select l.deal_id, il.grade, sum(il.billed_net_kg) as kg
           from lots l join invoice_lines il on il.invoice_id = l.invoice_id group by 1, 2) r
       on r.deal_id = d.id and r.grade = dl.grade
where not d.cancelled and not d.receiving_complete
group by d.id, s.id;

-- supplier ledger, as the portal sees it
create view v_ledger_lines with (security_invoker = true) as
select d.supplier_id, i.invoice_date as entry_date, 'invoice'::text as kind, i.invoice_no as ref, d.deal_no,
       i.total as credit, 0::numeric as debit, 'final'::text as status
from invoices i join deals d on d.id = i.deal_id
union all
select d.supplier_id, n.note_date, 'debit_note', coalesce(n.tally_no, n.dn_type), d.deal_no, 0, n.total, 'final'
from notes n join lots l on l.id = n.lot_id join deals d on d.id = l.deal_id where n.status <> 'cancelled'
union all
select d.supplier_id, t.deducted_on, 'tds', t.section, d.deal_no, 0, t.amount, 'final'
from tds t join invoices i on i.id = t.invoice_id join deals d on d.id = i.deal_id
union all
select p.supplier_id, p.paid_on, 'payment', coalesce(p.bank_ref, p.mode), d.deal_no, 0, p.amount,
       case when p.status = 'reconciled' then 'final' else 'pending' end
from payments p left join deals d on d.id = p.deal_id where p.status <> 'rejected';

create view v_supplier_balance with (security_invoker = true) as
select s.id as supplier_id, s.name as supplier, s.gstin,
       s.provisional_pct, s.provisional_days, s.balance_days,
       coalesce(sum(x.credit), 0) as invoiced,
       coalesce(sum(x.debit) filter (where x.kind = 'debit_note'), 0) as notes,
       coalesce(sum(x.debit) filter (where x.kind = 'tds'), 0) as tds,
       coalesce(sum(x.debit) filter (where x.kind = 'payment' and x.status = 'final'), 0) as paid,
       coalesce(sum(x.debit) filter (where x.kind = 'payment' and x.status = 'pending'), 0) as pending,
       coalesce(sum(x.credit), 0) - coalesce(sum(x.debit) filter (where x.status = 'final'), 0) as balance,
       lc.as_of as last_confirmed_on, lc.difference as last_difference
from suppliers s
left join v_ledger_lines x on x.supplier_id = s.id
left join lateral (select as_of, difference from ledger_confirmations c
                   where c.supplier_id = s.id order by as_of desc, confirmed_at desc limit 1) lc on true
where public.can('money_view')
group by s.id, lc.as_of, lc.difference;

-- cash needed: received lots (from the invoice) and deals still on the way (from deal rate x remaining kg)
-- terms: lot overrides deal, deal overrides supplier. Missing terms put the whole amount on the base date.
create view v_cash_plan with (security_invoker = true) as
with src as (
  select 'lot'::text as source, l.id as lot_id, l.lot_no, d.id as deal_id, d.deal_no, s.id as supplier_id, s.name as supplier,
         i.invoice_date as base_date, i.total as gross,
         coalesce(p.notes, 0) + coalesce(p.tds, 0) as deductions,
         coalesce((select sum(amount) from payments x where x.invoice_id = i.id and x.status <> 'rejected'), 0) as paid,
         coalesce(l.provisional_pct, d.provisional_pct, s.provisional_pct) as pct,
         coalesce(l.provisional_days, d.provisional_days, s.provisional_days) as pdays,
         coalesce(l.balance_days, d.balance_days, s.balance_days) as bdays
  from lots l join deals d on d.id = l.deal_id join suppliers s on s.id = d.supplier_id
  join invoices i on i.id = l.invoice_id
  left join v_payable p on p.invoice_id = i.id
  where not d.cancelled
  union all
  select 'incoming', null, null, g.deal_id, g.deal_no, g.supplier_id, g.supplier,
         coalesce(g.expected_date, g.deal_date), g.remaining_value, 0,
         coalesce((select sum(amount) from payments x where x.deal_id = g.deal_id and x.invoice_id is null and x.status <> 'rejected'), 0),
         coalesce(d.provisional_pct, s.provisional_pct), coalesce(d.provisional_days, s.provisional_days),
         coalesce(d.balance_days, s.balance_days)
  from v_deals_incoming g join deals d on d.id = g.deal_id join suppliers s on s.id = g.supplier_id
),
tr as (
  select src.*, (pct is null or pdays is null or bdays is null) as terms_missing,
         case when pct is null then 0 else round(gross * pct / 100, 2) end as t1
  from src
)
select source, lot_id, lot_no, deal_id, deal_no, supplier_id, supplier, 'provisional'::text as tranche,
       base_date + coalesce(pdays, 0) as due_date, greatest(t1 - paid, 0) as amount, terms_missing
from tr where pct is not null and t1 - paid > 0.005 and public.can('money_view')
union all
select source, lot_id, lot_no, deal_id, deal_no, supplier_id, supplier,
       case when pct is null then 'full' else 'balance' end,
       base_date + coalesce(bdays, pdays, 0),
       greatest(gross - deductions - t1 - greatest(paid - t1, 0), 0), terms_missing
from tr where gross - deductions - t1 - greatest(paid - t1, 0) > 0.005 and public.can('money_view');

-- GST by month: input GST on purchase invoices less GST on debit notes
create view v_gst_month with (security_invoker = true) as
select month, sum(invoice_gst) as invoice_gst, sum(dn_gst) as dn_gst, sum(invoice_gst) - sum(dn_gst) as net_input_gst,
       sum(not_in_2b) as invoices_not_in_2b
from (
  select to_char(invoice_date, 'YYYY-MM') as month, gst_amount as invoice_gst, 0::numeric as dn_gst,
         case when in_2b then 0 else 1 end as not_in_2b from invoices
  union all
  select to_char(note_date, 'YYYY-MM'), 0, gst_amount, 0 from notes where status <> 'cancelled'
) x where public.can('money_view') group by month;

-- stock movements; kg signed (+ in, - out)
create view v_stock_moves with (security_invoker = true) as
select g.stock_item as item, l.received_on as move_date, 'inward'::text as kind,
       coalesce(il.billed_net_kg, ll.factory_net_kg) as kg, l.lot_no as ref
from lot_lines ll join lots l on l.id = ll.lot_id join grades g on g.code = ll.grade
join deals d on d.id = l.deal_id
left join invoice_lines il on il.invoice_id = l.invoice_id and il.grade = ll.grade
where not d.cancelled
union all
select g.stock_item, n.note_date, 'note', -nl.stock_kg, coalesce(n.tally_no, l.lot_no || ' ' || n.dn_type)
from note_lines nl join notes n on n.id = nl.note_id join lots l on l.id = n.lot_id join grades g on g.code = nl.grade
where n.status <> 'cancelled' and nl.stock_kg <> 0
union all
select pl.item, r.run_date, pl.direction, case when pl.direction = 'consumed' then -pl.kg else pl.kg end,
       'Production ' || to_char(r.run_date, 'DD Mon')
from production_lines pl join production_runs r on r.id = pl.run_id
union all
select item, move_date, kind, kg, coalesce(reason, kind) from stock_moves;

create function stock_summary(p_from date, p_to date)
returns table (item text, name text, name_hi text, kind text, opening numeric, inward numeric, notes_out numeric,
               consumed numeric, produced numeric, dispatched numeric, other numeric, closing numeric,
               tally_closing numeric, difference numeric)
language sql stable set search_path = public as $$
  select i.code, i.name, i.name_hi, i.kind,
         coalesce(sum(m.kg) filter (where m.move_date < p_from), 0),
         coalesce(sum(m.kg) filter (where m.move_date between p_from and p_to and m.kind = 'inward'), 0),
         -coalesce(sum(m.kg) filter (where m.move_date between p_from and p_to and m.kind = 'note'), 0),
         -coalesce(sum(m.kg) filter (where m.move_date between p_from and p_to and m.kind = 'consumed'), 0),
         coalesce(sum(m.kg) filter (where m.move_date between p_from and p_to and m.kind = 'produced'), 0),
         -coalesce(sum(m.kg) filter (where m.move_date between p_from and p_to and m.kind = 'dispatch'), 0),
         coalesce(sum(m.kg) filter (where m.move_date between p_from and p_to
                                    and m.kind in ('opening','purchase_other','adjustment')), 0),
         coalesce(sum(m.kg) filter (where m.move_date <= p_to), 0),
         tc.tally_closing_kg,
         coalesce(sum(m.kg) filter (where m.move_date <= p_to), 0) - tc.tally_closing_kg
  from items i
  left join v_stock_moves m on m.item = i.code
  left join stock_tally_checks tc on tc.item = i.code and tc.as_of = p_to
  where i.active or m.item is not null
  group by i.code, i.name, i.name_hi, i.kind, i.sort, tc.tally_closing_kg
  order by i.sort, i.code
$$;

-- DN rows for Tally
create view v_tally_dn_export with (security_invoker = true) as
select n.id as note_id, l.id as lot_id, l.lot_no, d.deal_no, n.tally_no, n.note_date, n.dn_type,
       s.name as party, s.gstin as party_gstin, i.invoice_no as against_invoice, i.invoice_date,
       nl.grade, nl.description, nl.qty_kg, nl.rate, nl.amount, nl.stock_kg,
       n.taxable, n.gst_amount, n.round_off, n.total
from notes n
join note_lines nl on nl.note_id = n.id
join lots l on l.id = n.lot_id
join invoices i on i.id = n.invoice_id
join deals d on d.id = l.deal_id
join suppliers s on s.id = d.supplier_id
where n.status <> 'cancelled';

-- everyone's to-do list, filtered to what this person is allowed to act on
create view v_tasks with (security_invoker = true) as
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
  where not i.in_2b and i.invoice_date < date_trunc('month', current_date)
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
) t
where public.can(t.action);

-- ================= actions (called from the app) =================

create function create_deal(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sup uuid; v_deal uuid; v_line jsonb; v_plant uuid;
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
  v_plant := coalesce(nullif(p->>'plant_id', '')::uuid, (select plant_id from profiles where id = auth.uid()),
                      (select id from plants order by name limit 1));
  insert into deals (supplier_id, plant_id, deal_date, expected_date, po_no, po_date, gst_rate,
                     provisional_pct, provisional_days, balance_days, notes)
  values (v_sup, v_plant, coalesce(nullif(p->>'deal_date', '')::date, current_date), nullif(p->>'expected_date', '')::date,
          nullif(trim(p->>'po_no'), ''), nullif(p->>'po_date', '')::date, coalesce(nullif(p->>'gst_rate', '')::numeric, 18),
          nullif(p->>'provisional_pct', '')::numeric, nullif(p->>'provisional_days', '')::int, nullif(p->>'balance_days', '')::int,
          nullif(trim(p->>'notes'), ''))
  returning id into v_deal;
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    insert into deal_lines (deal_id, grade, qty_kg, rate_per_kg)
    values (v_deal, v_line->>'grade', (v_line->>'qty_kg')::numeric, (v_line->>'rate_per_kg')::numeric);
  end loop;
  return v_deal;
end $$;

create function create_lot(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_deal deals; v_inv uuid; v_lot uuid; v_line jsonb; v_tax numeric; v_gst numeric;
begin
  perform require('inward_edit');
  select * into v_deal from deals where id = (p->>'deal_id')::uuid;
  if not found or v_deal.cancelled then raise exception 'Deal not found.'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]')) = 0 then raise exception 'Add at least one grade.'; end if;
  if nullif(trim(p->>'invoice_no'), '') is null then raise exception 'Invoice number is required.'; end if;
  select round(sum((x->>'billed_net_kg')::numeric * (x->>'billed_rate')::numeric), 2) into v_tax
  from jsonb_array_elements(p->'lines') x;
  v_tax := coalesce(nullif(p->>'taxable_value', '')::numeric, v_tax);
  v_gst := coalesce(nullif(p->>'gst_amount', '')::numeric, round(v_tax * v_deal.gst_rate / 100, 2));
  insert into invoices (deal_id, invoice_no, invoice_date, gst_rate, taxable_value, gst_amount, total)
  values (v_deal.id, trim(p->>'invoice_no'), coalesce(nullif(p->>'invoice_date', '')::date, current_date),
          v_deal.gst_rate, v_tax, v_gst, coalesce(nullif(p->>'total', '')::numeric, v_tax + v_gst))
  returning id into v_inv;
  insert into lots (deal_id, invoice_id, received_on, vehicle_no)
  values (v_deal.id, v_inv, coalesce(nullif(p->>'received_on', '')::date, current_date), nullif(upper(trim(p->>'vehicle_no')), ''))
  returning id into v_lot;
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    insert into invoice_lines (invoice_id, grade, billed_net_kg, billed_rate, slip_gross_kg, slip_bag_kg)
    values (v_inv, v_line->>'grade', (v_line->>'billed_net_kg')::numeric, (v_line->>'billed_rate')::numeric,
            nullif(v_line->>'slip_gross_kg', '')::numeric, nullif(v_line->>'slip_bag_kg', '')::numeric);
    insert into lot_lines (lot_id, grade, factory_gross_kg, bag_count, factory_bag_kg)
    values (v_lot, v_line->>'grade', (v_line->>'factory_gross_kg')::numeric, nullif(v_line->>'bag_count', '')::int,
            coalesce(nullif(v_line->>'factory_bag_kg', '')::numeric, 0));
  end loop;
  if coalesce((p->>'completes_deal')::boolean, false) then
    update deals set receiving_complete = true where id = v_deal.id;
  end if;
  return v_lot;
end $$;

create function close_lot(p_lot uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require('lot_close');
  update lots set sorting_closed_at = now(), sorting_closed_by = auth.uid() where id = p_lot and sorting_closed_at is null;
  if not found then raise exception 'This lot is already closed.'; end if;
end $$;

create function reopen_lot(p_lot uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require('lot_close');
  if exists (select 1 from notes where lot_id = p_lot and status <> 'cancelled' and dn_type in ('rate_diff','return')) then
    raise exception 'Sorting debit notes are approved. Cancel them before reopening.';
  end if;
  update lots set sorting_closed_at = null, sorting_closed_by = null where id = p_lot;
end $$;

create function approve_dn(p_lot uuid, p_type text, p_date date, p_round boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare c record; v_id uuid; v_total numeric;
begin
  perform require('dn_approve');
  if p_type <> 'weight_short' and (select sorting_closed_at from lots where id = p_lot) is null then
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

create function cancel_note(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require('dn_approve');
  if nullif(trim(p_reason), '') is null then raise exception 'A reason is required to cancel.'; end if;
  update notes set status = 'cancelled', cancel_reason = p_reason where id = p_id and status <> 'cancelled';
  if not found then raise exception 'Debit note not found.'; end if;
  insert into audit_log (actor, table_name, row_id, action, detail)
  values (auth.uid(), 'notes', p_id, 'cancelled', jsonb_build_object('reason', p_reason));
end $$;

create function set_note_tally_no(p_id uuid, p_no text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can('tally_factory') or can('tally_office') or can('dn_approve')) then
    raise exception 'You are not allowed to do this.' using errcode = '42501';
  end if;
  update notes set tally_no = nullif(trim(p_no), '') where id = p_id;
end $$;

create function mark_tally(p_entity text, p_id uuid, p_book text, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require(case when p_book = 'factory' then 'tally_factory' else 'tally_office' end);
  if entity_amount(p_entity, p_id) is null then raise exception 'This entry no longer exists.'; end if;
  insert into tally_marks (entity, entity_id, book, voucher_ref, amount_at_mark, marked_by)
  values (p_entity, p_id, p_book, nullif(trim(p_ref), ''), entity_amount(p_entity, p_id), auth.uid())
  on conflict (entity, entity_id, book) do update
    set voucher_ref = coalesce(excluded.voucher_ref, tally_marks.voucher_ref), amount_at_mark = excluded.amount_at_mark,
        marked_by = excluded.marked_by, marked_at = now();
end $$;

-- after a correction or reversal has been made in Tally: clear a tick whose entry was cancelled or deleted
create function clear_tally_change(p_mark uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m tally_marks;
begin
  select * into m from tally_marks where id = p_mark;
  if not found then raise exception 'Not found.'; end if;
  perform require(case when m.book = 'factory' then 'tally_factory' else 'tally_office' end);
  if entity_amount(m.entity, m.entity_id) is null then delete from tally_marks where id = p_mark;
  else update tally_marks set amount_at_mark = entity_amount(m.entity, m.entity_id), marked_by = auth.uid(), marked_at = now() where id = p_mark;
  end if;
end $$;

create function unmark_tally(p_entity text, p_id uuid, p_book text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require(case when p_book = 'factory' then 'tally_factory' else 'tally_office' end);
  delete from tally_marks where entity = p_entity and entity_id = p_id and book = p_book;
end $$;

create function reconcile_payment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require('payment_reconcile');
  perform set_config('ra.via_fn', 'on', true);
  update payments set status = 'reconciled', reconciled_by = auth.uid(), reconciled_at = now(), reject_note = null
  where id = p_id and status = 'entered';
  if not found then raise exception 'Only a payment waiting for reconciliation can be reconciled.'; end if;
  perform set_config('ra.via_fn', 'off', true);
end $$;

create function reject_payment(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require('payment_reconcile');
  if nullif(trim(p_note), '') is null then raise exception 'Say what does not match.'; end if;
  perform set_config('ra.via_fn', 'on', true);
  update payments set status = 'rejected', reject_note = p_note where id = p_id and status = 'entered';
  if not found then raise exception 'Only a payment waiting for reconciliation can be sent back.'; end if;
  perform set_config('ra.via_fn', 'off', true);
end $$;

create function confirm_ledger(p_supplier uuid, p_as_of date, p_supplier_balance numeric, p_note text) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_portal numeric;
begin
  perform require('ledger_confirm');
  select coalesce(sum(credit), 0) - coalesce(sum(debit) filter (where status = 'final'), 0) into v_portal
  from v_ledger_lines where supplier_id = p_supplier and entry_date <= p_as_of;
  insert into ledger_confirmations (supplier_id, as_of, supplier_balance, portal_balance, note, confirmed_by)
  values (p_supplier, p_as_of, p_supplier_balance, v_portal, nullif(trim(p_note), ''), auth.uid());
  return p_supplier_balance - v_portal;
end $$;

create function set_invoice_2b(p_id uuid, p_in boolean, p_period text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require('tax_edit');
  perform set_config('ra.via_fn', 'on', true);
  update invoices set in_2b = p_in, gstr2b_period = case when p_in then nullif(trim(p_period), '') end where id = p_id;
  perform set_config('ra.via_fn', 'off', true);
end $$;

create function save_production(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_run uuid; v_line jsonb;
begin
  perform require('production_edit');
  if jsonb_array_length(coalesce(p->'lines', '[]')) = 0 then raise exception 'Add what was used and what was made.'; end if;
  insert into production_runs (run_date, plant_id, notes)
  values (coalesce(nullif(p->>'run_date', '')::date, current_date),
          (select coalesce(plant_id, (select id from plants order by name limit 1)) from profiles where id = auth.uid()),
          nullif(trim(p->>'notes'), ''))
  returning id into v_run;
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    insert into production_lines (run_id, item, direction, kg)
    values (v_run, v_line->>'item', v_line->>'direction', (v_line->>'kg')::numeric);
  end loop;
  return v_run;
end $$;

create function verify_document(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require('doc_verify');
  update documents set status = 'verified', verified_by = auth.uid() where id = p_id and status = 'uploaded';
  if not found then raise exception 'Only an uploaded document can be verified.'; end if;
  insert into audit_log (actor, table_name, row_id, action) values (auth.uid(), 'documents', p_id, 'verified');
end $$;

create function approve_document(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require('doc_approve');
  update documents set status = 'approved', approved_by = auth.uid() where id = p_id and status = 'verified';
  if not found then raise exception 'Only a verified document can be approved.'; end if;
  insert into audit_log (actor, table_name, row_id, action) values (auth.uid(), 'documents', p_id, 'approved');
end $$;

create function reject_document(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can('doc_verify') or can('doc_approve')) then
    raise exception 'You are not allowed to do this.' using errcode = '42501';
  end if;
  if nullif(trim(p_note), '') is null then raise exception 'A reason is required to reject.'; end if;
  update documents set status = 'rejected', note = p_note where id = p_id and status in ('uploaded','verified');
  if not found then raise exception 'This document can no longer be rejected.'; end if;
  insert into audit_log (actor, table_name, row_id, action, detail)
  values (auth.uid(), 'documents', p_id, 'rejected', jsonb_build_object('note', p_note));
end $$;
