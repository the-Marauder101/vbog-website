-- ═══════════════════════════════════════════════════════════════════════════
-- 27 — the RLS fix has to survive being forgotten
--
-- sql/18 closed a serious hole: every view ran as its owner, so base-table RLS
-- was never consulted and the publishable key could read candidate names, client
-- brief data and live keying tokens. It set `security_invoker = true` on every
-- view in a loop.
--
-- Then I re-applied sql/04 for an unrelated reason, and `v_rls_bypass_audit`
-- went from 0 rows to 7.
--
-- **`CREATE OR REPLACE VIEW` does not preserve `security_invoker`.** It resets
-- to the default, which is off. So every one of the seven instrument-health
-- views defined in sql/04 quietly reopened the hole, and nothing but the audit
-- noticed.
--
-- That makes sql/18 a fix with a half-life. It is correct at the moment it runs
-- and decays every time anyone re-applies an earlier migration, adds a view, or
-- edits one — which is a normal Tuesday. **A security property that depends on
-- everybody remembering is not a property, it is a habit.**
--
-- So it becomes a rule the database enforces on itself. An event trigger sets
-- `security_invoker` on any view created or replaced in `public`, at the moment
-- it is created. There is no longer anything to remember, and no migration
-- ordering that can undo it.
--
-- (The trigger re-enters once — its own ALTER VIEW fires the same trigger — and
-- terminates immediately, because the second pass finds the option already set
-- and does nothing.)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function enforce_view_security_invoker()
returns event_trigger language plpgsql as $$
declare r record; v_is text;
begin
  for r in
    select * from pg_event_trigger_ddl_commands()
    where object_type = 'view' and schema_name = 'public'
  loop
    select coalesce((select option_value from pg_options_to_table(c.reloptions)
                      where option_name = 'security_invoker'), 'false')
      into v_is
    from pg_class c where c.oid = r.objid;

    if v_is is distinct from 'true' then
      execute format('alter view %s set (security_invoker = true)', r.object_identity);
      raise notice 'security_invoker set on %', r.object_identity;
    end if;
  end loop;
end $$;

drop event trigger if exists view_security_invoker;
create event trigger view_security_invoker on ddl_command_end
  when tag in ('CREATE VIEW', 'ALTER VIEW')
  execute function enforce_view_security_invoker();

-- Close the seven that reopened, and any other that has drifted.
do $$
declare v record; n int := 0;
begin
  for v in
    select c.relname from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind = 'v'
      and coalesce((select option_value from pg_options_to_table(c.reloptions)
                    where option_name = 'security_invoker'), 'false') <> 'true'
  loop
    execute format('alter view public.%I set (security_invoker = true)', v.relname);
    n := n + 1;
  end loop;
  raise notice 'repaired % view(s)', n;
end $$;

-- ── Prove the trigger works, rather than trusting it ───────────────────────
do $$
declare v_is text; v int;
begin
  execute 'create or replace view zz_trigger_probe as select 1 as x';
  select coalesce((select option_value from pg_options_to_table(c.reloptions)
                    where option_name = 'security_invoker'), 'false')
    into v_is
  from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relname = 'zz_trigger_probe';
  execute 'drop view zz_trigger_probe';

  if v_is is distinct from 'true' then
    raise exception 'the event trigger did not set security_invoker on a new view (got %)', v_is;
  end if;

  select count(*) into v from v_rls_bypass_audit;
  if v > 0 then raise exception 'v_rls_bypass_audit is not empty (%)', v; end if;

  raise notice 'sql/27 ok — a new view cannot be created without security_invoker';
end $$;
