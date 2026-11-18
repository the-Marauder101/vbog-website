-- Slices 2-5: weights and sorting, debit notes and returns, payables, deal book, Tally export.
-- ACCESS CONTROL IS DEFERRED (Depesh, 18 Nov): any active staff member may write these tables.
-- Role rules come later. What stays strict now is what protects money:
--   * DNs change only through functions; an approved DN is frozen.
--   * Weights and sorting of an invoice are frozen while any of its DNs stands.
--   * Every insert, update and delete on money tables is written to audit_log.

-- ---------- writes for every active staff member (placeholder until access control) ----------
do $$ declare t text; begin
  foreach t in array array['plants','suppliers','grades','sort_categories','deals','deal_lines','invoices','invoice_lines',
                           'receipts','receipt_lines','sorting_lines','returns','payments','deductions'] loop
    execute format('create policy staff_write on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end $$;

-- ---------- Hindi for master data (PRD 9) ----------
alter table grades add column name_hi text;
alter table sort_categories add column name_hi text;
update grades set name_hi = case code when 'OC' then 'ओसी' when 'LAL' then 'लाल' end;
update sort_categories set name_hi = case code when 'LEAD_COPPER' then 'लेड कॉपर' when 'DC' then 'डीसी'
  when 'LOW_QUALITY' then 'कम क्वालिटी' when 'ATTACHMENT' then 'अटैचमेंट' when 'MITTI' then 'मिट्टी' end;

-- Photos of rejected material, used in the supplier DN working. Optional, so not a gap.
insert into doc_types (code, name, name_hi, side, required, sort)
values ('REJECTION_PHOTOS', 'Rejected material photos', 'रिजेक्ट माल की फोटो', 'rich_alloys', false, 24);

-- ---------- debit notes: one live DN per invoice and type; cancel, re-approve, Tally number ----------
alter table debit_notes drop constraint debit_notes_invoice_id_dn_type_key;
create unique index debit_notes_one_live on debit_notes (invoice_id, dn_type) where status <> 'cancelled';
alter table debit_notes add column cancel_reason text;

create function approve_debit_note(p_invoice uuid, p_type text, p_round_to_rupee boolean) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  if exists (select 1 from debit_notes where invoice_id = p_invoice and dn_type = p_type and status <> 'cancelled') then
    raise exception 'This debit note is already approved. Cancel it first to approve it again.';
  end if;
  return approve_dn(p_invoice, p_type, current_date, p_round_to_rupee, auth.uid());
end $$;

create function cancel_debit_note(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A reason is required to cancel a debit note'; end if;
  update debit_notes set status = 'cancelled', cancel_reason = p_reason where id = p_id and status <> 'cancelled';
  if not found then raise exception 'This debit note is already cancelled'; end if;
  insert into audit_log (actor, table_name, row_id, action, detail)
  values (auth.uid(), 'debit_notes', p_id, 'cancelled', jsonb_build_object('reason', p_reason));
end $$;

create function set_dn_tally_no(p_id uuid, p_tally_no text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  if nullif(trim(p_tally_no), '') is null then raise exception 'Type the DN number Tally gave'; end if;
  update debit_notes set tally_dn_no = trim(p_tally_no), status = 'booked_in_tally'
   where id = p_id and status in ('approved', 'exported');
  if not found then raise exception 'Only an approved or exported debit note can be booked'; end if;
  insert into audit_log (actor, table_name, row_id, action, detail)
  values (auth.uid(), 'debit_notes', p_id, 'booked_in_tally', jsonb_build_object('tally_dn_no', trim(p_tally_no)));
end $$;

create function mark_dns_exported(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  update debit_notes set status = 'exported' where id = any(p_ids) and status = 'approved';
  get diagnostics n = row_count;
  insert into audit_log (actor, table_name, action, detail)
  values (auth.uid(), 'debit_notes', 'exported', jsonb_build_object('ids', p_ids, 'count', n));
  return n;
end $$;

revoke execute on function approve_debit_note(uuid, text, boolean), cancel_debit_note(uuid, text),
  set_dn_tally_no(uuid, text), mark_dns_exported(uuid[]) from public, anon;
grant execute on function approve_debit_note(uuid, text, boolean), cancel_debit_note(uuid, text),
  set_dn_tally_no(uuid, text), mark_dns_exported(uuid[]) to authenticated;

-- ---------- freeze weights and sorting while a DN stands ----------
create function lock_after_dn() returns trigger language plpgsql as $$
declare j jsonb; v_inv uuid;
begin
  j := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_inv := case tg_table_name
    when 'invoices' then (j->>'id')::uuid
    when 'invoice_lines' then (j->>'invoice_id')::uuid
    when 'receipt_lines' then (select invoice_id from receipts where id = (j->>'receipt_id')::uuid)
    when 'sorting_lines' then (select r.invoice_id from receipt_lines rl join receipts r on r.id = rl.receipt_id
                               where rl.id = (j->>'receipt_line_id')::uuid)
  end;
  if exists (select 1 from debit_notes where invoice_id = v_inv and status <> 'cancelled') then
    raise exception 'Debit notes for this invoice are approved, so its weights and sorting are frozen. Cancel those debit notes first to change them.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger lock_after_dn before insert or update or delete on invoice_lines for each row execute function lock_after_dn();
create trigger lock_after_dn before insert or update or delete on receipt_lines for each row execute function lock_after_dn();
create trigger lock_after_dn before insert or update or delete on sorting_lines for each row execute function lock_after_dn();
create trigger lock_after_dn before update on invoices for each row
  when (old.gst_rate is distinct from new.gst_rate) execute function lock_after_dn();

-- ---------- a deal closes only when the PRD says it is complete ----------
create function check_deal_close() returns trigger language plpgsql as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    if exists (select 1 from returns where deal_id = new.id and delivered_on is null) then
      raise exception 'Returned material has not reached the supplier yet. Enter the delivered date first.';
    end if;
    if exists (select 1 from invoices i where i.deal_id = new.id and
               i.total - coalesce((select sum(total) from debit_notes n where n.invoice_id = i.id and n.status <> 'cancelled'), 0)
                       - coalesce((select sum(amount) from deductions x where x.invoice_id = i.id), 0)
                       - coalesce((select sum(amount) from payments p where p.invoice_id = i.id), 0) <> 0) then
      raise exception 'This deal still has a balance to settle, so it cannot be closed.';
    end if;
  end if;
  return new;
end $$;
create trigger check_deal_close before update of status on deals for each row execute function check_deal_close();

-- ---------- audit every change to money and deal tables ----------
create function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb;
begin
  j := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into audit_log (actor, table_name, row_id, action, detail)
  values (auth.uid(), tg_table_name,
          case when (j->>'id') ~ '^[0-9a-f-]{36}$' then (j->>'id')::uuid end,
          lower(tg_op),
          case when tg_op = 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', j) else j end);
  return null;
end $$;
do $$ declare t text; begin
  foreach t in array array['suppliers','deals','deal_lines','invoices','invoice_lines','receipts','receipt_lines',
                           'sorting_lines','returns','payments','deductions','grades','sort_categories'] loop
    execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ================= views =================

-- Payables: same columns as before, plus deal, supplier and days overdue at the end.
create or replace view v_payable with (security_invoker = true) as
select d.deal_no, s.name as supplier, i.id as invoice_id, i.invoice_no, i.invoice_date, i.due_date,
       i.total as invoice_total,
       coalesce(dn.t, 0) as debit_notes,
       coalesce(de.t, 0) as deductions,
       coalesce(p.t, 0) as paid,
       i.total - coalesce(dn.t, 0) - coalesce(de.t, 0) - coalesce(p.t, 0) as balance,
       d.id as deal_id, s.id as supplier_id,
       case when i.due_date < current_date and i.total - coalesce(dn.t, 0) - coalesce(de.t, 0) - coalesce(p.t, 0) > 0
            then current_date - i.due_date else 0 end as days_overdue
from invoices i
join deals d on d.id = i.deal_id
join suppliers s on s.id = d.supplier_id
left join (select invoice_id, sum(total) t from debit_notes where status <> 'cancelled' group by 1) dn on dn.invoice_id = i.id
left join (select invoice_id, sum(amount) t from deductions group by 1) de on de.invoice_id = i.id
left join (select invoice_id, sum(amount) t from payments group by 1) p on p.invoice_id = i.id;

create view v_payable_by_supplier with (security_invoker = true) as
select supplier_id, supplier, count(*) as bills,
       sum(invoice_total) as invoice_total, sum(debit_notes) as debit_notes, sum(deductions) as deductions,
       sum(paid) as paid, sum(balance) as balance,
       coalesce(sum(balance) filter (where days_overdue > 0), 0) as overdue_balance,
       max(days_overdue) as max_days_overdue,
       min(due_date) filter (where balance > 0) as next_due
from v_payable group by supplier_id, supplier;

-- Supplier invoice arithmetic: lines vs taxable, GST vs rate, total vs parts.
create view v_invoice_check with (security_invoker = true) as
select i.id as invoice_id, i.deal_id,
       round(coalesce(sum(il.billed_net_kg * il.billed_rate), 0), 2) as lines_taxable,
       i.taxable_value - round(coalesce(sum(il.billed_net_kg * il.billed_rate), 0), 2) as taxable_gap,
       i.gst_amount - round(i.taxable_value * i.gst_rate / 100, 2) as gst_gap,
       i.total - (i.taxable_value + i.gst_amount) as total_gap
from invoices i left join invoice_lines il on il.invoice_id = i.id
group by i.id;

-- Waiting to be booked in Tally: DNs not yet booked, payments not yet entered.
create view v_tally_pending with (security_invoker = true) as
select 'debit_note'::text as kind, n.id, d.deal_no, s.name as party, n.dn_type as detail,
       n.tally_dn_no as ref, n.total as amount, n.status, n.dn_date as on_date
from debit_notes n join deals d on d.id = n.deal_id join suppliers s on s.id = d.supplier_id
where n.status in ('approved', 'exported')
union all
select 'payment', p.id, d.deal_no, s.name, p.kind, p.bank_ref, p.amount, 'not_in_tally', p.paid_on
from payments p join deals d on d.id = p.deal_id join suppliers s on s.id = d.supplier_id
where not p.in_tally;

-- Possible double payments: overpaid bills, a bank reference used twice, the same amount twice on one bill and day.
create view v_double_payment with (security_invoker = true) as
select 'overpaid'::text as issue, v.deal_no, v.supplier, v.invoice_no, null::text as bank_ref, -v.balance as amount
from v_payable v where v.balance < 0
union all
select 'same_bank_ref', min(d.deal_no), min(s.name), min(i.invoice_no), p.bank_ref, sum(p.amount)
from payments p join deals d on d.id = p.deal_id join suppliers s on s.id = d.supplier_id
left join invoices i on i.id = p.invoice_id
where nullif(trim(p.bank_ref), '') is not null group by p.bank_ref having count(*) > 1
union all
select 'same_amount_same_day', d.deal_no, s.name, i.invoice_no, null, p.amount
from payments p join deals d on d.id = p.deal_id join suppliers s on s.id = d.supplier_id
join invoices i on i.id = p.invoice_id
where p.paid_on is not null
group by d.deal_no, s.name, i.invoice_no, p.invoice_id, p.amount, p.paid_on having count(*) > 1;

do $$ declare t text; begin
  foreach t in array array['v_payable','v_payable_by_supplier','v_invoice_check','v_tally_pending','v_double_payment'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

create view v_payable_total with (security_invoker = true) as
select coalesce(sum(balance), 0) as balance, coalesce(sum(overdue_balance), 0) as overdue_balance, count(*) as suppliers
from v_payable_by_supplier;
revoke all on public.v_payable_total from anon;
grant select on public.v_payable_total to authenticated;
