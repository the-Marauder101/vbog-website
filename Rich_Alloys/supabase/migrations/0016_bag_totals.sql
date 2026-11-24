-- Depesh, 24 Nov: bags on each truck in total (count and weight), shown with the lot and in the lot table.
-- Counts and weights are entered per grade at our weighbridge (lot_lines.bag_count, factory_bag_kg); these are the totals.
-- The supplier's invoice number is the main number on screens; L-/D- numbers stay as the internal ones (screens only).

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
       (select array_agg(distinct x.deal_id) from lot_lines x where x.lot_id = l.id) as deal_ids,
       (select sum(x.bag_count) from lot_lines x where x.lot_id = l.id) as bags,
       (select sum(x.factory_bag_kg) from lot_lines x where x.lot_id = l.id) as bag_kg
from lots l
join deals d on d.id = l.deal_id
join suppliers s on s.id = d.supplier_id
left join invoices i on i.id = l.invoice_id
left join v_payable p on p.invoice_id = l.invoice_id
where not d.cancelled;

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
       ln.bags, ln.bag_kg
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

