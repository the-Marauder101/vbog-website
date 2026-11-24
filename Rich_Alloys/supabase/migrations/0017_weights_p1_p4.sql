-- Depesh, 24 Nov: the weights of a purchase, named the way the factory thinks of them.
--   P1  weight agreed in the deal / PO                         deal_lines.qty_kg
--   P2  weight on the supplier's invoice                        invoice_lines.billed_net_kg
--   P3  gross at our weighbridge, bags included                 lot_lines.factory_gross_kg
--   bags: we count and weigh them (the supplier never gives it)  lot_lines.bag_count, factory_bag_kg
--   P4  our net = P3 - bags                                     lot_lines.factory_net_kg (computed)
--   weight short = P2 - P4 (drives the weight-short debit note, unchanged)
--   PO difference = P2 - P1, per deal grade over all its trucks (new; shown and highlighted)

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
       coalesce(s.sorted_kg, 0) as sorted_kg, coalesce(s.dn_kg, 0) as debit_kg,
       dl.qty_kg as agreed_kg
from lot_lines ll
join lots l on l.id = ll.lot_id
join deals d on d.id = ll.deal_id
join grades g on g.code = ll.grade
left join invoice_lines il on il.invoice_id = l.invoice_id and il.grade = ll.grade
left join deal_lines dl on dl.deal_id = ll.deal_id and dl.grade = ll.grade
left join (select lot_line_id, sum(sorted_kg) as sorted_kg, sum(dn_kg) as dn_kg
           from sorting_lines group by lot_line_id) s on s.lot_line_id = ll.id;

-- per deal and grade: agreed vs invoiced vs our net, over every truck that carried it
create view v_deal_weights with (security_invoker = true) as
select d.id as deal_id, d.deal_no, dl.grade, g.name as grade_name, g.name_hi as grade_name_hi,
       dl.qty_kg as agreed_kg,
       coalesce(sum(il.billed_net_kg), 0) as invoiced_kg,
       coalesce(sum(ll.factory_gross_kg), 0) as gross_kg,
       coalesce(sum(ll.bag_count), 0) as bags,
       coalesce(sum(ll.factory_bag_kg), 0) as bag_kg,
       coalesce(sum(ll.factory_net_kg), 0) as net_kg,
       coalesce(sum(il.billed_net_kg - ll.factory_net_kg), 0) as short_kg,
       coalesce(sum(il.billed_net_kg), 0) - dl.qty_kg as po_diff_kg,
       count(ll.id) as trucks
from deals d
join deal_lines dl on dl.deal_id = d.id
join grades g on g.code = dl.grade
left join lot_lines ll on ll.deal_id = d.id and ll.grade = dl.grade
left join lots l on l.id = ll.lot_id
left join invoice_lines il on il.invoice_id = l.invoice_id and il.grade = ll.grade
where not d.cancelled
group by d.id, dl.id, g.code;
revoke all on v_deal_weights from anon;
grant select on v_deal_weights to authenticated;
