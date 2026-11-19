-- Tinu's monthly stock statement (Stock_analysis_2627.xlsx), produced by the portal in his columns:
-- OP BALANCE | PURCHASE | TRANSFER RECED | MFG | Recipt Note | Recd Process Job Wrk | CREDIT NOTE | TOTAL |
-- SALE | Transfer to | Debit Note | Del Note To Rich Mum | Send to Labour Job | Consumption | Closing Balance
-- Lots now land in the right column by supplier type (PRD 7b): branch lots are "Recipt Note",
-- job-work lots are "Recd Process Job Wrk", domestic and import lots are "PURCHASE".

insert into items (code, name, name_hi, kind, sort) values
  ('PLASTIC_SCRAP', 'Plastic scrap', 'प्लास्टिक स्क्रैप', 'byproduct', 9)
on conflict (code) do nothing;

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
  select pl.item, r.run_date, pl.direction, case when pl.direction = 'consumed' then -pl.kg else pl.kg end,
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

drop function stock_summary(date, date);
create function stock_summary(p_from date, p_to date)
returns table (item text, name text, name_hi text, kind text,
               opening numeric, purchase numeric, transfer_in numeric, produced numeric, receipt_note numeric,
               job_work_in numeric, credit_note numeric, total numeric,
               sale numeric, transfer_out numeric, debit_note numeric, to_branch numeric, to_job_work numeric, consumed numeric,
               correction numeric, closing numeric, total_in numeric, total_out numeric,
               tally_closing numeric, difference numeric)
language sql stable set search_path = public as $$
  with m as (
    select m.*, (m.move_date between p_from and p_to) as inp from v_stock_moves m
  ), s as (
    select i.code, i.name, i.name_hi, i.kind as ikind, i.sort, i.active,
      coalesce(sum(m.kg) filter (where m.move_date < p_from or (m.inp and m.kind = 'opening')), 0) as opening,
      coalesce(sum(m.kg) filter (where m.inp and m.kind in ('inward','purchase_other','import_receipt')), 0) as purchase,
      coalesce(sum(m.kg) filter (where m.inp and m.kind = 'transfer_in'), 0) as transfer_in,
      coalesce(sum(m.kg) filter (where m.inp and m.kind = 'produced'), 0) as produced,
      coalesce(sum(m.kg) filter (where m.inp and m.kind = 'branch_in'), 0) as receipt_note,
      coalesce(sum(m.kg) filter (where m.inp and m.kind = 'job_work_in'), 0) as job_work_in,
      coalesce(sum(m.kg) filter (where m.inp and m.kind = 'credit_note'), 0) as credit_note,
      -coalesce(sum(m.kg) filter (where m.inp and m.kind = 'dispatch'), 0) as sale,
      -coalesce(sum(m.kg) filter (where m.inp and m.kind = 'transfer_out'), 0) as transfer_out,
      -coalesce(sum(m.kg) filter (where m.inp and m.kind = 'note'), 0) as debit_note,
      -coalesce(sum(m.kg) filter (where m.inp and m.kind = 'branch_out'), 0) as to_branch,
      -coalesce(sum(m.kg) filter (where m.inp and m.kind = 'job_work_out'), 0) as to_job_work,
      -coalesce(sum(m.kg) filter (where m.inp and m.kind = 'consumed'), 0) as consumed,
      coalesce(sum(m.kg) filter (where m.inp and m.kind = 'adjustment'), 0) as correction,
      coalesce(sum(m.kg) filter (where m.move_date <= p_to), 0) as closing,
      count(*) filter (where m.inp) as moves
    from items i left join m on m.item = i.code
    group by i.code, i.name, i.name_hi, i.kind, i.sort, i.active
  )
  select s.code, s.name, s.name_hi, s.ikind, s.opening,
         s.purchase, s.transfer_in, s.produced, s.receipt_note, s.job_work_in, s.credit_note,
         s.opening + s.purchase + s.transfer_in + s.produced + s.receipt_note + s.job_work_in + s.credit_note,
         s.sale, s.transfer_out, s.debit_note, s.to_branch, s.to_job_work, s.consumed,
         s.correction, s.closing,
         s.purchase + s.transfer_in + s.produced + s.receipt_note + s.job_work_in + s.credit_note + greatest(s.correction, 0),
         s.sale + s.transfer_out + s.debit_note + s.to_branch + s.to_job_work + s.consumed + greatest(-s.correction, 0),
         tc.tally_closing_kg, s.closing - tc.tally_closing_kg
  from s
  left join stock_tally_checks tc on tc.item = s.code and tc.as_of = p_to
  where s.active or s.opening <> 0 or s.closing <> 0 or s.moves > 0
  order by s.sort, s.code
$$;

revoke execute on function stock_summary(date, date) from public, anon;
grant execute on function stock_summary(date, date) to authenticated;
