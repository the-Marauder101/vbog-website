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
