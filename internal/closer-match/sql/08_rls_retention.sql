-- ═══════════════════════════════════════════════════════════════════════════
-- Access control, retention and the candidate access path
-- Sources: PRD v3.0 §8 (auth per surface), §15 (C1–C11)
--
-- THE THREAT THIS FILE EXISTS FOR
-- The frontend talks straight to PostgREST with a publishable key. If
-- item_options were readable by that key, any candidate could open devtools and
-- read `score_key` for all 44 items — the entire answer key, in the browser.
-- §7.3 calls item leakage "the real threat"; this is the one leak that would be
-- our own fault. So:
--   · anon gets NO table access at all. Not read, not write.
--   · the candidate surface goes through SECURITY DEFINER functions that return
--     stems and option text and never expose score_key.
--   · scoring happens server-side on finish.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Client ↔ auth mapping for magic-link intake (§8) ───────────────────────
-- Addition beyond §8's table list: §8 specifies magic-link auth for the client
-- intake surface but gives nothing to map an authenticated user to a client.
create table if not exists client_users (
  auth_uid  uuid primary key,
  client_id uuid references clients(id) on delete cascade,
  email     text,
  created_at timestamptz default now()
);

-- ── Role helpers ───────────────────────────────────────────────────────────

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff where auth_uid = auth.uid() and active
  );
$$;

create or replace function staff_role() returns text
language sql stable security definer set search_path = public as $$
  select role from staff where auth_uid = auth.uid() and active;
$$;

create or replace function my_client_id() returns uuid
language sql stable security definer set search_path = public as $$
  select client_id from client_users where auth_uid = auth.uid();
$$;

-- ═══ RLS: DEFAULT DENY EVERYWHERE ══════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array[
    'dimensions','items','item_options','dimension_params','param_audit','staff',
    'clients','client_intake','client_target_profile','requirements','client_users',
    'candidates','assessment_tokens','assessment_sessions','candidate_responses',
    'candidate_profile','matches','supplements','supplement_responses',
    'interviews','interview_ratings','interview_technical','interview_probes',
    'interview_contradictions','keying_rounds','keying_submissions',
    'placements','placement_outcomes','monitoring_attributes','recruiter_decisions',
    'comp_bands','dimension_templates'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- ── Staff: full access to the internal console surface ────────────────────
-- Deliberately NOT applied to monitoring_attributes — see below.

do $$
declare t text;
begin
  foreach t in array array[
    'dimensions','items','dimension_params','staff',
    'clients','client_intake','client_target_profile','requirements','client_users',
    'candidates','assessment_tokens','assessment_sessions','candidate_responses',
    'candidate_profile','matches','supplements','supplement_responses',
    'interviews','interview_ratings','interview_technical','interview_probes',
    'interview_contradictions','keying_rounds','keying_submissions',
    'placements','placement_outcomes','recruiter_decisions',
    'comp_bands','dimension_templates'
  ]
  loop
    execute format('drop policy if exists staff_all on %I', t);
    execute format(
      'create policy staff_all on %I for all to authenticated using (is_staff()) with check (is_staff())', t);
  end loop;
end $$;

-- ── item_options: the answer key. Staff read only, nobody writes at runtime ──
-- Writes happen through the seed migration as the table owner, which bypasses
-- RLS. There is no runtime path that can modify a key.
drop policy if exists item_options_staff_read on item_options;
create policy item_options_staff_read on item_options
  for select to authenticated using (is_staff());

-- Keying experts must not see the existing keys — that is the entire point of
-- §13's blind re-key. The console enforces it, and this comment records why no
-- broader read policy is granted here.

-- ── param_audit: read-only history, admin only ─────────────────────────────
drop policy if exists param_audit_admin on param_audit;
create policy param_audit_admin on param_audit
  for select to authenticated using (staff_role() = 'admin');

-- ── monitoring_attributes: ISOLATED (§8, §14.3) ────────────────────────────
-- "Deliberately isolated with its own RLS policy and NEVER joined into the
-- matching path. It exists only for §14.3. Building it this way is what makes
-- it safe to collect at all."
-- Only admin and psych can read it. Recruiters — the people making shortlist
-- decisions — cannot see it at all, which is the protection that matters.
drop policy if exists monitoring_isolated on monitoring_attributes;
create policy monitoring_isolated on monitoring_attributes
  for all to authenticated
  using (staff_role() in ('admin','psych'))
  with check (staff_role() in ('admin','psych'));

-- ── Client intake surface: a client sees only its own rows ─────────────────
drop policy if exists client_own_intake on client_intake;
create policy client_own_intake on client_intake
  for all to authenticated
  using (client_id = my_client_id())
  with check (client_id = my_client_id());

drop policy if exists client_own_record on clients;
create policy client_own_record on clients
  for select to authenticated using (id = my_client_id());

-- A client can never read a target profile, a match, or a score. R1 / C10 is
-- enforced by the absence of any policy granting it — not by a UI decision.

-- ═══ CANDIDATE ACCESS PATH — SECURITY DEFINER RPCs ═════════════════════════
-- The only way the candidate surface touches the database. anon gets EXECUTE on
-- exactly these four functions and nothing else.

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

-- 1. Issue a single-use link (staff action, from the console).
create or replace function issue_assessment_token(p_candidate_id uuid, p_valid_days int default 14)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if not is_staff() then
    raise exception 'issue_assessment_token: staff only';
  end if;
  v_token := encode(gen_random_bytes(24), 'hex');
  insert into assessment_tokens (token, candidate_id, expires_at)
  values (v_token, p_candidate_id, now() + make_interval(days => p_valid_days));
  return v_token;
end $$;

-- 2. Start (or resume) an assessment. Returns the served items WITHOUT keys.
--    Rotation draws PER DIMENSION so every dimension always receives its full
--    item count — the reason (raw+4)/12 stays valid across bank versions (§7.3).
create or replace function start_assessment(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_candidate uuid;
  v_session   uuid;
  v_items     text[];
begin
  select candidate_id into v_candidate
  from assessment_tokens
  where token = p_token and expires_at > now();

  if v_candidate is null then
    raise exception 'This assessment link is not valid or has expired.';
  end if;

  -- Resume an in-flight session rather than starting a second one.
  select id, item_set into v_session, v_items
  from assessment_sessions
  where candidate_id = v_candidate and completed_at is null
  order by started_at desc limit 1;

  if v_session is null then
    v_items := array(select id from items where active and bank_version = '1.1' order by sort_order);
    insert into assessment_sessions (candidate_id, bank_version, item_set, started_at)
    values (v_candidate, '1.1', v_items, now())
    returning id into v_session;
  end if;

  update assessment_tokens set consumed_at = coalesce(consumed_at, now()) where token = p_token;
  update candidates set last_activity_at = now() where id = v_candidate;

  return jsonb_build_object(
    'session_id', v_session,
    'answered', (select coalesce(jsonb_object_agg(item_id, option_key), '{}'::jsonb)
                   from candidate_responses where session_id = v_session),
    'items', (
      select coalesce(jsonb_agg(x order by x->>'sort_order'), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', i.id,
          'format', i.format,
          'stem', i.stem,
          'framing_note', i.framing_note,
          'sort_order', i.sort_order,
          -- Option order is randomised per session (§7.3). score_key is never
          -- part of this payload.
          'options', (
            select jsonb_agg(jsonb_build_object('key', o.option_key, 'text', o.option_text)
                             order by md5(o.option_key || v_session::text))
            from item_options o where o.item_id = i.id
          )
        ) as x
        from items i where i.id = any(v_items) and i.active
      ) t
    )
  );
end $$;

-- 3. Autosave one answer.
create or replace function save_response(
  p_token text, p_item_id text, p_option_key text,
  p_seconds numeric default null, p_position int default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_session uuid; v_candidate uuid;
begin
  select t.candidate_id, s.id into v_candidate, v_session
  from assessment_tokens t
  join assessment_sessions s on s.candidate_id = t.candidate_id and s.completed_at is null
  where t.token = p_token and t.expires_at > now()
  order by s.started_at desc limit 1;

  if v_session is null then
    raise exception 'No open assessment for this link.';
  end if;

  if not exists (select 1 from item_options where item_id = p_item_id and option_key = p_option_key) then
    raise exception 'Invalid option for item %', p_item_id;
  end if;

  insert into candidate_responses (session_id, item_id, option_key, seconds_on_item, position_shown)
  values (v_session, p_item_id, p_option_key, p_seconds, p_position)
  on conflict (session_id, item_id) do update set
    option_key = excluded.option_key,
    seconds_on_item = excluded.seconds_on_item,
    position_shown = excluded.position_shown,
    answered_at = now();

  update candidates set last_activity_at = now() where id = v_candidate;
end $$;

-- 4. Finish: close the session and score it server-side. The candidate never
--    receives a score — nothing in this return value is a result.
create or replace function finish_assessment(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_session uuid; v_answered int; v_expected int;
begin
  select s.id, array_length(s.item_set, 1) into v_session, v_expected
  from assessment_tokens t
  join assessment_sessions s on s.candidate_id = t.candidate_id and s.completed_at is null
  where t.token = p_token and t.expires_at > now()
  order by s.started_at desc limit 1;

  if v_session is null then
    raise exception 'No open assessment for this link.';
  end if;

  select count(*) into v_answered from candidate_responses where session_id = v_session;
  if v_answered < v_expected then
    return jsonb_build_object('complete', false,
      'answered', v_answered, 'expected', v_expected);
  end if;

  update assessment_sessions set completed_at = now() where id = v_session;
  perform compute_candidate_profile(v_session);

  return jsonb_build_object('complete', true);
end $$;

grant execute on function start_assessment(text)                              to anon;
grant execute on function save_response(text, text, text, numeric, int)       to anon;
grant execute on function finish_assessment(text)                             to anon;
-- issue_assessment_token is staff-only and deliberately NOT granted to anon.

-- ═══ C3 / C4 — WITHDRAWAL, DELETION AND RETENTION ══════════════════════════

-- C3: withdrawal and deletion path. Cascade delete by candidate_id — every
-- child table declares ON DELETE CASCADE, so this is complete by construction.
create or replace function purge_candidate(p_candidate_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then
    raise exception 'purge_candidate: staff only';
  end if;
  delete from candidates where id = p_candidate_id;
end $$;

-- C4: 24 months from last_activity_at, scheduled purge.
create or replace function purge_expired_candidates()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  with gone as (
    delete from candidates
    where last_activity_at < now() - interval '24 months'
    returning 1
  ) select count(*) into v_n from gone;
  return v_n;
end $$;

comment on function purge_expired_candidates() is
  'C4 retention purge. Schedule daily. If pg_cron is unavailable on this plan, '
  'call it from a scheduled job — an unscheduled purge function is not a '
  'retention limit, it is an intention.';

-- Schedule it if pg_cron is available; otherwise say so loudly rather than
-- leaving a compliance commitment silently unimplemented.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('purge-expired-candidates', '30 2 * * *',
                            'select purge_expired_candidates()');
      raise notice 'C4: retention purge scheduled daily at 02:30 UTC via pg_cron.';
    exception when others then
      raise warning 'C4: pg_cron present but scheduling failed (%). Schedule purge_expired_candidates() externally.', sqlerrm;
    end;
  else
    raise warning 'C4: pg_cron unavailable. purge_expired_candidates() MUST be scheduled externally or the 24-month retention limit is not enforced.';
  end if;
end $$;

-- ═══ C10 GUARD — no client-facing score surface ═════════════════════════════
-- A standing check that no policy has been added granting a non-staff principal
-- read access to a table holding scores. Run it in review; it is cheap.
create or replace view v_c10_audit as
select c.relname as table_name, p.polname as policy_name,
       p.polroles::regrole[] as roles, pg_get_expr(p.polqual, p.polrelid) as using_expr
from pg_policy p
join pg_class c on c.oid = p.polrelid
where c.relname in ('candidate_profile','matches','client_target_profile',
                    'interview_ratings','interview_technical','interview_probes',
                    'item_options','supplement_responses')
  and pg_get_expr(p.polqual, p.polrelid) not like '%is_staff()%'
  and pg_get_expr(p.polqual, p.polrelid) not like '%staff_role()%';

comment on view v_c10_audit is
  'C10: any row here is a policy exposing scores to a non-staff principal. '
  'This view should always be empty.';
