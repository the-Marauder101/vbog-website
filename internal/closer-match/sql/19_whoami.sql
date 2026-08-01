-- ═══════════════════════════════════════════════════════════════════════════
-- 19 — access is a positive answer, not the absence of an error
--
-- Found immediately after sql/18, by the test that closing the view bypass made
-- meaningful for the first time.
--
-- `afterSignIn()` decided you were staff by running `loadRequirements()` and
-- seeing whether it threw. Before sql/18 that inference was wrong in the
-- dangerous direction: the view bypassed RLS, so a stranger who signed up saw
-- REAL requirements. After sql/18 it is wrong in the merely embarrassing
-- direction: RLS returns zero rows, zero rows is not an exception, so a stranger
-- lands inside an empty console with a full navigation bar.
--
-- Both are the same mistake. **An empty result is not a denial.** Postgres RLS is
-- deliberately silent — it filters rows, it does not raise — so any client that
-- treats "no error" as "permitted" has no authorisation check at all.
--
-- So the console now asks, and the answer is a boolean from the database:
--
--   whoami() -> { staff: bool, role, name, reason }
--
-- SECURITY DEFINER because a non-staff caller has no read on `staff` and must
-- still be able to be told no. It returns nothing about anyone else.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function whoami()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_email text; s record;
begin
  if auth.uid() is null then
    return jsonb_build_object('staff', false, 'reason', 'Not signed in.');
  end if;
  select email into v_email from auth.users where id = auth.uid();

  select id, full_name, role, active into s from staff where auth_uid = auth.uid();

  if s.id is null then
    return jsonb_build_object('staff', false, 'email', v_email,
      'reason', 'No staff record is waiting for ' || coalesce(v_email, 'this account') ||
                '. An admin must add it before the account grants anything.');
  end if;
  if not s.active then
    -- The case that made this function necessary: an invited keyer's row exists
    -- so their keys can be attributed, and is inactive precisely so it is not an
    -- account. Say that plainly instead of showing them an empty console.
    return jsonb_build_object('staff', false, 'email', v_email, 'role', s.role,
      'reason', case when s.role = 'keyer'
        then 'This email was invited to key items, which is not a console account. ' ||
             'Use the keying link you were sent.'
        else 'This account has been deactivated.' end);
  end if;

  return jsonb_build_object('staff', true, 'role', s.role,
                            'name', s.full_name, 'email', v_email);
end $$;

grant execute on function whoami() to authenticated, anon;

do $$
declare v jsonb;
begin
  -- Called with no session, as PostgREST would for anon: must answer, not raise.
  select whoami() into v;
  if (v->>'staff')::boolean is not false then
    raise exception 'whoami() must report staff=false when nobody is signed in, got %', v;
  end if;
  raise notice 'sql/19 ok — whoami() answers, and answers no by default';
end $$;
