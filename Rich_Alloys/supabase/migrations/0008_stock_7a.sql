-- PRD section 7a: stock as Tinu keeps it (from his Apr-Oct 2026 stock and production sheets).
--  1. Stock items named as in his sheets.
--  2. Stock movements beyond supplier lots, quantity only, with party and document number:
--     branch transfers, job work, import receipts (bill of entry), sales/dispatch, item-to-item transfers,
--     credit notes. No prices, buyers or import process: those stay out of scope.
--  3. Production keeps the actual figures and shows yield; nothing forces input = output.
--  4. An opening entry starts an item's stock: earlier movements are already inside the opening.
--  6. Supplier GSTIN must look like a GSTIN.

-- ---------- 1. items ----------
update items set name = 'Copper scrap',          name_hi = 'कॉपर स्क्रैप',       sort = 1 where code = 'COPPER_SCRAP';
update items set name = 'Phosphorus copper',     name_hi = 'फॉस्फोरस कॉपर',      sort = 4 where code = 'PHOS_COPPER';
update items set name = 'Copper ingot',          name_hi = 'कॉपर इंगट',          sort = 5 where code = 'COPPER_INGOT';
update items set name = 'Copper dross/slag',     name_hi = 'कॉपर ड्रॉस/स्लैग',   sort = 7 where code = 'COPPER_GROSS_SLAG';
insert into items (code, name, name_hi, kind, sort) values
  ('COPPER_WIRE',           'Copper wire',             'कॉपर वायर',              'raw',       2),
  ('COPPER_STRIPS',         'Copper strips',           'कॉपर स्ट्रिप्स',          'raw',       3),
  ('COPPER_INGOT_74031900', 'Copper ingot (74031900)', 'कॉपर इंगट (74031900)',  'finished',  6),
  ('COPPER_ASH',            'Copper ash',              'कॉपर ऐश',               'byproduct', 8)
on conflict (code) do nothing;

-- ---------- 2. stock movements ----------
alter table stock_moves drop constraint if exists stock_moves_kind_check;
alter table stock_moves drop constraint if exists stock_moves_check;
alter table stock_moves drop constraint if exists stock_moves_check1;
alter table stock_moves drop constraint if exists stock_moves_check2;
alter table stock_moves
  add column party text,
  add column doc_no text,
  add column transfer_id uuid,
  add constraint stock_moves_kind_check check (kind in (
    'opening','purchase_other','import_receipt','branch_in','job_work_in','credit_note','transfer_in',
    'dispatch','branch_out','job_work_out','transfer_out','adjustment')),
  add constraint stock_moves_in_positive check (
    kind not in ('opening','purchase_other','import_receipt','branch_in','job_work_in','credit_note','transfer_in') or kg > 0),
  add constraint stock_moves_out_negative check (
    kind not in ('dispatch','branch_out','job_work_out','transfer_out') or kg < 0),
  add constraint stock_moves_adjustment_reason check (kind <> 'adjustment' or nullif(trim(reason), '') is not null),
  add constraint stock_moves_transfer_pair check ((kind in ('transfer_in','transfer_out')) = (transfer_id is not null));

-- Item-to-item transfer (e.g. Copper ingot to Copper ingot 74031900): both sides in one step, same kg.
create function transfer_stock(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := gen_random_uuid(); v_kg numeric := (p->>'kg')::numeric;
        v_date date := coalesce(nullif(p->>'move_date', '')::date, current_date);
begin
  perform require('stock_edit');
  if coalesce(v_kg, 0) <= 0 then raise exception 'Enter the weight moved.'; end if;
  if (p->>'from_item') = (p->>'to_item') then raise exception 'Choose two different items.'; end if;
  insert into stock_moves (move_date, item, kind, kg, doc_no, reason, transfer_id) values
    (v_date, p->>'from_item', 'transfer_out', -v_kg, nullif(trim(p->>'doc_no'), ''), nullif(trim(p->>'reason'), ''), v_id),
    (v_date, p->>'to_item',   'transfer_in',   v_kg, nullif(trim(p->>'doc_no'), ''), nullif(trim(p->>'reason'), ''), v_id);
  return v_id;
end $$;
revoke execute on function transfer_stock(jsonb) from public, anon;
grant execute on function transfer_stock(jsonb) to authenticated;

-- ---------- 4. every movement, signed; an opening entry starts the item's stock ----------
-- Movements dated before an item's latest opening are already inside that opening (e.g. the Ogo lot of 25 Oct
-- is inside Tinu's 31 Oct closing), so they are left out. Items without an opening count everything.
create or replace view v_stock_moves with (security_invoker = true) as
with raw as (
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
  select item, move_date, kind, kg, coalesce(nullif(concat_ws(' · ', party, doc_no, reason), ''), kind) from stock_moves
), starts as (
  select item, max(move_date) as start_date from stock_moves where kind = 'opening' group by item
)
select r.item, r.move_date, r.kind, r.kg, r.ref
from raw r left join starts s on s.item = r.item
where s.start_date is null
   or (r.move_date >= s.start_date and (r.kind <> 'opening' or r.move_date = s.start_date));

-- Stock per item for a period, in the shape of Tinu's monthly summary. All sums here, none on screen.
drop function stock_summary(date, date);
create function stock_summary(p_from date, p_to date)
returns table (item text, name text, name_hi text, kind text,
               opening numeric, purchased numeric, branch_in numeric, produced numeric, other_in numeric, total_in numeric,
               consumed numeric, notes_out numeric, sold numeric, branch_out numeric, other_out numeric, total_out numeric,
               closing numeric, tally_closing numeric, difference numeric)
language sql stable set search_path = public as $$
  with m as (
    select m.*, (m.move_date between p_from and p_to) as inp from v_stock_moves m
  ), s as (
    select i.code, i.name, i.name_hi, i.kind as ikind, i.sort,
      coalesce(sum(m.kg) filter (where m.move_date < p_from or (m.inp and m.kind = 'opening')), 0) as opening,
      coalesce(sum(m.kg) filter (where m.inp and m.kind in ('inward','purchase_other','import_receipt')), 0) as purchased,
      coalesce(sum(m.kg) filter (where m.inp and m.kind = 'branch_in'), 0) as branch_in,
      coalesce(sum(m.kg) filter (where m.inp and m.kind = 'produced'), 0) as produced,
      coalesce(sum(m.kg) filter (where m.inp and (m.kind in ('job_work_in','credit_note','transfer_in')
                                              or (m.kind = 'adjustment' and m.kg > 0))), 0) as other_in,
      -coalesce(sum(m.kg) filter (where m.inp and m.kind = 'consumed'), 0) as consumed,
      -coalesce(sum(m.kg) filter (where m.inp and m.kind = 'note'), 0) as notes_out,
      -coalesce(sum(m.kg) filter (where m.inp and m.kind = 'dispatch'), 0) as sold,
      -coalesce(sum(m.kg) filter (where m.inp and m.kind = 'branch_out'), 0) as branch_out,
      -coalesce(sum(m.kg) filter (where m.inp and (m.kind in ('job_work_out','transfer_out')
                                               or (m.kind = 'adjustment' and m.kg < 0))), 0) as other_out,
      coalesce(sum(m.kg) filter (where m.move_date <= p_to), 0) as closing
    from items i left join m on m.item = i.code
    group by i.code, i.name, i.name_hi, i.kind, i.sort
  )
  select s.code, s.name, s.name_hi, s.ikind, s.opening,
         s.purchased, s.branch_in, s.produced, s.other_in, s.purchased + s.branch_in + s.produced + s.other_in,
         s.consumed, s.notes_out, s.sold, s.branch_out, s.other_out, s.consumed + s.notes_out + s.sold + s.branch_out + s.other_out,
         s.closing, tc.tally_closing_kg, s.closing - tc.tally_closing_kg
  from s
  left join stock_tally_checks tc on tc.item = s.code and tc.as_of = p_to
  where (select active from items where code = s.code) or s.opening <> 0 or s.closing <> 0
     or exists (select 1 from m where m.item = s.code and m.inp)
  order by s.sort, s.code
$$;

-- ---------- 3. production as entered, with yield ----------
-- yield = finished goods made / everything consumed. Dross and ash are not forced to balance the run:
-- "unaccounted" is what went in and did not come out as anything entered (real melting loss).
create view v_production_runs with (security_invoker = true) as
select r.id, r.run_date, r.notes,
       coalesce(sum(pl.kg) filter (where pl.direction = 'consumed'), 0) as consumed_kg,
       coalesce(sum(pl.kg) filter (where pl.direction = 'produced' and i.kind = 'finished'), 0) as finished_kg,
       coalesce(sum(pl.kg) filter (where pl.direction = 'produced' and i.kind <> 'finished'), 0) as byproduct_kg,
       round(100 * coalesce(sum(pl.kg) filter (where pl.direction = 'produced' and i.kind = 'finished'), 0)
             / nullif(sum(pl.kg) filter (where pl.direction = 'consumed'), 0), 2) as yield_pct,
       coalesce(sum(pl.kg) filter (where pl.direction = 'consumed'), 0)
         - coalesce(sum(pl.kg) filter (where pl.direction = 'produced'), 0) as unaccounted_kg
from production_runs r
left join production_lines pl on pl.run_id = r.id
left join items i on i.code = pl.item
group by r.id, r.run_date, r.notes;

revoke all on v_production_runs from anon;
grant select on v_production_runs to authenticated;
revoke execute on function stock_summary(date, date) from public, anon;
grant execute on function stock_summary(date, date) to authenticated;

-- ---------- 6. supplier GSTIN ----------
update suppliers set gstin = upper(trim(gstin)) where gstin is not null;
alter table suppliers add constraint suppliers_gstin_format
  check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$');
