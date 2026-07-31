-- ═══════════════════════════════════════════════════════════════════════════
-- Three things the candidate surface needs before it can go live:
--   A. Configurable consent notice (§15.1, C1) — with a hard gate so the test
--      cannot run against a real candidate until it is filled in.
--   B. Criterion-validity support — known-performance benchmark takers, so the
--      instrument can be checked in a fortnight instead of two years.
--   C. Corrected presentation order — the item bank requires SD and BF items to
--      be "interleaved into the SJT flow, never shown as their own block", and
--      the 03 seed left them at the end as blocks I and J.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ A. CONSENT NOTICE ═════════════════════════════════════════════════════
-- §15.1's draft text carries four placeholders. They are settings, not code, so
-- they can be filled from the console without a redeploy — and until they are,
-- no assessment can start. A consent notice with "[Firm]" in it is not consent.

create table if not exists app_settings (
  key        text primary key,
  value      text,
  note       text not null,
  required   boolean not null default true,
  updated_at timestamptz default now()
);

alter table app_settings enable row level security;
alter table app_settings force row level security;
drop policy if exists app_settings_staff on app_settings;
create policy app_settings_staff on app_settings for all to authenticated
  using (is_staff()) with check (is_staff());

insert into app_settings (key, value, note, required) values
  ('firm_legal_name',      null, 'Legal entity name, as it should appear in the consent notice', true),
  ('data_deletion_email',  null, 'Monitored address for withdrawal and deletion requests (C3)', true),
  ('grievance_officer',    null, 'Named person for grievances — a role title is not sufficient', true),
  ('grievance_email',      null, 'Email for that named person', true),
  ('consent_version',      'v1', 'Bumped whenever the notice text changes materially', true)
on conflict (key) do nothing;

create or replace function consent_settings_missing()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(key order by key), '{}')
  from app_settings where required and (value is null or btrim(value) = '');
$$;

-- The notice, assembled server-side. Readable without auth — a candidate must
-- be able to read what they are consenting to before they identify themselves.
create or replace function get_consent_notice()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s jsonb; missing text[];
begin
  missing := consent_settings_missing();
  select jsonb_object_agg(key, value) into s from app_settings;

  if array_length(missing, 1) > 0 then
    return jsonb_build_object('configured', false, 'missing', missing);
  end if;

  return jsonb_build_object(
    'configured', true,
    'version', s->>'consent_version',
    'firm', s->>'firm_legal_name',
    'deletion_email', s->>'data_deletion_email',
    'grievance_officer', s->>'grievance_officer',
    'grievance_email', s->>'grievance_email'
  );
end $$;

grant execute on function get_consent_notice() to anon;

-- consent_version starts as 'pending' when staff create the candidate record;
-- the candidate's own consent replaces it. start_assessment refuses until then.
create or replace function record_consent(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_candidate uuid; v_version text; missing text[];
begin
  missing := consent_settings_missing();
  if array_length(missing, 1) > 0 then
    raise exception 'This assessment is not yet configured. Please contact the recruiter.';
  end if;

  select candidate_id into v_candidate from assessment_tokens
  where token = p_token and expires_at > now();
  if v_candidate is null then
    raise exception 'This assessment link is not valid or has expired.';
  end if;

  select value into v_version from app_settings where key = 'consent_version';

  update candidates
  set consent_version = v_version, consent_at = now(), last_activity_at = now()
  where id = v_candidate;

  return jsonb_build_object('consented', true, 'version', v_version);
end $$;

grant execute on function record_consent(text) to anon;

-- ═══ B. CRITERION VALIDITY ═════════════════════════════════════════════════
-- A concurrent-validity check, available now rather than in two years. Known
-- performers take the same battery; if the dimensions cannot separate a
-- known-strong closer from a known-average one, the instrument has a problem
-- worth finding before it ranks 700 people.
--
-- Weaker than predictive validity and labelled as such: these people already
-- know they are good, and current performance is not pre-hire performance.

alter table assessment_sessions
  add column if not exists benchmark_performance text
  check (benchmark_performance in ('strong','average','weak'));

comment on column assessment_sessions.benchmark_performance is
  'Known performance tier of a benchmark taker, set by the recruiter from actual '
  'results. Drives v_criterion_validity. Never used in matching.';

create or replace view v_criterion_validity as
with g as (
  select s.benchmark_performance as tier, d.code as dimension_code,
         (p.scores->>d.code)::numeric as score
  from assessment_sessions s
  join candidate_profile p on p.session_id = s.id
  cross join dimensions d
  where s.is_benchmark and s.benchmark_performance is not null
    and d.active and d.kind = 'unipolar' and p.scores ? d.code
),
agg as (
  select dimension_code,
         count(*) filter (where tier = 'strong')            as n_strong,
         count(*) filter (where tier in ('average','weak')) as n_other,
         avg(score) filter (where tier = 'strong')            as mean_strong,
         avg(score) filter (where tier in ('average','weak')) as mean_other,
         stddev_samp(score) filter (where tier = 'strong')            as sd_strong,
         stddev_samp(score) filter (where tier in ('average','weak')) as sd_other
  from g group by dimension_code
)
select dimension_code, n_strong, n_other,
       round(mean_strong, 1) as mean_strong,
       round(mean_other, 1)  as mean_other,
       round(mean_strong - mean_other, 1) as gap,
       -- Cohen's d on a pooled SD. Rough at these sample sizes; a direction and
       -- an order of magnitude, not a p-value.
       round(((mean_strong - mean_other)
              / nullif(sqrt((coalesce(sd_strong,0)^2 + coalesce(sd_other,0)^2) / 2.0), 0))::numeric, 2) as cohens_d,
       case
         when least(n_strong, n_other) < 5 then 'insufficient n — need 5+ per tier'
         when mean_strong - mean_other < 0
           then 'INVERTED — strong performers score LOWER. Investigate the items.'
         when (mean_strong - mean_other)
              / nullif(sqrt((coalesce(sd_strong,0)^2 + coalesce(sd_other,0)^2) / 2.0), 0) >= 0.5
           then 'separates the groups'
         else 'weak separation — dimension may not be doing work'
       end as verdict
from agg;

comment on view v_criterion_validity is
  'Concurrent validity, NOT predictive. Known performers take the battery and we '
  'ask whether the dimensions separate them. Available immediately; weaker than '
  '§12, which needs ~100 placements with outcomes.';

-- ═══ C. PRESENTATION ORDER ═════════════════════════════════════════════════
-- The item bank is explicit: "SD and BF items interleaved into the SJT flow,
-- never shown as their own block." The 03 seed left them as trailing blocks I
-- and J, which would have told every candidate exactly which three items were
-- the honesty check. Fixed here.
--
-- SD items are deliberately NOT placed next to Block F (Sales Integrity). An SD
-- absolute about exaggerating a product's benefit, sitting beside the integrity
-- scenarios, would cue the candidate that this is an honesty test — which the
-- bank warns destroys those items.

alter table items add column if not exists present_block text;

update items set present_block = block_label;

-- Host block for each interleaved item, for navigation purposes.
update items set present_block = 'A' where id in ('BF-03','SD-02');
update items set present_block = 'B' where id in ('BF-02','SD-01');
update items set present_block = 'C' where id in ('BF-01','SD-03');

-- Interleaved presentation order.
update items set sort_order = v.ord
from (values
  -- Block A — resilience, with the RES behavioural-frequency item mid-block
  ('RES-01',10),('RES-02',20),('BF-03',30),('RES-03',40),('SD-02',50),('RES-04',60),
  -- Block B — drive
  ('DRV-01',70),('DRV-02',80),('BF-02',90),('SD-01',100),('DRV-03',110),('DRV-04',120),
  -- Block C — process discipline
  ('DSC-01',130),('BF-01',140),('DSC-02',150),('DSC-03',160),('SD-03',170),('DSC-04',180),
  -- Block D — considered purchase (framing note shown)
  ('CLS-01',190),('CLS-02',200),('CLS-03',210),('CLS-04',220),
  -- Block D2 — fast close (framing note shown; the key inverts against D)
  ('CLS-F01',230),('CLS-F02',240),('CLS-F03',250),('CLS-F04',260),
  -- Block E — coachability
  ('CCH-01',270),('CCH-02',280),('CCH-03',290),('CCH-04',300),
  -- Block F — integrity. Never described to the candidate as such.
  ('INT-01',310),('INT-02',320),('INT-03',330),('INT-04',340),
  -- Blocks G and H — forced choice
  ('MOT-01',350),('MOT-02',360),('MOT-03',370),('MOT-04',380),('MOT-05',390),
  ('STY-01',400),('STY-02',410),('STY-03',420),('STY-04',430),('STY-05',440)
) as v(id, ord)
where items.id = v.id;

do $$
declare v_bad int; v_trailing int;
begin
  select count(*) into v_bad from (
    select sort_order from items where active group by sort_order having count(*) > 1
  ) t;
  if v_bad > 0 then
    raise exception 'Presentation order: % duplicated sort_order values', v_bad;
  end if;

  -- The rule that matters: no SD or BF item may sit in the final stretch, where
  -- it would read as a separate block.
  select count(*) into v_trailing
  from items where active and format in ('sd_check','behavioural_freq')
    and sort_order > (select max(sort_order) - 60 from items where active);
  if v_trailing > 0 then
    raise exception 'Presentation order: % SD/BF items still trailing the flow', v_trailing;
  end if;

  raise notice 'Presentation order interleaved: SD and BF are inside blocks A, B and C.';
end $$;

-- ═══ start_assessment, revised ═════════════════════════════════════════════
-- Adds the consent gate and returns present_block so the surface can enforce
-- "no back-navigation between blocks".

create or replace function start_assessment(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_candidate uuid;
  v_consent   text;
  v_session   uuid;
  v_items     text[];
  missing     text[];
begin
  missing := consent_settings_missing();
  if array_length(missing, 1) > 0 then
    raise exception 'This assessment is not yet configured. Please contact the recruiter.';
  end if;

  select t.candidate_id, c.consent_version into v_candidate, v_consent
  from assessment_tokens t
  join candidates c on c.id = t.candidate_id
  where t.token = p_token and t.expires_at > now();

  if v_candidate is null then
    raise exception 'This assessment link is not valid or has expired.';
  end if;

  if v_consent is null or v_consent = 'pending' then
    raise exception 'Consent has not been recorded for this assessment.';
  end if;

  select id, item_set into v_session, v_items
  from assessment_sessions
  where candidate_id = v_candidate and completed_at is null
  order by started_at desc limit 1;

  if v_session is null then
    -- Rotation draws PER DIMENSION (§7.3) so every dimension always receives its
    -- full item count — the reason (raw+4)/12 stays valid across bank versions.
    -- With bank v1.1 there are no alternates yet, so this serves all 44.
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
      select coalesce(jsonb_agg(x order by (x->>'sort_order')::int), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', i.id,
          'format', i.format,
          'stem', i.stem,
          'framing_note', i.framing_note,
          'block', i.present_block,
          'sort_order', i.sort_order,
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

grant execute on function start_assessment(text) to anon;
