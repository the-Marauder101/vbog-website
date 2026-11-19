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

create table tds (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id),
  payment_id uuid references payments(id),
  section text not null,
  rate numeric(6,3) not null check (rate > 0),
  base numeric(14,2) not null check (base > 0),
  amount numeric(14,2) generated always as (round(base * rate / 100, 2)) stored,
  deducted_on date not null,
  deposited_on date,
  challan_ref text,
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
