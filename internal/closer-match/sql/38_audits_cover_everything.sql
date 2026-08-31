-- ═══════════════════════════════════════════════════════════════════════════
-- 38 — the audits stop naming their tables
--
-- `v_rls_bypass_audit` and `v_c10_audit` both check a HARDCODED LIST of tables:
--
--     t.relname = any (array['candidate_profile','matches', … ])
--
-- Everything on those lists is genuinely covered. The problem is everything that
-- is not on them. sql/35 added five ASK tables carrying interviewer judgements
-- of named people — `ask_scorecards`, `ask_scores` and three bank tables — and
-- neither audit noticed they existed. They happen to be correct, because the
-- migration that created them enabled and forced RLS in a loop. Nothing was
-- checking, and nothing would have said so.
--
-- This is the test-side twin of a lesson already recorded twice in this file's
-- neighbours:
--
-- > **A test that names a row cannot outlive the row** (§7ad), and an audit that
-- > names its tables cannot outlive the schema.
--
-- So the rule is inverted. Instead of listing what must be protected, the audits
-- now cover EVERY table in `public` and require an explicit, reasoned exemption
-- to be excluded. A table added next year is protected by default and shows up
-- in the audit the moment it is created — which is the only version of this that
-- keeps working without somebody remembering to update it.
--
-- The old views are not dropped and re-created; they are replaced, and their
-- existing column names are kept, because the console reads them.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The exemption list, and it has to say why ─────────────────────────────
-- Modelled on `anon_callable`: an allowlist with a reason column, so that
-- exempting something is a decision somebody wrote down rather than a silent
-- absence from an array literal.
create table if not exists rls_exempt (
  table_name text primary key,
  why        text not null check (btrim(why) <> '')
);

insert into rls_exempt (table_name, why) values
  ('anon_callable',
   'The allowlist of anon-callable functions. Contains no personal data and no '
   'score — it is a list of function names. Staff-readable is harmless and the '
   'grant sweep in sql/31 already keeps anon off it.'),
  ('rls_exempt',
   'This table. It lists exemptions and their reasons; it holds nothing about '
   'anybody.'),
  ('dimension_params',
   'Thresholds and tuning constants. No personal data. Needs to be readable by '
   'the functions that compute with it.')
on conflict (table_name) do update set why = excluded.why;

alter table rls_exempt enable row level security;
alter table rls_exempt force row level security;
drop policy if exists staff_read on rls_exempt;
create policy staff_read on rls_exempt for select to authenticated using (is_staff());
revoke all on rls_exempt from anon;

-- `anon_callable` was the one real table in the schema with RLS off. It carries
-- nothing sensitive, which is why it was never noticed, and it is one line to
-- close rather than one line to explain forever.
alter table anon_callable enable row level security;
alter table anon_callable force row level security;
drop policy if exists staff_read on anon_callable;
create policy staff_read on anon_callable for select to authenticated using (is_staff());
revoke all on anon_callable from anon;
delete from rls_exempt where table_name = 'anon_callable';

-- ── Every table, not a list of them ──────────────────────────────────────
create or replace view v_rls_bypass_audit as
  -- A view that runs as its owner skips the RLS on its base tables entirely.
  select 'view runs as owner — base-table RLS is skipped'::text as problem,
         c.relname::text as object,
         ('alter view public.' || c.relname::text ||
          ' set (security_invoker = true)')::text as fix
  from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relkind = 'v'
    and coalesce((select option_value from pg_options_to_table(c.reloptions)
                  where option_name = 'security_invoker'), 'false') <> 'true'

  union all
  -- The publishable key is in the page source. Any grant to anon is a grant to
  -- the internet.
  select ('anon holds ' || g.privilege_type || ' — the publishable key is public')::text,
         g.table_name::text,
         ('revoke ' || g.privilege_type || ' on public.' || g.table_name || ' from anon')::text
  from information_schema.role_table_grants g
  where g.table_schema = 'public' and g.grantee = 'anon'

  union all
  -- EVERY table, minus the ones with a written reason. This is the arm that
  -- changed: it used to name nine tables and now it names none.
  select 'row security not enabled and forced'::text,
         t.relname::text,
         ('alter table public.' || t.relname::text ||
          ' enable row level security; alter table public.' || t.relname::text ||
          ' force row level security')::text
  from pg_class t join pg_namespace ns on ns.oid = t.relnamespace
  where ns.nspname = 'public' and t.relkind = 'r'
    and not (t.relrowsecurity and t.relforcerowsecurity)
    and not exists (select 1 from rls_exempt e where e.table_name = t.relname::text)

  union all
  -- RLS forced with no policy at all is default-deny, which is safe but almost
  -- always means somebody forgot the policy and the feature is quietly broken.
  select 'row security forced but no policy exists — nothing can read it'::text,
         t.relname::text,
         ('create policy staff_all on public.' || t.relname::text ||
          ' for all to authenticated using (is_staff()) with check (is_staff())')::text
  from pg_class t join pg_namespace ns on ns.oid = t.relnamespace
  where ns.nspname = 'public' and t.relkind = 'r'
    and t.relrowsecurity
    and not exists (select 1 from pg_policy p where p.polrelid = t.oid)
    and not exists (select 1 from rls_exempt e where e.table_name = t.relname::text);

alter view v_rls_bypass_audit set (security_invoker = true);

-- ── Every policy, not a list of tables ───────────────────────────────────
-- C10 is the rule that a score-bearing row is reachable only by staff. The old
-- view checked eight named tables; this checks every policy in the schema, and
-- accepts the three guards that actually exist: staff, the client's own row, and
-- a token-scoped candidate surface.
create or replace view v_c10_audit as
  select c.relname as table_name,
         p.polname as policy_name,
         p.polroles::regrole[] as roles,
         coalesce(pg_get_expr(p.polqual, p.polrelid), '(no USING clause)') as using_expr
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public'
    and not exists (select 1 from rls_exempt e where e.table_name = c.relname::text)
    -- A policy granted only to `anon` with no guard is the thing being looked
    -- for; a policy on `authenticated` still has to name who it trusts.
    and coalesce(pg_get_expr(p.polqual, p.polrelid), '') not like '%is_staff()%'
    and coalesce(pg_get_expr(p.polqual, p.polrelid), '') not like '%staff_role()%'
    and coalesce(pg_get_expr(p.polqual, p.polrelid), '') not like '%my_client_id()%';

alter view v_c10_audit set (security_invoker = true);

-- ── Prove the new arms actually catch something ──────────────────────────
-- An audit nobody has watched fire is an audit nobody knows is wired up. Each
-- arm is provoked inside a subtransaction and rolled back.
do $$
declare v_before int; v_after int; v_caught boolean;
begin
  select count(*) into v_before from v_rls_bypass_audit;
  if v_before <> 0 then
    raise exception 'v_rls_bypass_audit is not empty to begin with: %',
      (select string_agg(object || ' — ' || problem, '; ') from v_rls_bypass_audit);
  end if;

  -- Arm 3: a new table with no RLS must be reported without being listed anywhere.
  begin
    create table zz_audit_probe (id int);
    select count(*) into v_after from v_rls_bypass_audit;
    v_caught := v_after > v_before
                and exists (select 1 from v_rls_bypass_audit where object = 'zz_audit_probe');
    raise exception 'rollback_probe';
  exception when others then
    if sqlerrm <> 'rollback_probe' then raise; end if;
  end;
  if not v_caught then
    raise exception 'a brand new table with no RLS was NOT reported — the audit is '
                    'still only looking at tables somebody remembered to list';
  end if;

  -- Arm 4: RLS forced with no policy.
  begin
    create table zz_audit_probe2 (id int);
    alter table zz_audit_probe2 enable row level security;
    alter table zz_audit_probe2 force row level security;
    v_caught := exists (select 1 from v_rls_bypass_audit
                        where object = 'zz_audit_probe2' and problem like '%no policy%');
    raise exception 'rollback_probe';
  exception when others then
    if sqlerrm <> 'rollback_probe' then raise; end if;
  end;
  if not v_caught then
    raise exception 'a table locked with no policy was not reported';
  end if;

  raise notice 'sql/38: both new audit arms fire on a table nothing listed';
end $$;

-- ── And that the schema as it stands passes ──────────────────────────────
do $$
declare v int; v_ask int;
begin
  select count(*) into v from v_rls_bypass_audit;
  if v <> 0 then
    raise exception 'v_rls_bypass_audit: % problems — %', v,
      (select string_agg(object || ' — ' || problem, '; ') from v_rls_bypass_audit);
  end if;

  select count(*) into v from v_c10_audit;
  if v <> 0 then
    raise exception 'v_c10_audit: % unguarded policies — %', v,
      (select string_agg(table_name || '.' || policy_name, '; ') from v_c10_audit);
  end if;

  -- The specific thing that prompted this file: the ASK tables are now in scope.
  select count(*) into v_ask from pg_class t
  join pg_namespace ns on ns.oid = t.relnamespace
  where ns.nspname = 'public' and t.relkind = 'r' and t.relname::text like 'ask_%'
    and t.relrowsecurity and t.relforcerowsecurity;
  if v_ask < 5 then
    raise exception 'expected at least 5 ask_* tables with forced RLS, found %', v_ask;
  end if;

  raise notice 'sql/38: audits cover every table; % ask_* tables in scope', v_ask;
end $$;
