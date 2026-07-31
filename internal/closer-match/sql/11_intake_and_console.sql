-- ═══════════════════════════════════════════════════════════════════════════
-- Nikash — client intake access path + console read surface
--
-- INTAKE AUTH, and a deviation from PRD §8
-- §8 specifies a Supabase magic link for the client intake surface. That needs
-- SMTP this project does not have, and it needs every client contact to become
-- an auth user. Intake uses a staff-issued signed token instead — the same
-- mechanism already proven for candidates: resumable, no account, revocable,
-- and the client never touches a table directly. client_users remains in place
-- for a future magic-link path.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists intake_tokens (
  token       text primary key,
  client_id   uuid references clients(id) on delete cascade,
  issued_at   timestamptz default now(),
  expires_at  timestamptz not null,
  submitted_at timestamptz
);

alter table intake_tokens enable row level security;
alter table intake_tokens force row level security;
drop policy if exists intake_tokens_staff on intake_tokens;
create policy intake_tokens_staff on intake_tokens for all to authenticated
  using (is_staff()) with check (is_staff());

-- ═══ STAFF-SIDE: create a client and its intake link in one step ════════════

create or replace function create_client_intake_link(p_business_name text, p_valid_days int default 21)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_token text;
begin
  if not is_staff() then raise exception 'create_client_intake_link: staff only'; end if;

  select id into v_client from clients where lower(business_name) = lower(btrim(p_business_name));
  if v_client is null then
    insert into clients (business_name) values (btrim(p_business_name)) returning id into v_client;
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');
  insert into intake_tokens (token, client_id, expires_at)
  values (v_token, v_client, now() + make_interval(days => p_valid_days));

  return jsonb_build_object('client_id', v_client, 'token', v_token);
end $$;

-- ═══ CLIENT-SIDE: three RPCs, no table access ══════════════════════════════

create or replace function get_intake_form(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_name text; v_draft jsonb; v_submitted timestamptz;
begin
  select t.client_id, c.business_name, t.submitted_at
    into v_client, v_name, v_submitted
  from intake_tokens t join clients c on c.id = t.client_id
  where t.token = p_token and t.expires_at > now();

  if v_client is null then
    raise exception 'This intake link is not valid or has expired.';
  end if;

  select payload into v_draft from client_intake
  where client_id = v_client order by submitted_at desc limit 1;

  return jsonb_build_object(
    'business_name', v_name,
    'submitted', v_submitted is not null,
    'draft', coalesce(v_draft, '{}'::jsonb),
    -- The client ranks a SINGLE CLS. The candidate has two capabilities; that
    -- asymmetry is resolved in the engine, never exposed here (§6.1).
    'rankable', jsonb_build_array(
      jsonb_build_object('code','RES','name','Resilience & Composure',
        'plain','Keeps effort and tone steady after a run of losses or a bad month'),
      jsonb_build_object('code','DRV','name','Achievement Drive',
        'plain','Sets their own number above the target you give them'),
      jsonb_build_object('code','DSC','name','Process Discipline',
        'plain','Logs the same day, dated follow-ups, builds their own system'),
      jsonb_build_object('code','CLS','name','Closing Assertiveness',
        'plain','Asks for the money, holds price, keeps frame with senior buyers'),
      jsonb_build_object('code','CCH','name','Coachability',
        'plain','Changes behaviour after correction, including correction they disagree with'),
      jsonb_build_object('code','INT','name','Sales Integrity',
        'plain','Declines a bad-fit close, no false scarcity, honest about the offer')
    ),
    'comp_bands', (select jsonb_agg(jsonb_build_object(
        'index', band_index, 'label', label,
        'fixed', fixed_pct, 'variable', variable_pct) order by band_index)
      from comp_bands)
  );
end $$;

create or replace function save_intake_draft(p_token text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_existing uuid;
begin
  select client_id into v_client from intake_tokens
  where token = p_token and expires_at > now() and submitted_at is null;
  if v_client is null then
    raise exception 'This intake link is not valid, has expired, or was already submitted.';
  end if;

  select id into v_existing from client_intake
  where client_id = v_client and not is_complete order by submitted_at desc limit 1;

  if v_existing is null then
    insert into client_intake (client_id, payload, is_complete) values (v_client, p_payload, false);
  else
    update client_intake set payload = p_payload, submitted_at = now() where id = v_existing;
  end if;
end $$;

-- Submit: validate, compute the target profile, open a requirement, rank
-- everyone who already holds a profile. One call, so a client can never end up
-- with an intake that produced no requirement.
create or replace function submit_intake(p_token text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_client uuid; v_intake uuid; v_tp client_target_profile;
  v_req uuid; v_missing text[] := '{}'; v_n int; k text;
begin
  select client_id into v_client from intake_tokens
  where token = p_token and expires_at > now() and submitted_at is null;
  if v_client is null then
    raise exception 'This intake link is not valid, has expired, or was already submitted.';
  end if;

  -- Required for the engine to mean anything. expected_days_to_first_close is
  -- mandatory because it defines the outcome metric (§6.6) — without it the
  -- feedback loop has nothing to measure against.
  foreach k in array array['ticket_size','cycle_days','leads_per_day','buyer_response',
                           'comp_band','expected_days_to_first_close']
  loop
    if p_payload->>k is null or btrim(p_payload->>k) = '' then
      v_missing := array_append(v_missing, k);
    end if;
  end loop;
  if jsonb_array_length(coalesce(p_payload->'top3','[]'::jsonb)) <> 3 then
    v_missing := array_append(v_missing, 'top3 (pick exactly 3)');
  end if;
  if array_length(v_missing, 1) > 0 then
    return jsonb_build_object('ok', false, 'missing', v_missing);
  end if;

  insert into client_intake (client_id, payload, is_complete)
  values (v_client, p_payload, true) returning id into v_intake;

  v_tp := compute_target_profile(v_intake);

  insert into requirements (client_id, target_profile_id, title, ticket_size, cycle_days,
                            hard_filters, roleplay_pack)
  values (
    v_client, v_tp.id,
    coalesce(nullif(btrim(p_payload->>'role_title'), ''), 'Closer'),
    (p_payload->>'ticket_size')::numeric,
    (p_payload->>'cycle_days')::int,
    coalesce(p_payload->'hard_filters', '{}'::jsonb),
    case when (p_payload->>'ticket_size')::numeric < 50000 then 'fast'
         when (p_payload->>'ticket_size')::numeric <= 150000 then 'mid'
         else 'considered' end
  ) returning id into v_req;

  v_n := compute_matches(v_req);
  update intake_tokens set submitted_at = now() where token = p_token;

  return jsonb_build_object('ok', true, 'requirement_id', v_req, 'candidates_ranked', v_n);
end $$;

grant execute on function get_intake_form(text)             to anon;
grant execute on function save_intake_draft(text, jsonb)    to anon;
grant execute on function submit_intake(text, jsonb)        to anon;

-- ═══ CONSOLE READ SURFACE ══════════════════════════════════════════════════
-- One row per open requirement, with everything the list view needs.

create or replace view v_requirements as
select r.id, r.title, r.status, r.ticket_size, r.cycle_days, r.roleplay_pack, r.opened_at,
       c.business_name, c.id as client_id,
       tp.confidence, tp.benchmark_source, tp.required_levels, tp.bipolar_targets,
       tp.cls_blend, tp.benchmark_conflicts,
       (select count(*) from matches m where m.requirement_id = r.id and m.hard_filter_pass) as eligible,
       (select count(*) from matches m where m.requirement_id = r.id) as assessed,
       (select round(max(m.composite) * 100, 1) from matches m
          where m.requirement_id = r.id and m.hard_filter_pass) as best_pct
from requirements r
join clients c on c.id = r.client_id
left join client_target_profile tp on tp.id = r.target_profile_id;

-- Recruiter decision logging. §14.5 depends entirely on this being written, so
-- it is a single call the console can make from the shortlist row.
create or replace function log_decision(
  p_requirement_id uuid, p_candidate_id uuid, p_advanced boolean, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_rank int; v_staff uuid;
begin
  if not is_staff() then raise exception 'log_decision: staff only'; end if;
  select id into v_staff from staff where auth_uid = auth.uid();

  select engine_rank into v_rank from v_console
  where requirement_id = p_requirement_id and candidate_id = p_candidate_id;

  insert into recruiter_decisions (requirement_id, candidate_id, engine_rank,
                                   recruiter_advanced, recruiter_note, decided_by)
  values (p_requirement_id, p_candidate_id, v_rank, p_advanced, p_note, v_staff)
  on conflict (requirement_id, candidate_id) do update set
    recruiter_advanced = excluded.recruiter_advanced,
    recruiter_note = excluded.recruiter_note,
    engine_rank = excluded.engine_rank,
    decided_by = excluded.decided_by,
    decided_at = now();
end $$;

-- Candidates without a requirement yet — the queue the console opens on.
create or replace view v_candidate_queue as
select cand.id, cand.full_name, cand.created_at, cand.last_activity_at,
       p.computed_at as profiled_at, p.flags,
       s.completed_at is not null as assessment_complete,
       (select count(*) from matches m where m.candidate_id = cand.id and m.hard_filter_pass) as eligible_reqs
from candidates cand
left join lateral (
  select * from candidate_profile where candidate_id = cand.id order by computed_at desc limit 1
) p on true
left join lateral (
  select * from assessment_sessions where candidate_id = cand.id order by started_at desc limit 1
) s on true
where cand.full_name not like 'ZZ_FIXTURE%';

grant select on v_requirements, v_console, v_candidate_queue to authenticated;
grant execute on function log_decision(uuid, uuid, boolean, text) to authenticated;
grant execute on function create_client_intake_link(text, int)    to authenticated;
grant execute on function issue_assessment_token(uuid, int)       to authenticated;

-- ═══ STAFF BOOTSTRAP ═══════════════════════════════════════════════════════
-- Anyone can create an auth account, and that grants NOTHING: every policy keys
-- off a staff row. An admin links an auth user to a staff record by email.

create or replace function link_staff_account()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_email text; v_id uuid;
begin
  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then raise exception 'link_staff_account: not signed in'; end if;

  update staff set auth_uid = auth.uid()
  where lower(email) = lower(v_email) and auth_uid is null
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('linked', false,
      'reason', 'No staff record is waiting for ' || v_email || '. An admin must add it first.');
  end if;
  return jsonb_build_object('linked', true, 'staff_id', v_id);
end $$;

grant execute on function link_staff_account() to authenticated;
