-- Rich Alloys purchase portal: complete database setup (v2).
-- Paste this whole file into the Supabase SQL editor of a NEW, EMPTY project and run it once.
-- A project that ran the v1 setup: run reset_v1.sql first.
-- Generated from supabase/migrations by build_setup.sh. Do not edit by hand.

begin;

-- ######## migrations/0001_tables.sql ########
-- Rich Alloys purchase portal v2: tables.
-- One deal (phone booking) -> one or more lots (each truck / invoice) -> sorting -> debit notes -> payment.
-- Tally stays the book of record; tally_marks records what has been entered in which Tally.

do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public'
             and table_name in ('profiles','deals','documents','suppliers','invoices','lots')) then
    raise exception 'This project already has Rich Alloys tables. For a v1 project run reset_v1.sql first; otherwise use a new, empty project.';
  end if;
end $$;

create sequence deal_seq;
create sequence lot_seq;

-- ---------- people and permissions ----------
create table plants (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table profiles (                 -- id = auth.users.id
  id uuid primary key,
  full_name text not null,
  role text not null check (role in ('owner','deal_desk','gate','factory','factory_accounts','ho_accounts','vbog_admin')),
  plant_id uuid references plants(id),
  active boolean not null default true
);

create table permissions (               -- which role may do which action; edited in Admin
  action text not null,
  role text not null,
  primary key (action, role)
);

-- ---------- masters (edited in Admin) ----------
create table items (                     -- stock items, as named in Tally
  code text primary key check (code ~ '^[A-Z0-9_]+$'),
  name text not null,
  name_hi text,
  kind text not null check (kind in ('raw','finished','byproduct','consumable')),
  active boolean not null default true,
  sort int not null default 0
);

create table grades (                    -- scrap grades; each belongs to one stock item
  code text primary key check (code ~ '^[A-Z0-9_]+$'),
  name text not null,
  name_hi text,
  stock_item text not null references items(code),
  active boolean not null default true,
  sort int not null default 0
);

create table sort_categories (           -- what sorting finds inside a lot
  code text primary key check (code ~ '^[A-Z0-9_]+$'),
  name text not null,
  name_hi text,
  default_action text not null check (default_action in ('rate_diff','return')),
  active boolean not null default true,
  sort int not null default 0
);

create table doc_types (
  code text primary key check (code ~ '^[A-Z0-9_]+$'),
  name text not null,
  name_hi text,
  side text not null check (side in ('supplier','rich_alloys','return')),
  required boolean not null default true,
  active boolean not null default true,
  sort int not null default 0
);

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gstin text unique,
  state text,
  kyc_status text not null default 'pending' check (kyc_status in ('pending','verified','blocked')),
  -- payment terms: share paid provisionally, days after invoice for it, days after invoice for the balance
  provisional_pct numeric(5,2) check (provisional_pct between 0 and 100),
  provisional_days int check (provisional_days >= 0),
  balance_days int check (balance_days >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- deal ----------
create table deals (
  id uuid primary key default gen_random_uuid(),
  deal_no text not null unique default ('D-' || lpad(nextval('deal_seq')::text, 4, '0')),
  supplier_id uuid not null references suppliers(id),
  plant_id uuid not null references plants(id),
  deal_date date not null default current_date,
  expected_date date,
  po_no text unique,
  po_date date,
  gst_rate numeric(5,2) not null default 18,
  provisional_pct numeric(5,2) check (provisional_pct between 0 and 100),   -- overrides supplier terms
  provisional_days int check (provisional_days >= 0),
  balance_days int check (balance_days >= 0),
  receiving_complete boolean not null default false,   -- no more material expected on this deal
  cancelled boolean not null default false,
  notes text,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table deal_lines (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  grade text not null references grades(code),
  qty_kg numeric(12,3) not null check (qty_kg > 0),
  rate_per_kg numeric(12,3) not null check (rate_per_kg > 0),
  unique (deal_id, grade)
);

-- ---------- supplier invoice ----------
create table invoices (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id),
  invoice_no text not null,
  invoice_date date not null,
  gst_rate numeric(5,2) not null,
  taxable_value numeric(14,2) not null,
  gst_amount numeric(14,2) not null,
  total numeric(14,2) not null,
  in_2b boolean not null default false,      -- shows in GSTR-2B
  gstr2b_period text,                        -- e.g. 2026-10
  unique (deal_id, invoice_no)
);

create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  grade text not null references grades(code),
  billed_net_kg numeric(12,3) not null check (billed_net_kg > 0),
  billed_rate numeric(12,3) not null check (billed_rate > 0),
  slip_gross_kg numeric(12,3),
  slip_bag_kg numeric(12,3),
  unique (invoice_id, grade)
);

-- ---------- lot: every inward truck ----------
create table lots (
  id uuid primary key default gen_random_uuid(),
  lot_no text not null unique default ('L-' || lpad(nextval('lot_seq')::text, 4, '0')),
  deal_id uuid not null references deals(id),
  invoice_id uuid unique references invoices(id),
  received_on date not null default current_date,
  vehicle_no text,
  provisional_pct numeric(5,2) check (provisional_pct between 0 and 100),   -- overrides deal and supplier terms
  provisional_days int check (provisional_days >= 0),
  balance_days int check (balance_days >= 0),
  sorting_closed_at timestamptz,
  sorting_closed_by uuid references profiles(id),
  entered_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table lot_lines (                 -- the notebook page, per grade
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references lots(id) on delete cascade,
  grade text not null references grades(code),
  factory_gross_kg numeric(12,3) not null check (factory_gross_kg > 0),
  bag_count int check (bag_count >= 0),
  factory_bag_kg numeric(12,3) not null default 0 check (factory_bag_kg >= 0),
  factory_net_kg numeric(12,3) generated always as (factory_gross_kg - factory_bag_kg) stored,
  unique (lot_id, grade)
);

create table sorting_lines (             -- entered over several days while the lot is sorted
  id uuid primary key default gen_random_uuid(),
  lot_line_id uuid not null references lot_lines(id) on delete cascade,
  sorted_on date not null default current_date,
  category text not null references sort_categories(code),
  sorted_kg numeric(12,3) not null check (sorted_kg > 0),
  action text not null check (action in ('rate_diff','return')),
  rate_cut numeric(12,3) check (rate_cut > 0),
  dn_kg numeric(12,3) not null check (dn_kg >= 0),
  change_reason text,
  entered_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (action <> 'rate_diff' or rate_cut is not null),
  check (dn_kg = sorted_kg or nullif(trim(change_reason), '') is not null)
);

-- ---------- debit notes (frozen on approval; the numbered note is issued from Tally) ----------
create table notes (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references lots(id),
  invoice_id uuid not null references invoices(id),
  dn_type text not null check (dn_type in ('weight_short','rate_diff','return')),
  note_date date not null,
  taxable numeric(14,2) not null,
  gst_amount numeric(14,3) not null,
  round_off numeric(8,3) not null default 0,
  total numeric(14,2) not null,
  status text not null default 'approved' check (status in ('approved','cancelled')),
  tally_no text,
  cancel_reason text,
  approved_by uuid references profiles(id),
  approved_at timestamptz not null default now()
);
create unique index notes_one_live_per_type on notes (lot_id, dn_type) where status <> 'cancelled';

create table note_lines (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references notes(id) on delete cascade,
  grade text not null,
  description text not null,
  qty_kg numeric(12,3) not null,
  rate numeric(12,3) not null,
  amount numeric(14,3) not null,
  stock_kg numeric(12,3) not null default 0     -- kg that leaves stock (weight short, return)
);

create table returns (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references lots(id),
  dispatched_on date not null default current_date,
  kg numeric(12,3) not null check (kg > 0),
  packages int,
  eway_bill_no text,
  transporter text,
  lr_no text,
  freight numeric(12,2),
  freight_paid_by text check (freight_paid_by in ('rich_alloys','supplier')),
  freight_recovered boolean not null default false,
  delivered_on date,
  entered_by uuid references profiles(id) default auth.uid()
);

-- ---------- money ----------
create table payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id),
  deal_id uuid references deals(id),
  invoice_id uuid references invoices(id),
  kind text not null default 'provisional' check (kind in ('advance','provisional','final','other')),
  amount numeric(14,2) not null check (amount > 0),
  paid_on date not null,
  mode text not null default 'neft' check (mode in ('neft','rtgs','imps','cheque','cash','other')),
  bank_ref text,
  status text not null default 'entered' check (status in ('entered','reconciled','rejected')),
  reject_note text,
  entered_by uuid references profiles(id) default auth.uid(),
  entered_at timestamptz not null default now(),
  reconciled_by uuid references profiles(id),
  reconciled_at timestamptz
);

create table tds (                         -- TDS deducted from a bill; books stay in office Tally
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id),
  payment_id uuid references payments(id) on delete set null,
  section text,
  amount numeric(14,2) not null check (amount > 0),
  deducted_on date not null default current_date,
  entered_by uuid references profiles(id) default auth.uid()
);

create table ledger_confirmations (       -- supplier's ledger checked against the portal
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id),
  as_of date not null,
  supplier_balance numeric(14,2) not null,
  portal_balance numeric(14,2) not null,
  difference numeric(14,2) generated always as (supplier_balance - portal_balance) stored,
  note text,
  confirmed_by uuid references profiles(id),
  confirmed_at timestamptz not null default now()
);

create table tally_marks (                -- "entered in Tally" ticks; two Tallys: factory and office
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('invoice','note','payment','tds','production')),
  entity_id uuid not null,
  book text not null check (book in ('factory','office')),
  voucher_ref text,
  amount_at_mark numeric(16,3),            -- what it was when ticked; a later change means Tally needs correcting
  marked_by uuid references profiles(id),
  marked_at timestamptz not null default now(),
  unique (entity, entity_id, book)
);

-- ---------- production and stock ----------
create table production_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null default current_date,
  plant_id uuid references plants(id),
  notes text,
  entered_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table production_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references production_runs(id) on delete cascade,
  item text not null references items(code),
  direction text not null check (direction in ('consumed','produced')),
  kg numeric(14,3) not null check (kg > 0)
);

create table stock_moves (                -- manual stock entries; kg is signed
  id uuid primary key default gen_random_uuid(),
  move_date date not null default current_date,
  item text not null references items(code),
  kind text not null check (kind in ('opening','purchase_other','dispatch','adjustment')),
  kg numeric(14,3) not null check (kg <> 0),
  reason text,
  entered_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (kind not in ('opening','purchase_other') or kg > 0),
  check (kind <> 'dispatch' or kg < 0),
  check (kind <> 'adjustment' or nullif(trim(reason), '') is not null)
);

create table stock_tally_checks (         -- closing stock as shown in Tally, to compare
  id uuid primary key default gen_random_uuid(),
  item text not null references items(code),
  as_of date not null,
  tally_closing_kg numeric(14,3) not null,
  entered_by uuid references profiles(id) default auth.uid(),
  unique (item, as_of)
);

-- ---------- documents ----------
create table documents (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id),
  lot_id uuid references lots(id),          -- set when the file belongs to one truck (e.g. its invoice)
  doc_type text not null references doc_types(code),
  storage_path text not null,
  status text not null default 'uploaded' check (status in ('uploaded','verified','approved','rejected')),
  note text,
  uploaded_by uuid references profiles(id) default auth.uid(),
  uploaded_at timestamptz not null default now(),
  verified_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  check (status <> 'rejected' or nullif(trim(note), '') is not null)
);

create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  table_name text not null,
  row_id uuid,
  action text not null,
  detail jsonb
);

-- ######## migrations/0002_logic.sql ########
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

-- ######## migrations/0003_access.sql ########
-- Rich Alloys purchase portal v2: access.
-- The anonymous key reads nothing. Logged-in staff read; writes follow the permissions table.
-- Money tables (payments, TDS, ledger confirmations) are readable only with 'money_view'.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from public, anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- reads
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public'
           and tablename not in ('payments','tds','ledger_confirmations','audit_log') loop
    execute format('create policy staff_read on public.%I for select to authenticated using (public.is_staff())', t);
  end loop;
  foreach t in array array['payments','tds','ledger_confirmations'] loop
    execute format('create policy money_read on public.%I for select to authenticated using (public.can(''money_view''))', t);
  end loop;
end $$;
create policy admin_read on audit_log for select to authenticated using (public.can('admin'));

-- writes: table -> action needed
do $$ declare r record; begin
  for r in select * from (values
      ('suppliers','deal_edit'), ('deals','deal_edit'), ('deal_lines','deal_edit'),
      ('invoices','inward_edit'), ('invoice_lines','inward_edit'), ('lots','inward_edit'), ('lot_lines','inward_edit'),
      ('returns','inward_edit'), ('sorting_lines','sorting_edit'),
      ('payments','payment_enter'), ('tds','tax_edit'),
      ('production_runs','production_edit'), ('production_lines','production_edit'),
      ('stock_moves','stock_edit'), ('stock_tally_checks','stock_edit'),
      ('items','admin'), ('grades','admin'), ('sort_categories','admin'), ('doc_types','admin'),
      ('plants','admin'), ('permissions','admin'), ('profiles','admin')
    ) as x(tbl, act) loop
    execute format('create policy can_insert on public.%I for insert to authenticated with check (public.can(%L))', r.tbl, r.act);
    execute format('create policy can_update on public.%I for update to authenticated using (public.can(%L)) with check (public.can(%L))', r.tbl, r.act, r.act);
    execute format('create policy can_delete on public.%I for delete to authenticated using (public.can(%L))', r.tbl, r.act);
  end loop;
end $$;
-- admins can also fix supplier terms
create policy admin_update on suppliers for update to authenticated using (public.can('admin')) with check (public.can('admin'));
-- payment terms on a lot can be set by whoever can set deal terms
create policy terms_update on lots for update to authenticated using (public.can('deal_edit')) with check (public.can('deal_edit'));

-- documents: any staff member uploads, as themselves, as 'uploaded'. Status moves only through functions.
create policy staff_upload on documents for insert to authenticated
  with check (public.is_staff() and uploaded_by = auth.uid() and status = 'uploaded'
              and verified_by is null and approved_by is null);

-- notes, note_lines, tally_marks, ledger_confirmations, audit_log: no write rules; functions only.

-- ######## migrations/0004_storage.sql ########
-- Private bucket for deal documents: photos and PDFs up to 20 MB, read through short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('deal-docs', 'deal-docs', false, 20971520, array['image/*','application/pdf'])
on conflict (id) do nothing;

drop policy if exists deal_docs_read on storage.objects;
drop policy if exists deal_docs_upload on storage.objects;
create policy deal_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'deal-docs' and public.is_staff());
create policy deal_docs_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'deal-docs' and public.is_staff());

-- ######## migrations/0005_masters.sql ########
-- Starting master data. All of it can be changed in Admin.
insert into plants (name) values ('Palghar');

insert into items (code, name, name_hi, kind, sort) values
  ('COPPER_SCRAP','Copper scrap','कॉपर स्क्रैप','raw',1),
  ('PHOS_COPPER','Phosphorus copper','फॉस्फोरस कॉपर','raw',2),
  ('COPPER_INGOT','Copper ingot','कॉपर इंगट','finished',3),
  ('COPPER_GROSS_SLAG','Copper gross and slag','कॉपर ग्रॉस और स्लैग','byproduct',4);

insert into grades (code, name, name_hi, stock_item, sort) values
  ('OC','OC','ओसी','COPPER_SCRAP',1),
  ('LAL','Lal','लाल','COPPER_SCRAP',2);

-- From DNs 114-116 and the factory calls. Default actions for IRON, DHAAGI, KACHRA, RETI to be confirmed.
insert into sort_categories (code, name, name_hi, default_action, sort) values
  ('LEAD_COPPER','Lead copper','लेड कॉपर','rate_diff',1),
  ('DC','DC','डीसी','rate_diff',2),
  ('LOW_QUALITY','Low quality','हल्का माल','rate_diff',3),
  ('ATTACHMENT','Attachment','अटैचमेंट','return',4),
  ('MITTI','Mitti','मिट्टी','return',5),
  ('IRON','Iron','लोहा','return',6),
  ('DHAAGI','Dhaagi','धागी','return',7),
  ('KACHRA','Kachra','कचरा','return',8),
  ('RETI','Reti','रेती','return',9);

insert into doc_types (code, name, name_hi, side, sort) values
  ('PO','Purchase order','खरीद आदेश (PO)','supplier',1),
  ('TAX_INVOICE','Tax invoice','टैक्स इनवॉइस','supplier',2),
  ('E_INVOICE','E-invoice (IRN)','ई-इनवॉइस (IRN)','supplier',3),
  ('EWAY_BILL','E-way bill','ई-वे बिल','supplier',4),
  ('WEIGHBRIDGE_EXT','External weighbridge slip','बाहरी धर्मकांटा पर्ची','supplier',5),
  ('PACKING_SLIP','Packing slips by grade','ग्रेड अनुसार पैकिंग स्लिप','supplier',6),
  ('SEAL_PHOTOS','Seal photos with GPS','सील की फोटो (GPS सहित)','supplier',7),
  ('CONSIGNMENT_NOTE','Transporter consignment note / LR','ट्रांसपोर्टर बिल्टी (LR)','supplier',8),
  ('LOADING_PHOTOS','Loading photos with GPS','लोडिंग की फोटो (GPS सहित)','supplier',9),
  ('DRIVER_TRUCK_PHOTO','Driver with truck photo','ड्राइवर और ट्रक की फोटो','supplier',10),
  ('VAHAN_CHECK','Vahan vehicle check','वाहन पोर्टल जाँच','supplier',11),
  ('DRIVING_LICENCE','Driving licence front and back','ड्राइविंग लाइसेंस (आगे और पीछे)','supplier',12),
  ('WEIGHBRIDGE_FACTORY','Factory weighbridge slip','फैक्ट्री धर्मकांटा पर्ची','rich_alloys',20),
  ('RECEIPT_PHOTOS','Receipt photos','माल प्राप्ति की फोटो','rich_alloys',21),
  ('SEAL_CUT_PHOTO','Seal-cutting photo','सील काटने की फोटो','rich_alloys',22),
  ('SORTING_REPORT','Sorting report','छँटाई रिपोर्ट','rich_alloys',23),
  ('RETURN_DN','Material return debit note','माल वापसी डेबिट नोट','return',30),
  ('RETURN_EWAY','Return e-way bill','वापसी ई-वे बिल','return',31),
  ('RETURN_CHIT','Handwritten return chit','हाथ से लिखी वापसी पर्ची','return',32),
  ('RETURN_LR','Transporter LR for return','वापसी की बिल्टी (LR)','return',33);

-- Who does what. Changeable in Admin > Permissions.
insert into permissions (action, role)
select a, r from (values
  ('admin',             '{owner,vbog_admin}'),
  ('money_view',        '{owner,vbog_admin,deal_desk,factory_accounts,ho_accounts}'),
  ('deal_edit',         '{owner,vbog_admin,deal_desk,factory_accounts,ho_accounts}'),
  ('inward_edit',       '{owner,vbog_admin,factory,factory_accounts}'),
  ('sorting_edit',      '{owner,vbog_admin,factory,factory_accounts}'),
  ('lot_close',         '{owner,vbog_admin,factory,factory_accounts}'),
  ('doc_verify',        '{owner,vbog_admin,factory_accounts}'),
  ('doc_approve',       '{owner,vbog_admin}'),
  ('dn_approve',        '{owner,vbog_admin,factory_accounts}'),
  ('payment_enter',     '{owner,vbog_admin,factory_accounts,ho_accounts}'),
  ('payment_reconcile', '{vbog_admin,ho_accounts}'),
  ('tax_edit',          '{owner,vbog_admin,factory_accounts,ho_accounts}'),
  ('ledger_confirm',    '{vbog_admin,ho_accounts}'),
  ('tally_factory',     '{vbog_admin,factory_accounts}'),
  ('tally_office',      '{vbog_admin,ho_accounts}'),
  ('production_edit',   '{owner,vbog_admin,factory,factory_accounts}'),
  ('stock_edit',        '{owner,vbog_admin,factory_accounts}')
) x(a, roles), unnest(roles::text[]) r;

-- ######## migrations/0006_gstr2b.sql ########
-- OPTIONAL, OFF BY DEFAULT: only works for roles given the 'gst_2b' permission in Admin.
-- GSTR-2B: Niti downloads the month's 2B JSON from the GST portal and uploads it here.
-- Each B2B invoice is matched to a purchase invoice by supplier GSTIN + invoice number (ignoring spaces,
-- slashes and dashes). Matches tick "seen in 2B" automatically; differences and gaps are listed.

create table gstr2b_imports (
  id uuid primary key default gen_random_uuid(),
  period text not null unique check (period ~ '^\d{4}-\d{2}$'),   -- YYYY-MM; a re-upload replaces the month
  file_name text,
  uploaded_by uuid references profiles(id) default auth.uid(),
  uploaded_at timestamptz not null default now()
);

create table gstr2b_lines (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references gstr2b_imports(id) on delete cascade,
  period text not null,
  section text not null check (section in ('b2b','cdnr','other')),
  supplier_gstin text not null,
  supplier_name text,
  doc_type text not null check (doc_type in ('invoice','credit_note','debit_note')),
  doc_no text not null,
  doc_no_norm text not null,
  doc_date date,
  taxable numeric(14,2),
  tax numeric(14,2),
  total numeric(14,2),
  itc_available boolean,
  matched_invoice_id uuid references invoices(id)
);
create index gstr2b_lines_match on gstr2b_lines (supplier_gstin, doc_no_norm);

create function doc_norm(p text) returns text language sql immutable as
$$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

-- p = { period: 'YYYY-MM', file_name, lines: [{section, supplier_gstin, supplier_name, doc_type, doc_no, doc_date, taxable, tax, total, itc_available}] }
create function import_gstr2b(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_imp uuid; v_period text := p->>'period'; v_matched int; v_lines int;
begin
  perform require('gst_2b');
  if v_period !~ '^\d{4}-\d{2}$' then raise exception 'Could not read the return period from the file.'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]')) = 0 then raise exception 'No invoices found in the file.'; end if;
  perform set_config('ra.via_fn', 'on', true);
  -- replacing a month: clear the ticks it set before
  update invoices set in_2b = false, gstr2b_period = null
  where gstr2b_period = v_period and id in (select l.matched_invoice_id from gstr2b_lines l where l.period = v_period);
  delete from gstr2b_imports where period = v_period;
  insert into gstr2b_imports (period, file_name) values (v_period, p->>'file_name') returning id into v_imp;
  insert into gstr2b_lines (import_id, period, section, supplier_gstin, supplier_name, doc_type, doc_no, doc_no_norm,
                            doc_date, taxable, tax, total, itc_available)
  select v_imp, v_period, coalesce(x->>'section', 'b2b'), upper(trim(x->>'supplier_gstin')), x->>'supplier_name',
         coalesce(x->>'doc_type', 'invoice'), x->>'doc_no', doc_norm(x->>'doc_no'),
         nullif(x->>'doc_date', '')::date, nullif(x->>'taxable', '')::numeric, nullif(x->>'tax', '')::numeric,
         nullif(x->>'total', '')::numeric, nullif(x->>'itc_available', '')::boolean
  from jsonb_array_elements(p->'lines') x
  where nullif(trim(x->>'supplier_gstin'), '') is not null and nullif(trim(x->>'doc_no'), '') is not null;
  get diagnostics v_lines = row_count;
  update gstr2b_lines l set matched_invoice_id = i.id
  from invoices i join deals d on d.id = i.deal_id join suppliers s on s.id = d.supplier_id
  where l.import_id = v_imp and l.doc_type = 'invoice'
    and upper(s.gstin) = l.supplier_gstin and doc_norm(i.invoice_no) = l.doc_no_norm;
  update invoices i set in_2b = true, gstr2b_period = v_period
  from gstr2b_lines l where l.import_id = v_imp and l.matched_invoice_id = i.id;
  select count(*) into v_matched from gstr2b_lines where import_id = v_imp and matched_invoice_id is not null;
  perform set_config('ra.via_fn', 'off', true);
  return jsonb_build_object('lines', v_lines, 'matched', v_matched);
end $$;

-- one row per 2B line and per portal invoice still missing from 2B
create view v_gstr2b_recon with (security_invoker = true) as
select l.period, 'matched'::text as status, l.supplier_gstin, coalesce(s.name, l.supplier_name) as supplier,
       l.doc_no, l.doc_date, l.total as gstr2b_total, i.total as portal_total, l.tax as gstr2b_tax, i.gst_amount as portal_tax,
       coalesce(l.total, 0) - coalesce(i.total, 0) as difference, l.itc_available, i.id as invoice_id, lt.id as lot_id
from gstr2b_lines l
join invoices i on i.id = l.matched_invoice_id
join deals d on d.id = i.deal_id join suppliers s on s.id = d.supplier_id
left join lots lt on lt.invoice_id = i.id
union all
select l.period, case when l.doc_type = 'invoice' then 'not_in_portal' else l.doc_type end, l.supplier_gstin, l.supplier_name,
       l.doc_no, l.doc_date, l.total, null, l.tax, null, null, l.itc_available, null, null
from gstr2b_lines l where l.matched_invoice_id is null
union all
select null, 'not_in_2b', s.gstin, s.name, i.invoice_no, i.invoice_date, null, i.total, null, i.gst_amount, null, null, i.id, lt.id
from invoices i join deals d on d.id = i.deal_id join suppliers s on s.id = d.supplier_id
left join lots lt on lt.invoice_id = i.id
where not i.in_2b and not d.cancelled;

alter table gstr2b_imports enable row level security;
alter table gstr2b_lines enable row level security;
revoke all on gstr2b_imports, gstr2b_lines, v_gstr2b_recon from anon;
grant select on gstr2b_imports, gstr2b_lines, v_gstr2b_recon to authenticated;
create policy money_read on gstr2b_imports for select to authenticated using (public.can('money_view'));
create policy money_read on gstr2b_lines for select to authenticated using (public.can('money_view'));
revoke execute on function import_gstr2b(jsonb), doc_norm(text) from public, anon;
grant execute on function import_gstr2b(jsonb), doc_norm(text) to authenticated;

-- ######## migrations/0007_staff_and_uploads.sql ########
-- Staff management from the app, and safe upload retries.
--
-- Staff: profiles becomes the readable staff list (Supabase > Table Editor > profiles): name, login email,
-- role, active, created. Logins are created, reset and switched off from Admin > Staff through the
-- `staff-admin` edge function (supabase/functions/staff-admin), the only code holding the service key.
-- It checks the caller has 'staff_manage'. Passwords are never readable: Supabase keeps a one-way hash.
-- Only admins set or reset passwords; staff cannot change their own (decision 19).
alter table profiles
  add column email text unique,
  add column created_at timestamptz not null default now();
update profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

insert into permissions (action, role) values ('staff_manage', 'owner'), ('staff_manage', 'vbog_admin')
on conflict do nothing;

-- Uploads retry on patchy networks. One stored file = one document row, so a retry whose first attempt
-- actually succeeded is recognised (the app treats this violation as "already done").
create unique index documents_storage_path_key on documents (storage_path);

-- ######## migrations/0008_stock_7a.sql ########
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

-- ######## migrations/0009_supplier_types.sql ########
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

-- ######## migrations/0010_stock_statement.sql ########
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

-- ######## migrations/0011_unbooked_arrivals.sql ########
-- Bookings and trucks that arrive without one.
-- Himanshu books a supply (deal: rate, quantity, expected arrival); the team logs trucks against it.
-- A domestic truck that arrives with no booking is still recorded and tallied in full: lot, tax invoice, debit notes,
-- payable, cash plan, ledger, both Tally queues and stock. Its deal is marked unbooked and its rate is taken from the
-- invoice until someone with 'rate_confirm' (owner, vbog_admin) confirms it, correcting it first if the phone deal differs.
-- A booked supply past its expected arrival date shows as late.

alter table deals
  add column unbooked boolean not null default false,
  add column rate_confirmed_at timestamptz,
  add column rate_confirmed_by uuid references profiles(id);

insert into permissions (action, role) values ('rate_confirm', 'owner'), ('rate_confirm', 'vbog_admin')
on conflict do nothing;

-- One step for a truck that came without a booking: supplier (existing or new), deal from the invoice, lot.
create function create_unbooked_lot(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sup uuid; v_type text; v_deal uuid; v_plant uuid; v_line jsonb;
begin
  perform require('inward_edit');
  if jsonb_array_length(coalesce(p->'lines', '[]')) = 0 then raise exception 'Add at least one grade.'; end if;
  v_sup := nullif(p->>'supplier_id', '')::uuid;
  if v_sup is null then
    if nullif(trim(p->>'supplier_name'), '') is null then raise exception 'Choose or add the supplier.'; end if;
    insert into suppliers (name, gstin, state, supplier_type)
    values (trim(p->>'supplier_name'), nullif(upper(trim(p->>'supplier_gstin')), ''), nullif(trim(p->>'supplier_state'), ''), 'domestic')
    returning id into v_sup;
  end if;
  select supplier_type into v_type from suppliers where id = v_sup and active;
  if v_type is null then raise exception 'Supplier not found.'; end if;
  if v_type <> 'domestic' then raise exception 'Material from the branch, an import seller or a job worker is recorded with its own form.'; end if;
  v_plant := coalesce((select plant_id from profiles where id = auth.uid()), (select id from plants order by name limit 1));
  insert into deals (supplier_id, plant_id, deal_date, gst_rate, receiving_complete, unbooked, notes)
  values (v_sup, v_plant, coalesce(nullif(p->>'received_on', '')::date, current_date),
          coalesce(nullif(p->>'gst_rate', '')::numeric, 18), true, true, 'Arrived without a booking; rate from the invoice')
  returning id into v_deal;
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    insert into deal_lines (deal_id, grade, qty_kg, rate_per_kg)
    values (v_deal, v_line->>'grade', (v_line->>'billed_net_kg')::numeric, (v_line->>'billed_rate')::numeric);
  end loop;
  return create_lot(p || jsonb_build_object('deal_id', v_deal));
end $$;

-- Himanshu confirms the rate of an unbooked truck, correcting it first if the phone deal was different.
-- p_rates: {"OC": 1234, "LAL": 1319} (optional). A corrected rate drives the debit notes, and the invoice rate
-- then shows as different from the deal on the lot, as for any booked deal.
create function confirm_deal_rate(p_deal uuid, p_rates jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v numeric;
begin
  perform require('rate_confirm');
  if not exists (select 1 from deals where id = p_deal and unbooked and not cancelled) then
    raise exception 'Only a truck that arrived without a booking needs its rate confirmed.';
  end if;
  if p_rates is not null and jsonb_typeof(p_rates) = 'object' then
    for k, v in select key, value::numeric from jsonb_each_text(p_rates) loop
      if v <= 0 then raise exception 'Enter the agreed rate for %.', k; end if;
      if exists (select 1 from deal_lines where deal_id = p_deal and grade = k and rate_per_kg <> v)
         and exists (select 1 from notes n join lots l on l.id = n.lot_id where l.deal_id = p_deal and n.status <> 'cancelled') then
        raise exception 'Debit notes are approved for this truck. Cancel them before changing the rate.';
      end if;
      update deal_lines set rate_per_kg = v where deal_id = p_deal and grade = k;
    end loop;
  end if;
  update deals set rate_confirmed_at = now(), rate_confirmed_by = auth.uid() where id = p_deal;
  insert into audit_log (actor, table_name, row_id, action, detail)
  values (auth.uid(), 'deals', p_deal, 'rate_confirmed', coalesce(p_rates, '{}'::jsonb));
end $$;

revoke execute on function create_unbooked_lot(jsonb), confirm_deal_rate(uuid, jsonb) from public, anon;
grant execute on function create_unbooked_lot(jsonb), confirm_deal_rate(uuid, jsonb) to authenticated;

-- deals on the way: the same columns, plus how many days late
create or replace view v_deals_incoming with (security_invoker = true) as
select d.id as deal_id, d.deal_no, d.po_no, s.id as supplier_id, s.name as supplier, d.deal_date, d.expected_date, d.gst_rate,
       sum(dl.qty_kg) as ordered_kg,
       sum(least(coalesce(r.kg, 0), dl.qty_kg)) as received_kg,
       sum(greatest(dl.qty_kg - coalesce(r.kg, 0), 0)) as remaining_kg,
       round(sum(greatest(dl.qty_kg - coalesce(r.kg, 0), 0) * dl.rate_per_kg) * (1 + d.gst_rate / 100), 2) as remaining_value,
       (select count(*) from lots l where l.deal_id = d.id) as lots,
       case when d.expected_date < current_date then current_date - d.expected_date else 0 end as days_late
from deals d
join suppliers s on s.id = d.supplier_id
join deal_lines dl on dl.deal_id = d.id
left join (select l.deal_id, il.grade, sum(il.billed_net_kg) as kg
           from lots l join invoice_lines il on il.invoice_id = l.invoice_id group by 1, 2) r
       on r.deal_id = d.id and r.grade = dl.grade
where not d.cancelled and not d.receiving_complete
group by d.id, s.id;

-- lots: the same columns, plus whether the truck came without a booking and whether its rate is confirmed
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
       s.supplier_type, i.doc_kind, l.sent_by,
       d.unbooked, d.rate_confirmed_at
from lots l
join deals d on d.id = l.deal_id
join suppliers s on s.id = d.supplier_id
left join invoices i on i.id = l.invoice_id
left join v_payable p on p.invoice_id = l.invoice_id
where not d.cancelled;

-- to-do lists: as before, plus rates to confirm and late supplies
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
) t
where public.can(t.action);

-- ######## migrations/0012_prices.sql ########
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

commit;
