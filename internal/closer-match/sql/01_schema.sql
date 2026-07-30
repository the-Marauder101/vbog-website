-- ═══════════════════════════════════════════════════════════════════════════
-- Closer–Client Matching System — Schema
-- Source of truth: PRD v3.0 §8. Run in numeric order on a fresh project.
-- Idempotent: safe to re-run.
--
-- Three architectural rules this file physically enforces:
--   R1  Scores never leave the building — no client-facing score surface exists.
--   R3  The system never decides — `matches` has NO rejected/status field.
--       There is deliberately no column here that could hold an auto-reject.
--   §8  Scoring lives in Postgres, not app code — see 04/05/07.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ═══ DICTIONARY & PARAMETERS ═══════════════════════════════════════════════

create table if not exists dimensions (
  code            text primary key,          -- RES DRV DSC CLS_C CLS_F CCH INT MOT STY
  name            text not null,
  kind            text not null check (kind in ('unipolar','bipolar')),
  definition      text,                      -- §5 — serves the C8 job-relatedness rationale
  pole_0_label    text,
  pole_100_label  text,
  dict_version    text not null default '2.1',
  active          boolean not null default true
);

create table if not exists items (
  id             text primary key,           -- 'RES-01','CLS-F01'
  dimension_code text references dimensions(code),
  format         text not null check (format in ('sjt','forced_choice','behavioural_freq','sd_check')),
  stem           text not null,
  framing_note   text,                       -- Blocks D / D2 one-liner shown to candidate
  block_label    text,                       -- for ordering only; SD and BF are interleaved, never a block
  sort_order     int,
  bank_version   text not null default '1.1',
  active         boolean not null default true
);

create table if not exists item_options (
  item_id     text references items(id) on delete cascade,
  option_key  text not null,
  option_text text not null,
  score_key   numeric not null,              -- SJT −1/0/1/2 · FC 0 or 100 · BF −5..+5
  sort_order  int,
  primary key (item_id, option_key)
);

-- Every lookup from §6.2, §6.3, §9.2.1, §9.4 lives here. Nothing hardcoded.
create table if not exists dimension_params (
  param_group text not null,
  param_key   text not null,
  param_value numeric not null,
  note        text,
  primary key (param_group, param_key)
);

create table if not exists param_audit (
  id         bigserial primary key,
  table_name text,
  row_key    text,
  old_value  jsonb,
  new_value  jsonb,
  changed_by uuid,
  changed_at timestamptz default now()
);

-- ═══ STAFF (console auth — PRD §8 "Supabase Auth + RLS by staff role") ═════
-- Addition beyond §8's listing: §8 names the auth model but gives no table.
create table if not exists staff (
  id         uuid primary key default gen_random_uuid(),
  auth_uid   uuid unique,                    -- Supabase auth.users.id
  email      text not null unique,
  full_name  text,
  role       text not null default 'recruiter'
             check (role in ('admin','recruiter','psych')),
  active     boolean not null default true,
  created_at timestamptz default now()
);

-- ═══ CLIENTS ═══════════════════════════════════════════════════════════════

create table if not exists clients (
  id            uuid primary key default gen_random_uuid(),
  business_name text not null,
  created_at    timestamptz default now()
);

create table if not exists client_intake (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references clients(id) on delete cascade,
  payload      jsonb not null,
  is_complete  boolean not null default false,   -- drives §6.5 confidence
  submitted_at timestamptz default now()
);

create table if not exists client_target_profile (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid references clients(id) on delete cascade,
  intake_id         uuid references client_intake(id) on delete set null,
  dict_version      text not null default '2.1',
  required_levels   jsonb not null,   -- {"RES":75,"CLS":70,...} — a SINGLE CLS
  dimension_weights jsonb not null,   -- 3.0 top-3 / 1.0 unranked / 0.5 bottom-3
  bipolar_targets   jsonb not null,   -- {"MOT":50,"STY":75}
  cls_blend         jsonb not null,   -- {"w_C":0.80,"w_F":0.20}
  benchmark_source  text check (benchmark_source in ('none','employee','founder')),
  confidence        text check (confidence in ('low','medium','high')),
  benchmark_conflicts jsonb,          -- §6.4 — surfaced, never silently resolved
  computed_at       timestamptz default now()
);

create table if not exists requirements (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid references clients(id) on delete cascade,
  target_profile_id uuid references client_target_profile(id) on delete set null,
  title             text,
  hard_filters      jsonb not null default '{}',
  -- Additions beyond §8: the engine already derives the blend from these, but
  -- §9.5's rationale templates must be able to say "this req is ₹22k / same-day",
  -- and the §14.1 golden cases vary exactly these two numbers. Denormalised here
  -- so a requirement is self-describing without re-reading the intake payload.
  ticket_size       numeric,
  cycle_days        int,
  roleplay_pack     text check (roleplay_pack in ('fast','mid','considered')),
  status            text default 'open' check (status in ('open','filled','closed')),
  opened_at         timestamptz default now()
);

-- ═══ CANDIDATES ════════════════════════════════════════════════════════════

create table if not exists candidates (
  id               uuid primary key default gen_random_uuid(),
  full_name        text not null,
  contact          jsonb not null,
  direct_fields    jsonb,            -- §7.5 asked-not-tested fields
  consent_version  text not null,
  consent_at       timestamptz not null,
  last_activity_at timestamptz default now(),   -- C4 retention clock
  created_at       timestamptz default now()
);

-- Single-use signed token in URL, no account (§8 auth table).
-- Addition beyond §8's listing: §8 specifies the mechanism, not the storage.
create table if not exists assessment_tokens (
  token        text primary key,
  candidate_id uuid references candidates(id) on delete cascade,
  issued_at    timestamptz default now(),
  expires_at   timestamptz not null,
  consumed_at  timestamptz
);

create table if not exists assessment_sessions (
  id                  uuid primary key default gen_random_uuid(),
  candidate_id        uuid references candidates(id) on delete cascade,
  bank_version        text not null default '1.1',
  item_set            text[] not null,      -- exact set served (§7.3 rotation)
  started_at          timestamptz,
  completed_at        timestamptz,
  is_benchmark        boolean default false,
  benchmark_client_id uuid references clients(id) on delete set null,
  benchmark_kind      text check (benchmark_kind in ('employee','founder'))
);

-- RAW responses. Never overwritten — this is what makes scores recomputable
-- after a key change or a bank version bump (§7.2).
create table if not exists candidate_responses (
  session_id      uuid references assessment_sessions(id) on delete cascade,
  item_id         text references items(id),
  option_key      text not null,
  seconds_on_item numeric,
  position_shown  int,                  -- for the straightline flag
  answered_at     timestamptz default now(),
  primary key (session_id, item_id)
);

create table if not exists candidate_profile (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid references candidates(id) on delete cascade,
  session_id   uuid references assessment_sessions(id) on delete cascade,
  dict_version text not null default '2.1',
  bank_version text not null default '1.1',
  scores       jsonb not null,   -- exactly 9 keys. CLS_C and CLS_F separate.
  flags        text[],
  computed_at  timestamptz default now(),
  unique (session_id)
);

-- Guard the single most important invariant in the system (§7.2, §18):
-- a blended CLS must never be written into a candidate profile, because it
-- would make the candidate's score depend on whichever client they were
-- matched to first. The blend is computed per requirement, in the engine.
alter table candidate_profile drop constraint if exists candidate_profile_no_blended_cls;
alter table candidate_profile add constraint candidate_profile_no_blended_cls
  check (not (scores ? 'CLS'));

-- ═══ MATCHING ══════════════════════════════════════════════════════════════
-- NOTE: no `rejected`, no `status`, no `shortlisted` column. R3 / C9 are
-- enforced by the absence of a place to record a machine decision.

create table if not exists matches (
  id                    uuid primary key default gen_random_uuid(),
  requirement_id        uuid references requirements(id) on delete cascade,
  candidate_id          uuid references candidates(id) on delete cascade,
  cls_effective         numeric,
  quality_score         numeric,
  fit_score             numeric,
  composite             numeric,
  confidence_multiplier numeric,
  hard_filter_pass      boolean,
  hard_filter_fails     text[],           -- the failing filter is always named
  rationale             jsonb,            -- template-generated, §9.5
  attrition_risk_flag   boolean default false,
  frame_split_flag      boolean default false,   -- |CLS_C − CLS_F| >= 25
  computed_at           timestamptz default now(),
  unique (requirement_id, candidate_id)
);

create table if not exists supplements (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid references clients(id) on delete cascade,
  items      jsonb not null,     -- [{kind:'behavioural'|'technical', prompt:...}]
  created_at timestamptz default now()
);

create table if not exists supplement_responses (
  supplement_id uuid references supplements(id) on delete cascade,
  candidate_id  uuid references candidates(id) on delete cascade,
  payload       jsonb not null,
  score         numeric,          -- scored SEPARATELY. never merged into a profile.
  verdict       text check (verdict in ('pass','concern','fail')),
  note          text,
  primary key (supplement_id, candidate_id)
);

-- ═══ STEP 4 — VERIFICATION CALL ════════════════════════════════════════════

create table if not exists interviews (
  id                   uuid primary key default gen_random_uuid(),
  requirement_id       uuid references requirements(id) on delete cascade,
  candidate_id         uuid references candidates(id) on delete cascade,
  interviewer_id       uuid references staff(id) on delete set null,
  roleplay_pack        text check (roleplay_pack in ('fast','mid','considered')),
  predicted_ratings    jsonb,            -- §11.3 written BEFORE the call
  consent_to_record    boolean default false,   -- C11
  conducted_at         timestamptz default now(),
  ratings_submitted_at timestamptz,
  scores_revealed_at   timestamptz
);

-- §11.3 / playbook §2.1: the reveal gate. The playbook says "enforced in the
-- UI"; a UI check is a suggestion, so it is enforced here as well.
alter table interviews drop constraint if exists interviews_reveal_after_rating;
alter table interviews add constraint interviews_reveal_after_rating
  check (
    scores_revealed_at is null
    or (ratings_submitted_at is not null and scores_revealed_at >= ratings_submitted_at)
  );

create table if not exists interview_ratings (
  interview_id uuid references interviews(id) on delete cascade,
  element      text not null
               check (element in ('discovery','objections','close','composure','communication')),
  rating       int check (rating between 1 and 5),
  note         text,
  primary key (interview_id, element)
);

create table if not exists interview_technical (
  interview_id uuid references interviews(id) on delete cascade,
  element      text not null
               check (element in ('pipeline_math','metrics','systems','followup','objections','vertical')),
  rating       int check (rating between 1 and 5),
  note         text,
  primary key (interview_id, element)
);

create table if not exists interview_probes (
  interview_id   uuid references interviews(id) on delete cascade,
  dimension_code text references dimensions(code),
  probe_type     text check (probe_type in ('verify','concern','flag')),
  outcome        text check (outcome in ('corroborates','thin','contradicts')),
  note           text,
  primary key (interview_id, dimension_code, probe_type)
);

-- Playbook §5.4 — a contradiction between the profile and the technical block
-- is the cheapest early warning that an item is bad, long before n=30 statistics
-- would catch it. It only helps if it is recorded somewhere deliberate.
create table if not exists interview_contradictions (
  id             uuid primary key default gen_random_uuid(),
  interview_id   uuid references interviews(id) on delete cascade,
  dimension_code text references dimensions(code),
  item_id        text references items(id),
  description    text not null,
  resolved       boolean default false,
  resolution     text,          -- 'faked_response' | 'bad_item' | 'other'
  logged_at      timestamptz default now()
);

-- ═══ ITEM KEYING (PRD §13 — Phase 1 gate) ══════════════════════════════════
-- Three independent experts key all 28 SJT items blind, then reconcile.
create table if not exists keying_rounds (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  bank_version text not null default '1.1',
  open       boolean default true,
  created_at timestamptz default now()
);

create table if not exists keying_submissions (
  round_id   uuid references keying_rounds(id) on delete cascade,
  expert_id  uuid references staff(id) on delete cascade,
  item_id    text references items(id) on delete cascade,
  best_option_key text not null,
  worst_option_key text,
  note       text,
  submitted_at timestamptz default now(),
  primary key (round_id, expert_id, item_id)
);

-- ═══ FEEDBACK LOOP (built now, empty now — §12) ════════════════════════════

create table if not exists placements (
  id             uuid primary key default gen_random_uuid(),
  requirement_id uuid references requirements(id) on delete cascade,
  candidate_id   uuid references candidates(id) on delete cascade,
  match_id       uuid references matches(id) on delete set null,      -- prediction, frozen
  interview_id   uuid references interviews(id) on delete set null,
  joined_on      date not null
);

create table if not exists placement_outcomes (
  id                   uuid primary key default gen_random_uuid(),
  placement_id         uuid references placements(id) on delete cascade,
  checkpoint           text check (checkpoint in ('m3','m6','m12')),
  retained             boolean,
  exit_type            text check (exit_type in ('voluntary','involuntary','na')),
  exit_reason          text,
  days_to_first_close  int,
  quota_attainment_pct numeric,
  client_satisfaction  int check (client_satisfaction between 1 and 5),
  client_notes         text,
  -- THREE PREDICTORS, KEPT SEPARATE ON PURPOSE (§12, §18).
  -- Merging these is what makes "which of the three actually predicted
  -- retention?" unanswerable. Do not combine them into one column, ever.
  composite            numeric,   -- the engine
  interview_mean       numeric,   -- the role-play
  technical_mean       numeric,   -- the technical block
  recorded_at          timestamptz default now(),
  unique (placement_id, checkpoint)
);

-- ═══ MONITORING ════════════════════════════════════════════════════════════
-- Deliberately isolated. Its own RLS policy (08). NEVER joined to matches.
-- Building it this way is what makes it safe to collect at all (§8, §14.3).
create table if not exists monitoring_attributes (
  candidate_id uuid primary key references candidates(id) on delete cascade,
  gender       text,        -- voluntary, skippable
  age_band     text,
  region       text,
  collected_at timestamptz default now()
);

create table if not exists recruiter_decisions (
  requirement_id     uuid references requirements(id) on delete cascade,
  candidate_id       uuid references candidates(id) on delete cascade,
  engine_rank        int,
  recruiter_advanced boolean,
  recruiter_note     text,
  decided_by         uuid references staff(id) on delete set null,
  decided_at         timestamptz default now(),
  primary key (requirement_id, candidate_id)
);

-- ═══ INDEXES ═══════════════════════════════════════════════════════════════

create index if not exists idx_responses_session   on candidate_responses(session_id);
create index if not exists idx_sessions_candidate  on assessment_sessions(candidate_id);
create index if not exists idx_profile_candidate   on candidate_profile(candidate_id);
create index if not exists idx_matches_req         on matches(requirement_id);
create index if not exists idx_matches_candidate   on matches(candidate_id);
create index if not exists idx_matches_composite   on matches(requirement_id, composite desc);
create index if not exists idx_requirements_client on requirements(client_id);
create index if not exists idx_requirements_status on requirements(status) where status = 'open';
create index if not exists idx_items_dimension     on items(dimension_code) where active;
create index if not exists idx_candidates_activity on candidates(last_activity_at);

-- ═══ PARAM AUDIT TRIGGER ═══════════════════════════════════════════════════
-- §6.2: "Editable, versioned, audit-logged." Every parameter change is captured
-- so a shifted weight can always be traced to who moved it and when.

create or replace function audit_dimension_params() returns trigger as $$
begin
  insert into param_audit (table_name, row_key, old_value, new_value, changed_by)
  values (
    'dimension_params',
    coalesce(new.param_group, old.param_group) || '/' || coalesce(new.param_key, old.param_key),
    case when old is null then null else to_jsonb(old) end,
    case when new is null then null else to_jsonb(new) end,
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  );
  return coalesce(new, old);
end;
$$ language plpgsql;

drop trigger if exists trg_audit_dimension_params on dimension_params;
create trigger trg_audit_dimension_params
  after insert or update or delete on dimension_params
  for each row execute function audit_dimension_params();
