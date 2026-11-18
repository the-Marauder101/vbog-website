-- Rich Alloys purchase portal: complete database setup.
-- Paste this whole file into the Supabase SQL editor of a NEW, EMPTY project and run it once.
-- Generated from supabase/migrations by build_setup.sh. Do not edit by hand.

begin;

-- ######## migrations/0001_schema.sql ########
-- Rich Alloys purchase portal: schema v0 (Supabase / Postgres 15+)
-- One deal ID runs from phone deal to final payment. Purchase side only.
-- Tally stays the book of record: this system calculates, approves and exports.

-- Safety: refuse to run in a project that already has tables with these names.
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public'
             and table_name in ('profiles','deals','documents','suppliers','invoices')) then
    raise exception 'This Supabase project already has tables with these names. Run this in a new, empty project.';
  end if;
end $$;

-- ---------- masters ----------
create table plants (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table profiles (               -- id = auth.users.id in Supabase
  id uuid primary key,
  full_name text not null,
  role text not null check (role in ('owner','deal_desk','gate','factory','factory_accounts','ho_accounts','vbog_admin')),
  plant_id uuid references plants(id)
);

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gstin text unique,
  state text,
  kyc_status text not null default 'pending' check (kyc_status in ('pending','verified','blocked')),
  provisional_pct numeric(5,2),        -- e.g. 90; null until confirmed per supplier
  credit_days int,                     -- null until confirmed per supplier
  created_at timestamptz not null default now()
);

create table grades (
  code text primary key,               -- OC, LAL, ...
  name text not null
);

create table sort_categories (         -- what sorting can find inside a load
  code text primary key,
  name text not null,
  default_action text not null check (default_action in ('rate_diff','return'))
);

-- ---------- deal ----------
create table deals (
  id uuid primary key default gen_random_uuid(),
  deal_no text not null unique,        -- human ID shown everywhere
  supplier_id uuid not null references suppliers(id),
  plant_id uuid not null references plants(id),
  deal_date date not null,
  po_no text unique,
  po_date date,
  status text not null default 'booked' check (status in
    ('booked','po_issued','in_transit','received','sorted','dn_approved','settled','closed','cancelled')),
  notes text,
  created_by uuid references profiles(id),
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
  due_date date,
  unique (deal_id, invoice_no)
);

create table invoice_lines (           -- supplier's own figures, per grade
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  grade text not null references grades(code),
  billed_net_kg numeric(12,3) not null,
  billed_rate numeric(12,3) not null,
  slip_gross_kg numeric(12,3),         -- supplier packing slip
  slip_bag_kg numeric(12,3),
  unique (invoice_id, grade)
);

-- ---------- inward at factory ----------
create table receipts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id),
  invoice_id uuid references invoices(id),
  received_on date not null,
  vehicle_no text,
  entered_by uuid references profiles(id)
);

create table receipt_lines (           -- mirrors the notebook page, per grade
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references receipts(id) on delete cascade,
  grade text not null references grades(code),
  factory_gross_kg numeric(12,3) not null,
  bag_count int,
  factory_bag_kg numeric(12,3) not null default 0,
  factory_net_kg numeric(12,3) generated always as (factory_gross_kg - factory_bag_kg) stored,
  unique (receipt_id, grade)
);

create table sorting_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_line_id uuid not null references receipt_lines(id) on delete cascade,
  category text not null references sort_categories(code),
  sorted_kg numeric(12,3) not null check (sorted_kg > 0),
  action text not null check (action in ('rate_diff','return')),
  rate_cut numeric(12,3),              -- Rs/kg off, for rate_diff only
  dn_kg numeric(12,3) not null,        -- what is actually debited
  change_reason text,                  -- mandatory when dn_kg differs from sorted_kg
  check (action <> 'rate_diff' or rate_cut is not null),
  check (dn_kg = sorted_kg or nullif(trim(change_reason),'') is not null)
);

-- ---------- debit notes (snapshot on approval; Tally issues the number) ----------
create table debit_notes (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id),
  invoice_id uuid not null references invoices(id),
  dn_type text not null check (dn_type in ('weight_short','rate_diff','return')),
  dn_date date not null,
  taxable numeric(14,2) not null,
  gst_amount numeric(14,3) not null,
  round_off numeric(6,3) not null default 0,
  total numeric(14,2) not null,
  status text not null default 'approved' check (status in ('approved','exported','booked_in_tally','cancelled')),
  tally_dn_no text unique,
  approved_by uuid references profiles(id),
  approved_at timestamptz not null default now(),
  unique (invoice_id, dn_type)
);

create table debit_note_lines (
  id uuid primary key default gen_random_uuid(),
  debit_note_id uuid not null references debit_notes(id) on delete cascade,
  grade text not null,
  description text not null,
  qty_kg numeric(12,3) not null,
  rate numeric(12,3) not null,
  amount numeric(14,3) not null
);

-- ---------- returns, payments, deductions ----------
create table returns (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id),
  dispatched_on date,
  kg numeric(12,3) not null,
  packages int,
  eway_bill_no text,
  transporter text,
  lr_no text,
  freight numeric(12,2),
  freight_paid_by text check (freight_paid_by in ('rich_alloys','supplier')),
  freight_recovered boolean not null default false,
  delivered_on date
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id),
  invoice_id uuid references invoices(id),
  kind text not null check (kind in ('advance','provisional','final')),
  amount numeric(14,2) not null check (amount > 0),
  paid_on date,
  bank_ref text,
  in_tally boolean not null default false
);

create table deductions (              -- TDS etc. Entered, never assumed.
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id),
  kind text not null,                  -- e.g. 'tds'
  section text,
  amount numeric(14,2) not null,
  on_portal boolean not null default false   -- visible on IT portal yet?
);

-- ---------- documents ----------
create table doc_types (
  code text primary key,
  name text not null,
  name_hi text,                         -- Hindi label shown on the phone
  side text not null check (side in ('supplier','rich_alloys','return')),
  required boolean not null default true,
  sort int not null default 0
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id),
  doc_type text not null references doc_types(code),
  storage_path text not null,          -- Supabase Storage: deals/<deal_no>/<doc_type>/<file>
  status text not null default 'uploaded' check (status in ('uploaded','verified','approved','rejected')),
  note text,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz not null default now(),
  verified_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  check (status <> 'rejected' or nullif(trim(note),'') is not null)
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

-- ================= views (all maths lives here, nothing typed) =================

-- per grade: supplier vs factory weights, weight short, slip-vs-invoice check
create view v_inward with (security_invoker = true) as
select d.id as deal_id, d.deal_no, i.id as invoice_id, rl.id as receipt_line_id, rl.grade,
       dl.rate_per_kg as deal_rate, il.billed_rate,
       il.slip_gross_kg, il.slip_bag_kg, (il.slip_gross_kg - il.slip_bag_kg) as slip_net_kg,
       il.billed_net_kg,
       rl.factory_gross_kg, rl.bag_count, rl.factory_bag_kg, rl.factory_net_kg,
       (il.billed_net_kg - rl.factory_net_kg) as weight_short_kg,
       (il.billed_net_kg - (il.slip_gross_kg - il.slip_bag_kg)) as slip_vs_invoice_kg,
       (il.billed_rate - dl.rate_per_kg) as rate_vs_deal
from receipt_lines rl
join receipts r on r.id = rl.receipt_id
join deals d on d.id = r.deal_id
join invoices i on i.id = r.invoice_id
join invoice_lines il on il.invoice_id = i.id and il.grade = rl.grade
join deal_lines dl on dl.deal_id = d.id and dl.grade = rl.grade;

-- every DN line, calculated
create view v_dn_calc_lines with (security_invoker = true) as
select deal_id, invoice_id, 'weight_short'::text as dn_type, grade,
       'Weight short'::text as description, weight_short_kg as qty_kg, deal_rate as rate,
       weight_short_kg * deal_rate as amount
from v_inward where weight_short_kg > 0
union all
select v.deal_id, v.invoice_id, 'rate_diff', v.grade, c.name, s.dn_kg, s.rate_cut, s.dn_kg * s.rate_cut
from sorting_lines s join v_inward v on v.receipt_line_id = s.receipt_line_id
join sort_categories c on c.code = s.category
where s.action = 'rate_diff' and s.dn_kg > 0
union all
select v.deal_id, v.invoice_id, 'return', v.grade, c.name, s.dn_kg, v.deal_rate, s.dn_kg * v.deal_rate
from sorting_lines s join v_inward v on v.receipt_line_id = s.receipt_line_id
join sort_categories c on c.code = s.category
where s.action = 'return' and s.dn_kg > 0;

create view v_dn_calc with (security_invoker = true) as
select l.deal_id, l.invoice_id, l.dn_type,
       round(sum(l.amount), 2) as taxable,
       round(sum(l.amount) * i.gst_rate / 100, 3) as gst_amount,
       round(sum(l.amount) * (1 + i.gst_rate / 100), 2) as total_exact,
       round(sum(l.amount) * (1 + i.gst_rate / 100), 0) as total_rounded
from v_dn_calc_lines l join invoices i on i.id = l.invoice_id
group by l.deal_id, l.invoice_id, l.dn_type, i.gst_rate;

-- sorted kg that was not debited in full, and what that cost
create view v_sorting_exceptions with (security_invoker = true) as
select v.deal_no, v.grade, c.name as category, s.sorted_kg, s.dn_kg,
       (s.sorted_kg - s.dn_kg) as kg_not_debited,
       round((s.sorted_kg - s.dn_kg) * case when s.action = 'return' then v.deal_rate else s.rate_cut end
             * (1 + i.gst_rate / 100), 2) as value_not_recovered,
       s.change_reason
from sorting_lines s join v_inward v on v.receipt_line_id = s.receipt_line_id
join sort_categories c on c.code = s.category
join invoices i on i.id = v.invoice_id
where s.dn_kg <> s.sorted_kg;

-- bill-by-bill payable
create view v_payable with (security_invoker = true) as
select d.deal_no, s.name as supplier, i.id as invoice_id, i.invoice_no, i.invoice_date, i.due_date,
       i.total as invoice_total,
       coalesce(dn.t, 0) as debit_notes,
       coalesce(de.t, 0) as deductions,
       coalesce(p.t, 0) as paid,
       i.total - coalesce(dn.t, 0) - coalesce(de.t, 0) - coalesce(p.t, 0) as balance
from invoices i
join deals d on d.id = i.deal_id
join suppliers s on s.id = d.supplier_id
left join (select invoice_id, sum(total) t from debit_notes where status <> 'cancelled' group by 1) dn on dn.invoice_id = i.id
left join (select invoice_id, sum(amount) t from deductions group by 1) de on de.invoice_id = i.id
left join (select invoice_id, sum(amount) t from payments group by 1) p on p.invoice_id = i.id;

-- which required documents are missing or not yet approved, per deal
create view v_doc_gaps with (security_invoker = true) as
select d.deal_no, t.side, t.code, t.name,
       coalesce((select max(x.status) filter (where x.status <> 'rejected') from documents x
                 where x.deal_id = d.id and x.doc_type = t.code), 'missing') as state
from deals d cross join doc_types t
where t.required
  and (t.side <> 'return' or exists (select 1 from returns r where r.deal_id = d.id))
  and not exists (select 1 from documents x where x.deal_id = d.id and x.doc_type = t.code and x.status = 'approved');

-- one row per DN line for Niti's Tally entry / import
create view v_tally_dn_export with (security_invoker = true) as
select n.tally_dn_no, n.dn_date, n.dn_type, s.name as party, s.gstin as party_gstin,
       i.invoice_no as against_invoice, i.invoice_date,
       l.grade, l.description, l.qty_kg, l.rate, l.amount,
       n.taxable, n.gst_amount, n.round_off, n.total, n.status, d.deal_no
from debit_notes n
join debit_note_lines l on l.debit_note_id = n.id
join invoices i on i.id = n.invoice_id
join deals d on d.id = n.deal_id
join suppliers s on s.id = d.supplier_id;

-- ================= one-click DN approval =================
create function approve_dn(p_invoice uuid, p_type text, p_date date, p_round_to_rupee boolean, p_by uuid default null)
returns uuid language plpgsql as $$
declare c record; v_id uuid; v_total numeric;
begin
  select * into c from v_dn_calc where invoice_id = p_invoice and dn_type = p_type;
  if not found then raise exception 'Nothing to debit for % on this invoice', p_type; end if;
  v_total := case when p_round_to_rupee then c.total_rounded else c.total_exact end;
  insert into debit_notes (deal_id, invoice_id, dn_type, dn_date, taxable, gst_amount, round_off, total, approved_by)
  values (c.deal_id, p_invoice, p_type, p_date, c.taxable, c.gst_amount,
          v_total - (c.taxable + c.gst_amount), v_total, p_by)
  returning id into v_id;
  insert into debit_note_lines (debit_note_id, grade, description, qty_kg, rate, amount)
  select v_id, grade, description, qty_kg, rate, amount
  from v_dn_calc_lines where invoice_id = p_invoice and dn_type = p_type;
  insert into audit_log (actor, table_name, row_id, action) values (p_by, 'debit_notes', v_id, 'approved');
  return v_id;
end $$;

-- ================= lock everything by default =================
-- RLS on, no rules yet: only the service role can read or write until 0003 adds rules.
do $$ declare t text; begin
  foreach t in array array['plants','profiles','suppliers','grades','sort_categories','deals','deal_lines','invoices','invoice_lines','receipts','receipt_lines','sorting_lines','debit_notes','debit_note_lines','returns','payments','deductions','doc_types','documents','audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ######## migrations/0002_masters.sql ########
-- Masters needed in production: plant, grades, sorting categories, document checklist.
insert into plants (name) values ('Palghar');
insert into grades values ('OC','OC'), ('LAL','Lal');
insert into sort_categories values
  ('LEAD_COPPER','Lead copper','rate_diff'), ('DC','DC','rate_diff'), ('LOW_QUALITY','Low quality','rate_diff'),
  ('ATTACHMENT','Attachment','return'), ('MITTI','Mitti','return');

insert into doc_types (code, name, name_hi, side, sort) values
  ('PO','Purchase order','खरीद आदेश (PO)','supplier',1), ('TAX_INVOICE','Tax invoice','टैक्स इनवॉइस','supplier',2),
  ('E_INVOICE','E-invoice (IRN)','ई-इनवॉइस (IRN)','supplier',3), ('EWAY_BILL','E-way bill','ई-वे बिल','supplier',4),
  ('WEIGHBRIDGE_EXT','External weighbridge slip','बाहरी धर्मकांटा पर्ची','supplier',5), ('PACKING_SLIP','Packing slips by grade','ग्रेड अनुसार पैकिंग स्लिप','supplier',6),
  ('SEAL_PHOTOS','Seal photos with GPS','सील की फोटो (GPS सहित)','supplier',7), ('CONSIGNMENT_NOTE','Transporter consignment note / LR','ट्रांसपोर्टर बिल्टी (LR)','supplier',8),
  ('LOADING_PHOTOS','Loading photos with GPS','लोडिंग की फोटो (GPS सहित)','supplier',9), ('DRIVER_TRUCK_PHOTO','Driver with truck photo','ड्राइवर और ट्रक की फोटो','supplier',10),
  ('VAHAN_CHECK','Vahan vehicle check','वाहन पोर्टल जाँच','supplier',11), ('DRIVING_LICENCE','Driving licence front and back','ड्राइविंग लाइसेंस (आगे और पीछे)','supplier',12),
  -- Rich Alloys side: list still to be confirmed with Himanshu
  ('WEIGHBRIDGE_FACTORY','Factory weighbridge slip','फैक्ट्री धर्मकांटा पर्ची','rich_alloys',20), ('RECEIPT_PHOTOS','Receipt photos','माल प्राप्ति की फोटो','rich_alloys',21),
  ('SEAL_CUT_PHOTO','Seal-cutting photo','सील काटने की फोटो','rich_alloys',22), ('SORTING_REPORT','Sorting report','छँटाई रिपोर्ट','rich_alloys',23),
  ('RETURN_DN','Material return debit note','माल वापसी डेबिट नोट','return',30), ('RETURN_EWAY','Return e-way bill','वापसी ई-वे बिल','return',31),
  ('RETURN_CHIT','Handwritten return chit','हाथ से लिखी वापसी पर्ची','return',32), ('RETURN_LR','Transporter LR for return','वापसी की बिल्टी (LR)','return',33);


-- ######## migrations/0003_access.sql ########
-- Access rules for slice 1 (documents). Everything else stays service-role only
-- until its own slice ships.
-- Who may verify and who may approve is a PLACEHOLDER until Himanshu confirms.

create function my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() $$;

create function is_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid()) $$;

revoke execute on function approve_dn(uuid, text, date, boolean, uuid) from public, anon, authenticated;

revoke execute on function my_role(), is_staff() from public, anon;
grant execute on function my_role(), is_staff() to authenticated;

-- explicit grants: logged-in users only, never the anonymous key
do $$ declare t text; begin
  foreach t in array array['plants','profiles','suppliers','grades','sort_categories','deals','deal_lines','invoices','invoice_lines','receipts','receipt_lines','sorting_lines','debit_notes','debit_note_lines','returns','payments','deductions','doc_types','documents','audit_log'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    -- any logged-in staff member can read everything; writes need their own rule below
    execute format('create policy staff_read on public.%I for select to authenticated using (public.is_staff())', t);
  end loop;
  foreach t in array array['v_inward','v_dn_calc_lines','v_dn_calc','v_sorting_exceptions','v_payable','v_doc_gaps','v_tally_dn_export'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- deal desk: create and edit suppliers, deals and deal lines
create policy deal_desk_write on suppliers for all to authenticated
  using (my_role() in ('owner','deal_desk','ho_accounts','vbog_admin'))
  with check (my_role() in ('owner','deal_desk','ho_accounts','vbog_admin'));
create policy deal_desk_write on deals for all to authenticated
  using (my_role() in ('owner','deal_desk','ho_accounts','vbog_admin'))
  with check (my_role() in ('owner','deal_desk','ho_accounts','vbog_admin'));
create policy deal_desk_write on deal_lines for all to authenticated
  using (my_role() in ('owner','deal_desk','ho_accounts','vbog_admin'))
  with check (my_role() in ('owner','deal_desk','ho_accounts','vbog_admin'));

-- documents: any staff member can upload, always as themselves, always as 'uploaded'.
-- No update or delete policy: status only moves through the functions below.
create policy staff_upload on documents for insert to authenticated
  with check (is_staff() and uploaded_by = auth.uid() and status = 'uploaded'
              and verified_by is null and approved_by is null);

create function verify_document(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(my_role(),'') not in ('factory_accounts','ho_accounts','owner','vbog_admin') then
    raise exception 'Your role cannot verify documents';
  end if;
  update documents set status = 'verified', verified_by = auth.uid()
   where id = p_id and status = 'uploaded';
  if not found then raise exception 'Only an uploaded document can be verified'; end if;
  insert into audit_log (actor, table_name, row_id, action) values (auth.uid(), 'documents', p_id, 'verified');
end $$;

create function approve_document(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(my_role(),'') not in ('ho_accounts','owner','vbog_admin') then
    raise exception 'Your role cannot approve documents';
  end if;
  update documents set status = 'approved', approved_by = auth.uid()
   where id = p_id and status = 'verified';
  if not found then raise exception 'Only a verified document can be approved'; end if;
  insert into audit_log (actor, table_name, row_id, action) values (auth.uid(), 'documents', p_id, 'approved');
end $$;

create function reject_document(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(my_role(),'') not in ('factory_accounts','ho_accounts','owner','vbog_admin') then
    raise exception 'Your role cannot reject documents';
  end if;
  if nullif(trim(p_note), '') is null then raise exception 'A reason is required to reject'; end if;
  update documents set status = 'rejected', note = p_note
   where id = p_id and status in ('uploaded','verified');
  if not found then raise exception 'This document can no longer be rejected'; end if;
  insert into audit_log (actor, table_name, row_id, action, detail)
  values (auth.uid(), 'documents', p_id, 'rejected', jsonb_build_object('note', p_note));
end $$;

revoke execute on function verify_document(uuid), approve_document(uuid), reject_document(uuid, text) from public, anon;
grant execute on function verify_document(uuid), approve_document(uuid), reject_document(uuid, text) to authenticated;

-- ######## migrations/0004_storage.sql ########
-- Private bucket for deal documents: photos and PDFs up to 20 MB, read through short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('deal-docs', 'deal-docs', false, 20971520, array['image/*','application/pdf'])
on conflict (id) do nothing;

create policy deal_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'deal-docs' and public.is_staff());
create policy deal_docs_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'deal-docs' and public.is_staff());

-- ######## migrations/0005_staff.sql ########
-- Staff directory. `profiles` becomes the one readable list of who has access:
-- name, login email, role, plant, active, created. Open it in Supabase > Table Editor > profiles.
-- Passwords are never stored here or anywhere readable: Supabase keeps only a one-way hash.
-- Logins are created, reset and switched off from the app's Staff screen through the
-- `staff-admin` edge function (supabase/functions/staff-admin), which alone holds the service key.

alter table profiles
  add column email text unique,
  add column active boolean not null default true,
  add column created_at timestamptz not null default now();

update profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

-- A switched-off person reads nothing and can do nothing, even with a session still open.
create or replace function my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and active $$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and active) $$;

-- Must match MANAGERS in supabase/functions/staff-admin/index.ts and canManageStaff in web/src/types.ts.
-- Placeholder until Himanshu confirms who may add staff.
create or replace function can_manage_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(my_role() in ('owner','vbog_admin'), false) $$;

revoke execute on function can_manage_staff() from public, anon;
grant execute on function can_manage_staff() to authenticated;

commit;
