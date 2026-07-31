-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: every token-minting function was broken when called from the app.
--
-- THE BUG
-- Supabase installs pgcrypto into the `extensions` schema, not `public`. All
-- SECURITY DEFINER functions here pin `search_path = public` — correct hardening,
-- since an unpinned search_path on a definer function is a privilege-escalation
-- vector — but that also made `gen_random_bytes()` invisible to them. Any staff
-- action that mints a token failed with:
--
--     function gen_random_bytes(integer) does not exist
--
-- Affected: issue_assessment_token, create_client_intake_link,
-- issue_supplement_token. That is every link the console hands out.
--
-- WHY IT SURVIVED FOUR ROUNDS OF QA
-- Every test seeded its tokens with direct SQL through the Management API, which
-- runs as a superuser whose search_path already includes `extensions`. The staff
-- RPC path — the one a recruiter actually clicks — was never exercised. A test
-- that sets up its own fixtures through a different door than the user walks
-- through is not testing the door. The QA now clicks the button.
--
-- THE FIX
-- Append `extensions` to the search_path of exactly those three functions.
-- `public, extensions` keeps our own objects resolving first, so this does not
-- reopen the shadowing risk that pinning the path was there to close.
-- gen_random_uuid() is unaffected — it is core Postgres since 13, not pgcrypto.
-- ═══════════════════════════════════════════════════════════════════════════

alter function issue_assessment_token(uuid, int)         set search_path = public, extensions;
alter function create_client_intake_link(text, int)      set search_path = public, extensions;
alter function issue_supplement_token(uuid, uuid, int)   set search_path = public, extensions;

-- Assert the fix rather than trusting it: any definer function that needs
-- pgcrypto must now be able to see it.
do $$
declare v_bad text; v_token text;
begin
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and pg_get_functiondef(p.oid) ilike '%gen_random_bytes%'
    and not (p.proconfig::text ilike '%extensions%');

  if v_bad is not null then
    raise exception 'These functions still cannot reach pgcrypto: %', v_bad;
  end if;

  -- Prove it end to end in the same search_path a definer function gets.
  set local search_path = public, extensions;
  v_token := encode(gen_random_bytes(24), 'hex');
  if length(v_token) <> 48 then
    raise exception 'gen_random_bytes produced % chars, expected 48', length(v_token);
  end if;

  raise notice 'pgcrypto reachable from all three token functions.';
end $$;
