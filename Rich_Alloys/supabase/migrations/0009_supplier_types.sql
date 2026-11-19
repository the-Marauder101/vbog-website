-- PRD 7b (decision 30): every source that brings material in is a supplier, and each delivery is a lot.
-- Physical steps are the same for all. Money steps apply only to domestic purchases (a tax invoice):
--   domestic  : tax invoice; debit notes in rupees; payable, cash plan, ledger, TDS, office Tally, register
--   branch    : delivery note; shortage/return note in kg only (a company cannot debit itself)
--   import    : bill of entry, from arrival at Palghar; claim note in kg only (paid through LC: out of scope)
--   job_work  : challan; shortage note in kg only; what was sent vs what came back
-- Non-domestic lots still reduce/increase stock and still go to factory Tally.

alter table suppliers add column supplier_type text not null default 'domestic'
  check (supplier_type in ('domestic','branch','import','job_work'));

alter table invoices add column doc_kind text not null default 'tax_invoice'
  check (doc_kind in ('tax_invoice','delivery_note','bill_of_entry','challan'));

-- non-domestic material carries no price
alter table deal_lines drop constraint deal_lines_rate_per_kg_check;
alter table deal_lines add constraint deal_lines_rate_per_kg_check check (rate_per_kg >= 0);
alter table invoice_lines drop constraint invoice_lines_billed_rate_check;
alter table invoice_lines add constraint invoice_lines_billed_rate_check check (billed_rate >= 0);

alter table lots add column sent_by text;                          -- branch: who dispatched it at Mumbai
alter table stock_moves add column supplier_id uuid references suppliers(id);   -- job work sent / to branch: to whom

insert into doc_types (code, name, name_hi, side, required, sort) values
  ('DELIVERY_NOTE', 'Delivery note (branch)', 'डिलीवरी नोट (ब्रांच)', 'supplier', false, 13),
  ('BILL_OF_ENTRY', 'Bill of entry (import)', 'बिल ऑफ एंट्री (इम्पोर्ट)', 'supplier', false, 14),
  ('CHALLAN', 'Job work challan', 'जॉब वर्क चालान', 'supplier', false, 15)
on conflict (code) do nothing;

create function doc_kind_for(p_type text) returns text language sql immutable as $$
  select case p_type when 'branch' then 'delivery_note' when 'import' then 'bill_of_entry'
                     when 'job_work' then 'challan' else 'tax_invoice' end
$$;

-- ---------- arrival ----------
-- create_lot as in v2.2, plus: the document kind follows the supplier type; non-domestic carries no money.
create or replace function create_lot(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_deal deals; v_type text; v_kind text; v_inv uuid; v_lot uuid; v_line jsonb; v_tax numeric; v_gst numeric;
begin
  perform require('inward_edit');
  select * into v_deal from deals where id = (p->>'deal_id')::uuid;
  if not found or v_deal.cancelled then raise exception 'Deal not found.'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]')) = 0 then raise exception 'Add at least one grade.'; end if;
  if nullif(trim(p->>'invoice_no'), '') is null then raise exception 'Document number is required.'; end if;
  select supplier_type into v_type from suppliers where id = v_deal.supplier_id;
  v_kind := doc_kind_for(v_type);
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
    insert into lot_lines (lot_id, grade, factory_gross_kg, bag_count, factory_bag_kg)
    values (v_lot, v_line->>'grade', (v_line->>'factory_gross_kg')::numeric, nullif(v_line->>'bag_count', '')::int,
            coalesce(nullif(v_line->>'factory_bag_kg', '')::numeric, 0));
  end loop;
  if coalesce((p->>'completes_deal')::boolean, false) then
    update deals set receiving_complete = true where id = v_deal.id;
  end if;
  return v_lot;
end $$;

-- Branch, import and job-work arrivals have no booked deal: one is made for the delivery, then the lot.
create function create_receipt(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_type text; v_deal uuid; v_plant uuid; v_line jsonb;
begin
  perform require('inward_edit');
  select supplier_type into v_type from suppliers where id = (p->>'supplier_id')::uuid and active;
  if v_type is null then raise exception 'Choose who sent the material.'; end if;
  if v_type = 'domestic' then raise exception 'Domestic purchases start from a deal.'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]')) = 0 then raise exception 'Add at least one grade.'; end if;
  v_plant := coalesce((select plant_id from profiles where id = auth.uid()), (select id from plants order by name limit 1));
  insert into deals (supplier_id, plant_id, deal_date, gst_rate, receiving_complete, notes)
  values ((p->>'supplier_id')::uuid, v_plant, coalesce(nullif(p->>'received_on', '')::date, current_date), 0, true,
          'Receipt: ' || doc_kind_for(v_type))
  returning id into v_deal;
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    insert into deal_lines (deal_id, grade, qty_kg, rate_per_kg)
    values (v_deal, v_line->>'grade', (v_line->>'billed_net_kg')::numeric, 0);
  end loop;
  return create_lot(p || jsonb_build_object('deal_id', v_deal));
end $$;

revoke execute on function create_receipt(jsonb), doc_kind_for(text) from public, anon;
grant execute on function create_receipt(jsonb), doc_kind_for(text) to authenticated;

-- ================= money views: tax invoices only (v2.2 definitions plus one filter each) =================

create or replace view v_payable with (security_invoker = true) as
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
where public.can('money_view') and i.doc_kind = 'tax_invoice';

-- factory Tally gets every inward and every note (stock); office Tally only tax invoices and their notes
create or replace view v_tally_missing with (security_invoker = true) as
select 'invoice'::text as entity, i.id as entity_id, b.book, l.id as lot_id, i.invoice_date as entry_date
from invoices i join lots l on l.invoice_id = i.id cross join (values ('factory'), ('office')) b(book)
where (b.book = 'factory' or i.doc_kind = 'tax_invoice')
  and not exists (select 1 from tally_marks t where t.entity = 'invoice' and t.entity_id = i.id and t.book = b.book)
union all
select 'note', n.id, b.book, n.lot_id, n.note_date
from notes n join invoices ni on ni.id = n.invoice_id cross join (values ('factory'), ('office')) b(book)
where n.status <> 'cancelled' and (b.book = 'factory' or ni.doc_kind = 'tax_invoice')
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

-- purchase invoice register (replaces the invoice-tracker Excel): tax invoices only
create or replace view v_invoice_register with (security_invoker = true) as
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
where not d.cancelled and i.doc_kind = 'tax_invoice';

create or replace view v_ledger_lines with (security_invoker = true) as
select d.supplier_id, i.invoice_date as entry_date, 'invoice'::text as kind, i.invoice_no as ref, d.deal_no,
       i.total as credit, 0::numeric as debit, 'final'::text as status
from invoices i join deals d on d.id = i.deal_id
where i.doc_kind = 'tax_invoice'
union all
select d.supplier_id, n.note_date, 'debit_note', coalesce(n.tally_no, n.dn_type), d.deal_no, 0, n.total, 'final'
from notes n join lots l on l.id = n.lot_id join deals d on d.id = l.deal_id join invoices ni on ni.id = n.invoice_id
where n.status <> 'cancelled' and ni.doc_kind = 'tax_invoice'
union all
select d.supplier_id, t.deducted_on, 'tds', t.section, d.deal_no, 0, t.amount, 'final'
from tds t join invoices i on i.id = t.invoice_id join deals d on d.id = i.deal_id
union all
select p.supplier_id, p.paid_on, 'payment', coalesce(p.bank_ref, p.mode), d.deal_no, 0, p.amount,
       case when p.status = 'reconciled' then 'final' else 'pending' end
from payments p left join deals d on d.id = p.deal_id where p.status <> 'rejected';

create or replace view v_supplier_balance with (security_invoker = true) as
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
where public.can('money_view') and s.supplier_type = 'domestic'
group by s.id, lc.as_of, lc.difference;

create or replace view v_cash_plan with (security_invoker = true) as
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
  where not d.cancelled and i.doc_kind = 'tax_invoice'
  union all
  select 'incoming', null, null, g.deal_id, g.deal_no, g.supplier_id, g.supplier,
         coalesce(g.expected_date, g.deal_date), g.remaining_value, 0,
         coalesce((select sum(amount) from payments x where x.deal_id = g.deal_id and x.invoice_id is null and x.status <> 'rejected'), 0),
         coalesce(d.provisional_pct, s.provisional_pct), coalesce(d.provisional_days, s.provisional_days),
         coalesce(d.balance_days, s.balance_days)
  from v_deals_incoming g join deals d on d.id = g.deal_id join suppliers s on s.id = g.supplier_id
  where s.supplier_type = 'domestic'
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

create or replace view v_gst_month with (security_invoker = true) as
select month, sum(invoice_gst) as invoice_gst, sum(dn_gst) as dn_gst, sum(invoice_gst) - sum(dn_gst) as net_input_gst,
       sum(not_in_2b) as invoices_not_in_2b
from (
  select to_char(invoice_date, 'YYYY-MM') as month, gst_amount as invoice_gst, 0::numeric as dn_gst,
         case when in_2b then 0 else 1 end as not_in_2b from invoices where doc_kind = 'tax_invoice'
  union all
  select to_char(note_date, 'YYYY-MM'), 0, gst_amount, 0 from notes where status <> 'cancelled'
) x where public.can('money_view') group by month;

-- lots: the same columns, plus who sent it (type) and what document came with it
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
       s.supplier_type, i.doc_kind, l.sent_by
from lots l
join deals d on d.id = l.deal_id
join suppliers s on s.id = d.supplier_id
left join invoices i on i.id = l.invoice_id
left join v_payable p on p.invoice_id = l.invoice_id
where not d.cancelled;

-- job workers: what was sent to them vs what came back
create view v_job_work with (security_invoker = true) as
with x as (
  select s.id as supplier_id, s.name as supplier,
         coalesce((select -sum(m.kg) from stock_moves m where m.supplier_id = s.id and m.kind = 'job_work_out'), 0) as sent_kg,
         coalesce((select sum(ll.factory_net_kg) from lots l join lot_lines ll on ll.lot_id = l.id join deals d on d.id = l.deal_id
                   where d.supplier_id = s.id and not d.cancelled), 0) as returned_kg
  from suppliers s where s.supplier_type = 'job_work'
)
select supplier_id, supplier, sent_kg, returned_kg, sent_kg - returned_kg as with_job_worker_kg from x;

revoke all on v_job_work from anon;
grant select on v_job_work to authenticated;

-- 2B task: tax invoices only (rest of v_tasks unchanged)
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
) t
where public.can(t.action);

-- ---------- document checklist by supplier type (proposal; PRD 13 question 26) ----------
-- null = every type. PO, tax invoice and e-invoice belong to a purchase; each other type has its own document.
alter table doc_types add column supplier_types text[];
update doc_types set supplier_types = '{domestic}' where code in ('PO','TAX_INVOICE','E_INVOICE');
update doc_types set supplier_types = '{branch}', required = true where code = 'DELIVERY_NOTE';
update doc_types set supplier_types = '{import}', required = true where code = 'BILL_OF_ENTRY';
update doc_types set supplier_types = '{job_work}', required = true where code = 'CHALLAN';

create or replace view v_doc_gaps with (security_invoker = true) as
select d.id as deal_id, d.deal_no, t.side, t.code, t.name, t.name_hi,
       coalesce((select max(x.status) filter (where x.status <> 'rejected') from documents x
                 where x.deal_id = d.id and x.doc_type = t.code), 'missing') as state
from deals d join suppliers s on s.id = d.supplier_id cross join doc_types t
where t.required and t.active and not d.cancelled
  and (t.supplier_types is null or s.supplier_type = any (t.supplier_types))
  and (t.side <> 'return' or exists (select 1 from returns r join lots l on l.id = r.lot_id where l.deal_id = d.id))
  and not exists (select 1 from documents x where x.deal_id = d.id and x.doc_type = t.code and x.status = 'approved');
