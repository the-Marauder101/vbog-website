-- ═══════════════════════════════════════════════════════════════════════════
-- The last four operational gaps:
--   A. §10 client supplement — authoring, serving, scoring, and the top-2 cap
--   B. §12 placements and outcomes — the table the whole thing depends on
--   C. §6.4 / criterion validity — marking a benchmark taker
--   D. §14.3 monitoring attributes — voluntary, isolated collection
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ A. CLIENT SUPPLEMENT ══════════════════════════════════════════════════
-- Covers only genuine idiosyncrasy: a vertical, a specific sales motion, a
-- founder non-negotiable, a language nuance. Scored SEPARATELY, never merged
-- into candidate_profile, never written back as a dimension.

create table if not exists supplement_tokens (
  token         text primary key,
  supplement_id uuid references supplements(id) on delete cascade,
  candidate_id  uuid references candidates(id) on delete cascade,
  requirement_id uuid references requirements(id) on delete set null,
  issued_at     timestamptz default now(),
  expires_at    timestamptz not null,
  submitted_at  timestamptz
);
alter table supplement_tokens enable row level security;
alter table supplement_tokens force row level security;
drop policy if exists supplement_tokens_staff on supplement_tokens;
create policy supplement_tokens_staff on supplement_tokens for all to authenticated
  using (is_staff()) with check (is_staff());

-- Authored once per client, reused for every requirement from that client.
create or replace function save_supplement(p_client_id uuid, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int;
begin
  if not is_staff() then raise exception 'save_supplement: staff only'; end if;

  select count(*) into v_n from jsonb_array_elements(p_items);
  if v_n > 13 then
    raise exception 'A supplement is 5-8 behavioural plus 3-5 technical items (§10). % is too many — if you need more, the dictionary is probably missing a dimension.', v_n;
  end if;

  select id into v_id from supplements where client_id = p_client_id;
  if v_id is null then
    insert into supplements (client_id, items) values (p_client_id, p_items) returning id into v_id;
  else
    update supplements set items = p_items where id = v_id;
  end if;
  return v_id;
end $$;

-- §2: "Supplement fan-out is capped at two. A candidate matching five clients
-- would face 30+ extra items and abandon." Enforced here rather than trusted to
-- a recruiter counting in their head.
create or replace function issue_supplement_token(p_candidate_id uuid, p_requirement_id uuid, p_valid_days int default 10)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_supp uuid; v_open int; v_token text;
begin
  if not is_staff() then raise exception 'issue_supplement_token: staff only'; end if;

  select client_id into v_client from requirements where id = p_requirement_id;
  select id into v_supp from supplements where client_id = v_client;
  if v_supp is null then
    raise exception 'This client has no supplement written yet. Author it first (§10).';
  end if;

  select count(*) into v_open from supplement_tokens
  where candidate_id = p_candidate_id and submitted_at is null and expires_at > now()
    and supplement_id <> v_supp;
  if v_open >= 2 then
    raise exception 'This candidate already has 2 open supplements. The fan-out cap is two (§2) — run these first, and add a third only if both come back weak.';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');
  insert into supplement_tokens (token, supplement_id, candidate_id, requirement_id, expires_at)
  values (v_token, v_supp, p_candidate_id, p_requirement_id, now() + make_interval(days => p_valid_days));
  return jsonb_build_object('token', v_token, 'supplement_id', v_supp);
end $$;

create or replace function get_supplement(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'business_name', c.business_name,
    'items', s.items,
    'submitted', t.submitted_at is not null,
    'draft', coalesce(sr.payload, '{}'::jsonb)
  ) into v
  from supplement_tokens t
  join supplements s on s.id = t.supplement_id
  join clients c on c.id = s.client_id
  left join supplement_responses sr on sr.supplement_id = t.supplement_id and sr.candidate_id = t.candidate_id
  where t.token = p_token and t.expires_at > now();

  if v is null then raise exception 'This link is not valid or has expired.'; end if;
  return v;
end $$;

create or replace function submit_supplement(p_token text, p_payload jsonb, p_final boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v_supp uuid; v_cand uuid;
begin
  select supplement_id, candidate_id into v_supp, v_cand from supplement_tokens
  where token = p_token and expires_at > now() and submitted_at is null;
  if v_supp is null then raise exception 'This link is not valid, has expired, or was already submitted.'; end if;

  insert into supplement_responses (supplement_id, candidate_id, payload)
  values (v_supp, v_cand, p_payload)
  on conflict (supplement_id, candidate_id) do update set payload = excluded.payload;

  update candidates set last_activity_at = now() where id = v_cand;
  if p_final then
    update supplement_tokens set submitted_at = now() where token = p_token;
  end if;
end $$;

grant execute on function get_supplement(text)                     to anon;
grant execute on function submit_supplement(text, jsonb, boolean)  to anon;

-- Scored by a human, separately. Pass / Concern / Fail with a one-line note.
-- Client-specific, so it never rolls into any general score.
create or replace function score_supplement(p_supplement_id uuid, p_candidate_id uuid,
                                            p_verdict text, p_note text, p_score numeric default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'score_supplement: staff only'; end if;
  update supplement_responses
  set verdict = p_verdict, note = p_note, score = p_score
  where supplement_id = p_supplement_id and candidate_id = p_candidate_id;
end $$;

create or replace view v_supplements as
select s.id, s.client_id, c.business_name,
       jsonb_array_length(s.items) as n_items,
       s.items,
       (select count(*) from supplement_responses r where r.supplement_id = s.id) as responses,
       (select count(*) from supplement_responses r where r.supplement_id = s.id and r.verdict is null) as unscored
from supplements s join clients c on c.id = s.client_id
where c.business_name not like 'ZZ_FIXTURE%';

create or replace view v_supplement_responses as
select r.supplement_id, r.candidate_id, cand.full_name, c.business_name,
       r.payload, r.verdict, r.note, r.score, s.items
from supplement_responses r
join supplements s on s.id = r.supplement_id
join clients c on c.id = s.client_id
join candidates cand on cand.id = r.candidate_id;

-- §10 guardrail: if multiple clients keep asking the same thing, the dictionary
-- is missing a dimension. This is the ONLY legitimate route to changing the
-- eight, so the signal needs to be visible rather than remembered.
create or replace view v_supplement_overlap as
select lower(btrim(i->>'prompt')) as prompt,
       count(distinct s.client_id) as clients_asking,
       case when count(distinct s.client_id) >= 3
            then 'THREE OR MORE CLIENTS ASK THIS — the dictionary may be missing a dimension (§17 tripwire)'
            else 'ok' end as verdict
from supplements s, jsonb_array_elements(s.items) i
group by 1 having count(distinct s.client_id) > 1
order by 2 desc;

-- ═══ B. PLACEMENTS AND OUTCOMES ════════════════════════════════════════════
-- §18 names an empty placement_outcomes as the most likely single point of
-- failure, and §12 calls the table the asset. Code cannot make someone fill it
-- in, but it can make the gap impossible to overlook — hence v_outcomes_due.

create or replace function record_placement(p_requirement_id uuid, p_candidate_id uuid, p_joined_on date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_match uuid; v_iv uuid;
begin
  if not is_staff() then raise exception 'record_placement: staff only'; end if;

  -- Freeze WHAT WAS PREDICTED. Without these two ids the outcome can never be
  -- compared to the prediction, which is the entire point of the table.
  select id into v_match from matches
  where requirement_id = p_requirement_id and candidate_id = p_candidate_id;
  select id into v_iv from interviews
  where requirement_id = p_requirement_id and candidate_id = p_candidate_id;

  insert into placements (requirement_id, candidate_id, match_id, interview_id, joined_on)
  values (p_requirement_id, p_candidate_id, v_match, v_iv, p_joined_on)
  returning id into v_id;

  update requirements set status = 'filled' where id = p_requirement_id;
  return v_id;
end $$;

create or replace function record_outcome(
  p_placement_id uuid, p_checkpoint text, p_retained boolean,
  p_exit_type text default null, p_exit_reason text default null,
  p_days_to_first_close int default null, p_quota_pct numeric default null,
  p_satisfaction int default null, p_notes text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_composite numeric; v_iv_mean numeric; v_tech_mean numeric; v_p placements;
begin
  if not is_staff() then raise exception 'record_outcome: staff only'; end if;
  select * into v_p from placements where id = p_placement_id;

  -- The three predictors, copied from the FROZEN prediction and kept apart.
  -- §12/§18: merging them is what makes "which of the three actually predicted
  -- retention?" unanswerable. Do not combine them.
  select composite into v_composite from matches where id = v_p.match_id;
  select avg(rating) into v_iv_mean from interview_ratings where interview_id = v_p.interview_id;
  select avg(rating) into v_tech_mean from interview_technical where interview_id = v_p.interview_id;

  insert into placement_outcomes (
    placement_id, checkpoint, retained, exit_type, exit_reason,
    days_to_first_close, quota_attainment_pct, client_satisfaction, client_notes,
    composite, interview_mean, technical_mean
  ) values (
    p_placement_id, p_checkpoint, p_retained,
    coalesce(p_exit_type, case when p_retained then 'na' end), p_exit_reason,
    p_days_to_first_close, p_quota_pct, p_satisfaction, p_notes,
    v_composite, v_iv_mean, v_tech_mean
  )
  on conflict (placement_id, checkpoint) do update set
    retained = excluded.retained, exit_type = excluded.exit_type,
    exit_reason = excluded.exit_reason, days_to_first_close = excluded.days_to_first_close,
    quota_attainment_pct = excluded.quota_attainment_pct,
    client_satisfaction = excluded.client_satisfaction, client_notes = excluded.client_notes,
    composite = excluded.composite, interview_mean = excluded.interview_mean,
    technical_mean = excluded.technical_mean, recorded_at = now();
end $$;

-- What is overdue, right now. This is the mitigation for §18's named risk.
create or replace view v_outcomes_due as
select p.id as placement_id, cand.full_name, c.business_name, r.title, p.joined_on,
       cp.checkpoint,
       (p.joined_on + (case cp.checkpoint when 'm3' then 90 when 'm6' then 180 else 365 end))::date as due_on,
       (current_date - (p.joined_on + (case cp.checkpoint when 'm3' then 90 when 'm6' then 180 else 365 end)))::int as days_overdue
from placements p
join requirements r on r.id = p.requirement_id
join clients c on c.id = r.client_id
join candidates cand on cand.id = p.candidate_id
cross join (values ('m3'),('m6'),('m12')) cp(checkpoint)
where not exists (
  select 1 from placement_outcomes o
  where o.placement_id = p.id and o.checkpoint = cp.checkpoint)
  and current_date >= p.joined_on + (case cp.checkpoint when 'm3' then 90 when 'm6' then 180 else 365 end)
order by days_overdue desc;

create or replace view v_placements as
select p.id, p.joined_on, cand.full_name, c.business_name, r.title,
       round(m.composite * 100, 1) as predicted_pct,
       (select round(avg(rating), 2) from interview_ratings ir where ir.interview_id = p.interview_id) as interview_mean,
       (select count(*) from placement_outcomes o where o.placement_id = p.id) as outcomes_recorded,
       (select bool_and(retained) from placement_outcomes o where o.placement_id = p.id) as retained_so_far
from placements p
join requirements r on r.id = p.requirement_id
join clients c on c.id = r.client_id
join candidates cand on cand.id = p.candidate_id
left join matches m on m.id = p.match_id
order by p.joined_on desc;

-- §12 at n≈100: which of the three predictors actually predicted anything.
-- Empty until the outcomes exist. Built now so nobody has to invent it later.
create or replace view v_predictor_validity as
with o as (
  select composite, interview_mean, technical_mean, retained,
         days_to_first_close, quota_attainment_pct
  from placement_outcomes where checkpoint = 'm3'
)
select count(*) as n_outcomes,
       round(corr(composite, case when retained then 1 else 0 end)::numeric, 3)      as composite_vs_retention,
       round(corr(interview_mean, case when retained then 1 else 0 end)::numeric, 3) as interview_vs_retention,
       round(corr(technical_mean, case when retained then 1 else 0 end)::numeric, 3) as technical_vs_retention,
       round(corr(composite, quota_attainment_pct)::numeric, 3)                       as composite_vs_quota,
       round(corr(interview_mean, quota_attainment_pct)::numeric, 3)                  as interview_vs_quota,
       round(corr(technical_mean, quota_attainment_pct)::numeric, 3)                  as technical_vs_quota,
       case when count(*) < 100
            then 'needs ~100 outcomes before these mean anything (§12)'
            else 'ready — replace expert weights with fitted ones' end as verdict
from o;

-- ═══ C. BENCHMARK TAKERS (§6.4 and criterion validity) ═════════════════════
create or replace function mark_benchmark(p_session_id uuid, p_client_id uuid,
                                          p_kind text, p_performance text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'mark_benchmark: staff only'; end if;
  update assessment_sessions
  set is_benchmark = true, benchmark_client_id = p_client_id,
      benchmark_kind = p_kind, benchmark_performance = p_performance
  where id = p_session_id;
end $$;

grant execute on function mark_benchmark(uuid, uuid, text, text) to authenticated;

-- ═══ D. MONITORING ATTRIBUTES (§14.3) ══════════════════════════════════════
-- Voluntary, skippable, and written through the candidate's own assessment
-- token so no staff member ever links a face to a row. The table stays
-- RLS-isolated and is never joined into the matching path.
create or replace function save_monitoring(p_token text, p_gender text, p_age_band text, p_region text)
returns void language plpgsql security definer set search_path = public as $$
declare v_cand uuid;
begin
  select candidate_id into v_cand from assessment_tokens
  where token = p_token and expires_at > now();
  if v_cand is null then raise exception 'This link is not valid.'; end if;

  insert into monitoring_attributes (candidate_id, gender, age_band, region)
  values (v_cand, nullif(p_gender, ''), nullif(p_age_band, ''), nullif(p_region, ''))
  on conflict (candidate_id) do update set
    gender = excluded.gender, age_band = excluded.age_band,
    region = excluded.region, collected_at = now();
end $$;

grant execute on function save_monitoring(text, text, text, text) to anon;

grant select on v_supplements, v_supplement_responses, v_supplement_overlap,
                v_placements, v_outcomes_due, v_predictor_validity to authenticated;
grant execute on function save_supplement(uuid, jsonb)                      to authenticated;
grant execute on function issue_supplement_token(uuid, uuid, int)           to authenticated;
grant execute on function score_supplement(uuid, uuid, text, text, numeric) to authenticated;
grant execute on function record_placement(uuid, uuid, date)                to authenticated;
grant execute on function record_outcome(uuid, text, boolean, text, text, int, numeric, int, text) to authenticated;
grant select on clients to authenticated;
