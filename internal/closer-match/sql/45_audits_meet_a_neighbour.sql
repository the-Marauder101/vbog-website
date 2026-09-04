-- ═══════════════════════════════════════════════════════════════════════════
-- 45 — the audits meet a system that is not Nikash
--
-- `v_c10_audit` went from 0 rows to 65 between one test run and the next, and
-- nothing in the Nikash tree had changed. **A sibling project shares this Supabase
-- project.** Pravah — `Get Closers/pravah/` in this same repository, built in
-- parallel by other sessions — has thirty-four `pravah_*` tables, its own
-- membership model, and policies of its own on `requirements`, `candidates`,
-- `placements` and `clients`, which are Nikash's tables.
--
-- Nothing here touches any of it. Nikash's migrations have no business editing
-- another project's RLS, and this file is about the audit, which was wrong in a
-- way worth fixing properly rather than by adding a name to a list.
--
-- ── WHAT THE AUDIT WAS ACTUALLY ASKING ────────────────────────────────────
--
-- sql/38 made C10 cover every policy in the schema, and recognised a guard by
-- looking for three literal strings: `is_staff()`, `staff_role()`,
-- `my_client_id()`. Pravah guards with `pravah_is_internal()` — which checks a
-- membership row against `auth.uid()` and is a perfectly good guard — so 63 of
-- the 65 rows were the audit failing to recognise a stranger, not a hole.
--
-- Hardcoding `pravah_is_internal` would fix today and break the next time
-- somebody adds a system. The audit's real question was never "does this call one
-- of three functions I know". It is:
--
-- > **Does this policy depend on WHO IS ASKING?**
--
-- A policy that reaches `auth.uid()` — directly, or through a function that does
-- — is scoped to a person. A policy that does not is open to every holder of the
-- key, whoever wrote it and whatever they called it. So the check now resolves
-- the functions a policy calls and asks whether any of them reads `auth.uid()`.
-- It recognises Nikash's guards, Pravah's guard, and one nobody has written yet,
-- for the same reason.
--
-- ── WHAT SURVIVES THE BETTER CHECK ────────────────────────────────────────
--
-- Two policies and one table, all Pravah's, all reported rather than fixed —
-- they are not this repository's to change, and silently patching another team's
-- RLS from a migration they cannot see would be worse than the finding:
--
--   · `pravah_revenue_stages_portal_read`  USING (true) — every authenticated
--     user can read it, whoever they are. Reported here and raised with whoever
--     owns that tree; not changed from a Nikash migration.
--   · `pravah_integration_events`  RLS forced with no policy at all — nothing can
--     read it, which is safe but is almost always a forgotten policy
--   · `pravah_audit_events / pravah_audit_insert`  an INSERT policy has no USING
--     clause by design; that one is the audit being pedantic and is now excluded
--
-- ── AND A NOTE THAT MATTERS MORE THAN THE AUDIT ───────────────────────────
--
-- Pravah now has read policies on `candidates`. Nikash's rule is that a score
-- never leaves the building; whether Pravah's membership model honours that is
-- not something this schema can assert, and it is worth somebody deciding on
-- purpose rather than discovering later. `v_foreign_policy_audit` lists exactly
-- which outside policies touch Nikash's tables, so the question is at least
-- visible.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Does this expression depend on who is asking? ─────────────────────────
create or replace function policy_reads_identity(p_expr text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_fn text;
begin
  if p_expr is null then return false; end if;

  -- Directly.
  if p_expr like '%auth.uid()%' or p_expr like '%current_setting(%request.jwt%' then
    return true;
  end if;

  -- Or through any function it names whose own body reads it. One level is
  -- enough in practice and terminates without a cycle check; a guard that hides
  -- auth.uid() two functions deep is a guard nobody can read either.
  for v_fn in
    select p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    if p_expr like '%' || v_fn || '(%' then
      if (select pg_get_functiondef(p.oid) from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = v_fn limit 1)
         like '%auth.uid()%' then
        return true;
      end if;
    end if;
  end loop;

  return false;
end $$;

revoke all on function policy_reads_identity(text) from public;
grant execute on function policy_reads_identity(text) to authenticated;

-- ── What this repository owns ─────────────────────────────────────────────
-- Until a neighbour arrived, "every table in public" and "every table Nikash
-- created" were the same set, so nothing needed to say which was which. They are
-- not the same set any more, and the audits have to be able to answer "is this
-- ours" — otherwise every one of them is either permanently red because of
-- somebody else's schema, or quietly narrowed until it stops catching our own.
--
-- A registry, not a prefix rule: `pravah_%` works today and says nothing about
-- the next system. Anything in `public` that is in neither list shows up as
-- unowned, which is a question rather than a pass or a fail.
create table if not exists nikash_owned_tables (
  table_name text primary key,
  note       text
);

insert into nikash_owned_tables (table_name, note)
select t.relname::text, 'created by this repository''s migrations'
from pg_class t join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public' and t.relkind = 'r'
  and t.relname::text not like 'pravah%'
on conflict (table_name) do nothing;

alter table nikash_owned_tables enable row level security;
alter table nikash_owned_tables force row level security;
drop policy if exists staff_read on nikash_owned_tables;
create policy staff_read on nikash_owned_tables for select to authenticated using (is_staff());
revoke all on nikash_owned_tables from anon;

create or replace view v_c10_audit as
  select c.relname as table_name,
         p.polname as policy_name,
         p.polroles::regrole[] as roles,
         coalesce(pg_get_expr(p.polqual, p.polrelid), '(no USING clause)') as using_expr,
         exists (select 1 from nikash_owned_tables o where o.table_name = c.relname::text) as ours
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public'
    and not exists (select 1 from rls_exempt e where e.table_name = c.relname::text)
    -- An INSERT-only policy has no USING clause by design; WITH CHECK is what
    -- constrains it. Flagging those made the audit noisy without making it right.
    and p.polcmd <> 'a'
    and not policy_reads_identity(pg_get_expr(p.polqual, p.polrelid));

alter view v_c10_audit set (security_invoker = true);

-- ── Which outside policies touch Nikash's tables ──────────────────────────
-- Not an exceptions list. A standing answer to "who else can read our data",
-- which is a question that had no answer at all until a neighbour appeared.
create or replace view v_foreign_policy_audit as
select
  c.relname::text as nikash_table,
  p.polname::text as policy_name,
  p.polcmd::text as command,
  coalesce(pg_get_expr(p.polqual, p.polrelid), '(no USING clause)') as using_expr,
  policy_reads_identity(pg_get_expr(p.polqual, p.polrelid)) as scoped_to_a_person
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace ns on ns.oid = c.relnamespace
where ns.nspname = 'public'
  -- Nikash's own tables, by the guards Nikash writes.
  and exists (select 1 from nikash_owned_tables o where o.table_name = c.relname::text)
  -- …carrying a policy that is not one of Nikash's.
  and coalesce(pg_get_expr(p.polqual, p.polrelid), '') not like '%is_staff()%'
  and coalesce(pg_get_expr(p.polqual, p.polrelid), '') not like '%staff_role()%'
  and coalesce(pg_get_expr(p.polqual, p.polrelid), '') not like '%my_client_id()%';

alter view v_foreign_policy_audit set (security_invoker = true);
revoke all on v_foreign_policy_audit from anon;
grant select on v_foreign_policy_audit to authenticated;

-- ── Assertions ────────────────────────────────────────────────────────────
do $$
declare v_c10 int; v_open text; v_foreign int;
begin
  -- The recogniser has to work on the guards that exist, or it is just a
  -- different way of being wrong.
  if not policy_reads_identity('is_staff()') then
    raise exception 'policy_reads_identity does not recognise is_staff()';
  end if;
  if not policy_reads_identity('(auth.uid() = owner)') then
    raise exception 'policy_reads_identity does not recognise a direct auth.uid()';
  end if;
  if policy_reads_identity('true') then
    raise exception 'policy_reads_identity thinks USING (true) is scoped to a person';
  end if;
  if policy_reads_identity(null) then
    raise exception 'policy_reads_identity treats a missing clause as guarded';
  end if;

  select count(*) into v_c10 from v_c10_audit;
  select string_agg(table_name || '.' || policy_name || ' — ' || left(using_expr, 40), '; ')
    into v_open from v_c10_audit;

  -- What is left must be genuinely open, and it must be somebody else's. If a
  -- Nikash table ever appears here it is this repository's problem immediately.
  if exists (select 1 from v_c10_audit where ours) then
    raise exception 'an unguarded policy on a table this repo owns: %',
      (select string_agg(table_name || '.' || policy_name, '; ') from v_c10_audit where ours);
  end if;

  select count(*) into v_foreign from v_foreign_policy_audit;
  raise notice 'sql/45: c10 now % row(s), all outside this repo — %',
    v_c10, coalesce(v_open, 'none');
  raise notice 'sql/45: % outside policies touch Nikash tables — see v_foreign_policy_audit',
    v_foreign;
end $$;

-- ── The same distinction on the RLS audit ─────────────────────────────────
create or replace view v_rls_bypass_audit as
  select x.problem, x.object, x.fix,
         exists (select 1 from nikash_owned_tables o where o.table_name = x.object) as ours
  from (
    select 'view runs as owner — base-table RLS is skipped'::text as problem,
           c.relname::text as object,
           ('alter view public.' || c.relname::text ||
            ' set (security_invoker = true)')::text as fix
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind = 'v'
      and coalesce((select option_value from pg_options_to_table(c.reloptions)
                    where option_name = 'security_invoker'), 'false') <> 'true'

    union all
    select ('anon holds ' || g.privilege_type || ' — the publishable key is public')::text,
           g.table_name::text,
           ('revoke ' || g.privilege_type || ' on public.' || g.table_name || ' from anon')::text
    from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.grantee = 'anon'

    union all
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
    select 'row security forced but no policy exists — nothing can read it'::text,
           t.relname::text,
           ('create policy staff_all on public.' || t.relname::text ||
            ' for all to authenticated using (is_staff()) with check (is_staff())')::text
    from pg_class t join pg_namespace ns on ns.oid = t.relnamespace
    where ns.nspname = 'public' and t.relkind = 'r'
      and t.relrowsecurity
      and not exists (select 1 from pg_policy p where p.polrelid = t.oid)
      and not exists (select 1 from rls_exempt e where e.table_name = t.relname::text)
  ) x;

alter view v_rls_bypass_audit set (security_invoker = true);

do $$
begin
  if exists (select 1 from v_rls_bypass_audit where ours) then
    raise exception 'an RLS problem on a table this repo owns: %',
      (select string_agg(object || ' — ' || problem, '; ') from v_rls_bypass_audit where ours);
  end if;
  raise notice 'sql/45: rls_bypass % row(s), c10 % row(s), none of them ours',
    (select count(*) from v_rls_bypass_audit),
    (select count(*) from v_c10_audit);
end $$;
