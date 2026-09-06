-- Migration 26: V10 — Closer daily reporting, dual-entry reconciliation,
--                     closer KPIs, per-client alert thresholds
--
-- Resolves the §24 source-of-truth question: the closer's own submission is
-- real data; a differing staff submission for the same slot is flagged
-- immediately rather than silently reconciled.
--
-- Additive. The only destructive act is replacing one UNIQUE constraint that
-- makes two-reports-per-day impossible, and dropping a view filter that hid
-- 17 of 20 clients.

-- ═══════════════════════════════════════════════════════════════════
-- PART A — Per-client alert thresholds (column first: the view below reads it)
-- ═══════════════════════════════════════════════════════════════════
alter table pravah_client_profiles
  add column if not exists sale_gap_alert_days integer not null default 4
    check (sale_gap_alert_days between 1 and 120);

comment on column pravah_client_profiles.sale_gap_alert_days is
  'Days without a sale before the client is flagged. Default 4. B2B cycles run longer than B2C. Admin-only.';

-- ═══════════════════════════════════════════════════════════════════
-- PART B — Client visibility gate removal
-- ═══════════════════════════════════════════════════════════════════
-- pravah_v_clients required a Vyom link OR placement OR check-in OR action.
-- Only 3 of 20 production clients passed, making the client edit / check-in /
-- archive / delete actions unreachable for the other 17. Sparse clients are
-- now listed and marked instead of hidden.
--
-- IMPORTANT: create or replace view can only APPEND columns — it cannot
-- reorder or rename existing ones (42P16). The first fifteen columns below
-- therefore match the live view exactly, in order, and the two new columns
-- are appended at the end.

create or replace view pravah_v_clients
with (security_invoker = true) as
select
  c.id,
  c.business_name,
  coalesce(cp.status, 'onboarding')  as status,
  coalesce(cp.health, 'unknown')     as health,
  cp.reporting_currency,
  cp.checkin_cadence,
  (select max(ci.occurred_at) from pravah_client_checkins ci where ci.client_id = c.id) as last_checkin_at,
  (select count(*) from pravah_training t
     where t.client_id = c.id and t.status = any(array['active','passed'])) as active_closers,
  (select count(*) from pravah_actions a
     where a.client_id = c.id and a.status <> all(array['done','cancelled'])) as open_actions,
  cp.notes,
  cp.client_visible_notes,
  cp.archived_at,
  cp.archive_reason,
  sync.source_client_id as vyom_client_id,
  case when sync.id is null then 'unlinked' else 'linked' end as vyom_link_status,
  -- appended columns start here
  cp.sale_gap_alert_days,
  -- replaces the old hard filter: sparse clients are visible but marked
  (sync.id is not null
    or exists (select 1 from requirements r join placements p on p.requirement_id = r.id where r.client_id = c.id)
    or exists (select 1 from pravah_client_checkins ci where ci.client_id = c.id)
    or exists (select 1 from pravah_actions a where a.client_id = c.id)
  ) as has_activity
from clients c
left join pravah_client_profiles cp on cp.client_id = c.id
left join pravah_client_sync_inbox sync on sync.linked_client_id = c.id and sync.status = 'linked'
where pravah_can_access_client(c.id);

-- ═══════════════════════════════════════════════════════════════════
-- PART C — Alert threshold write contract (admin-only)
-- ═══════════════════════════════════════════════════════════════════
create or replace function pravah_set_client_alert_thresholds(
  p_client_id           uuid,
  p_sale_gap_alert_days integer default null,
  p_checkin_cadence     text    default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- deliberately admin-only: staff cannot loosen their own alerting
  if not pravah_is_admin() then
    raise exception 'Only an administrator can change client alert thresholds';
  end if;
  if not exists (select 1 from clients where id = p_client_id) then
    raise exception 'Client not found';
  end if;

  insert into pravah_client_profiles (client_id) values (p_client_id)
  on conflict (client_id) do nothing;

  update pravah_client_profiles set
    sale_gap_alert_days = coalesce(p_sale_gap_alert_days, sale_gap_alert_days),
    checkin_cadence     = coalesce(p_checkin_cadence, checkin_cadence)
  where client_id = p_client_id;

  insert into pravah_audit_events (client_id, actor_uid, entity_type, entity_id, action, payload)
  values (p_client_id, auth.uid(), 'pravah_client_profiles', p_client_id::text,
          'alert_thresholds_updated',
          jsonb_build_object('sale_gap_alert_days', p_sale_gap_alert_days,
                             'checkin_cadence', p_checkin_cadence));
end;
$$;

revoke all on function pravah_set_client_alert_thresholds(uuid,integer,text) from public, anon;
grant execute on function pravah_set_client_alert_thresholds(uuid,integer,text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- PART D — Two reports per day, from two parties
-- ═══════════════════════════════════════════════════════════════════
-- UNIQUE (placement_id, period_start, period_end) allowed exactly one row per
-- placement per period. A midday and an EOD report share a date, and dual
-- entry doubles that again, so four legitimate rows collided on one key.

alter table pravah_performance_reports
  add column if not exists report_slot text not null default 'period'
    check (report_slot in ('midday','eod','period')),
  add column if not exists submitted_by_role text not null default 'staff'
    check (submitted_by_role in ('closer','staff')),
  add column if not exists submitted_at timestamptz not null default now(),
  add column if not exists discrepancy_status text not null default 'none'
    check (discrepancy_status in ('none','flagged','resolved')),
  add column if not exists discrepancy_detail jsonb not null default '{}'::jsonb,
  add column if not exists discrepancy_resolved_by uuid,
  add column if not exists discrepancy_resolved_at timestamptz,
  add column if not exists discrepancy_resolution_note text;

comment on column pravah_performance_reports.report_slot is
  'midday | eod for daily closer reports; period for the legacy weekly/ad-hoc staff report.';
comment on column pravah_performance_reports.submitted_by_role is
  'Who claimed these figures. Closer submissions are the source of truth (PRD 25.2).';

-- Existing rows keep their meaning: staff-submitted, whole-period.
update pravah_performance_reports
   set report_slot = 'period', submitted_by_role = 'staff'
 where report_slot is null or submitted_by_role is null;

alter table pravah_performance_reports
  drop constraint if exists pravah_performance_reports_placement_id_period_start_period_key;

create unique index if not exists uq_performance_reports_slot
  on pravah_performance_reports (placement_id, period_start, period_end, report_slot, submitted_by_role);

create index if not exists idx_performance_reports_discrepancy
  on pravah_performance_reports (discrepancy_status)
  where discrepancy_status = 'flagged';

-- ═══════════════════════════════════════════════════════════════════
-- PART E — Discrepancy detection, on write
-- ═══════════════════════════════════════════════════════════════════
-- Revenue must not carry contested values quietly, so comparison happens at
-- write time rather than on a schedule.

create or replace function pravah_check_report_discrepancy()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_other  pravah_performance_reports%rowtype;
  v_diff   jsonb := '{}'::jsonb;
begin
  if new.report_slot = 'period' then return new; end if;

  select * into v_other
    from pravah_performance_reports
   where placement_id      = new.placement_id
     and period_start      = new.period_start
     and period_end        = new.period_end
     and report_slot       = new.report_slot
     and submitted_by_role = case when new.submitted_by_role = 'closer' then 'staff' else 'closer' end
     and voided_at is null
   limit 1;

  if not found then return new; end if;

  if coalesce(new.sales_count,-1) is distinct from coalesce(v_other.sales_count,-1) then
    v_diff := v_diff || jsonb_build_object('sales_count',
      jsonb_build_object('closer', case when new.submitted_by_role='closer' then new.sales_count else v_other.sales_count end,
                         'staff',  case when new.submitted_by_role='staff'  then new.sales_count else v_other.sales_count end));
  end if;
  if coalesce(new.cash_collected,-1) is distinct from coalesce(v_other.cash_collected,-1) then
    v_diff := v_diff || jsonb_build_object('cash_collected',
      jsonb_build_object('closer', case when new.submitted_by_role='closer' then new.cash_collected else v_other.cash_collected end,
                         'staff',  case when new.submitted_by_role='staff'  then new.cash_collected else v_other.cash_collected end));
  end if;
  if coalesce(new.revenue_generated,-1) is distinct from coalesce(v_other.revenue_generated,-1) then
    v_diff := v_diff || jsonb_build_object('revenue_generated',
      jsonb_build_object('closer', case when new.submitted_by_role='closer' then new.revenue_generated else v_other.revenue_generated end,
                         'staff',  case when new.submitted_by_role='staff'  then new.revenue_generated else v_other.revenue_generated end));
  end if;

  if v_diff = '{}'::jsonb then
    -- agreement: clear any flag previously raised on this pair
    new.discrepancy_status := 'none';
    new.discrepancy_detail := '{}'::jsonb;
    update pravah_performance_reports
       set discrepancy_status='none', discrepancy_detail='{}'::jsonb
     where id = v_other.id and discrepancy_status = 'flagged';
    return new;
  end if;

  new.discrepancy_status := 'flagged';
  new.discrepancy_detail := v_diff;

  update pravah_performance_reports
     set discrepancy_status = 'flagged', discrepancy_detail = v_diff
   where id = v_other.id;

  insert into pravah_audit_events (client_id, actor_uid, entity_type, entity_id, action, payload)
  values (new.client_id, auth.uid(), 'pravah_performance_reports', new.id::text,
          'report_discrepancy_flagged',
          jsonb_build_object('slot', new.report_slot, 'date', new.period_start, 'diff', v_diff));

  return new;
end;
$$;

drop trigger if exists trg_report_discrepancy on pravah_performance_reports;
create trigger trg_report_discrepancy
  before insert or update of sales_count, cash_collected, revenue_generated
  on pravah_performance_reports
  for each row execute function pravah_check_report_discrepancy();

create or replace function pravah_resolve_report_discrepancy(
  p_report_id uuid,
  p_accepted  text,          -- 'closer' | 'staff'
  p_note      text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_rep pravah_performance_reports%rowtype;
begin
  if not pravah_is_internal() then raise exception 'Internal access required'; end if;
  if p_accepted not in ('closer','staff') then raise exception 'Accepted figure must be closer or staff'; end if;
  if coalesce(trim(p_note),'') = '' then raise exception 'A resolution note is required'; end if;

  select * into v_rep from pravah_performance_reports where id = p_report_id;
  if not found then raise exception 'Report not found'; end if;

  -- both sides of the pair are marked resolved; neither original row is edited
  update pravah_performance_reports
     set discrepancy_status = 'resolved',
         discrepancy_resolved_by = auth.uid(),
         discrepancy_resolved_at = now(),
         discrepancy_resolution_note = p_note
   where placement_id = v_rep.placement_id
     and period_start = v_rep.period_start
     and period_end   = v_rep.period_end
     and report_slot  = v_rep.report_slot
     and discrepancy_status = 'flagged';

  insert into pravah_audit_events (client_id, actor_uid, entity_type, entity_id, action, payload)
  values (v_rep.client_id, auth.uid(), 'pravah_performance_reports', p_report_id::text,
          'report_discrepancy_resolved',
          jsonb_build_object('accepted', p_accepted, 'note', p_note));
end;
$$;

revoke all on function pravah_resolve_report_discrepancy(uuid,text,text) from public, anon;
grant execute on function pravah_resolve_report_discrepancy(uuid,text,text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- PART F — Closer-side submission
-- ═══════════════════════════════════════════════════════════════════
-- placement -> client resolver (suffixed to avoid clashing with the V1 helper)
create or replace function pravah_placement_client_id_v10(p_placement_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select r.client_id from placements p
    join requirements r on r.id = p.requirement_id
   where p.id = p_placement_id;
$$;

create or replace function pravah_closer_submit_report(
  p_report_slot             text,
  p_report_date             date    default current_date,
  p_calls_attempted         integer default null,
  p_connected_calls         integer default null,
  p_qualified_opportunities integer default null,
  p_meetings_booked         integer default null,
  p_followups_completed     integer default null,
  p_sales_count             integer default null,
  p_revenue_generated       numeric default null,
  p_cash_collected          numeric default null,
  p_pipeline_value          numeric default null,
  p_currency                text    default 'INR',
  p_blocker                 text    default null,
  p_support_required        text    default null,
  p_next_period_plan        text    default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_placement uuid;
  v_client    uuid;
  v_id        uuid;
begin
  if p_report_slot not in ('midday','eod') then
    raise exception 'Report slot must be midday or eod';
  end if;

  -- the closer may only ever report on their own placement
  select m.placement_id into v_placement
    from pravah_memberships m
   where m.auth_uid = auth.uid() and m.active
     and m.role = 'closer' and m.placement_id is not null
   limit 1;
  if v_placement is null then raise exception 'Not an active closer'; end if;

  v_client := pravah_placement_client_id_v10(v_placement);
  if v_client is null then raise exception 'Placement is not linked to a client'; end if;

  -- a closer cannot backdate beyond yesterday, nor report the future
  if p_report_date > current_date then raise exception 'Cannot report a future date'; end if;
  if p_report_date < current_date - 1 then
    raise exception 'Reports older than yesterday must be entered by staff';
  end if;

  insert into pravah_performance_reports (
    placement_id, client_id, period_start, period_end,
    report_slot, submitted_by_role, submitted_at,
    calls_attempted, connected_calls, qualified_opportunities, meetings_booked,
    followups_completed, sales_count, revenue_generated, cash_collected,
    pipeline_value, currency, blocker, support_required, next_period_plan,
    source_type, created_by
  ) values (
    v_placement, v_client, p_report_date, p_report_date,
    p_report_slot, 'closer', now(),
    p_calls_attempted, p_connected_calls, p_qualified_opportunities, p_meetings_booked,
    p_followups_completed, p_sales_count, p_revenue_generated, p_cash_collected,
    p_pipeline_value, coalesce(p_currency,'INR'), p_blocker, p_support_required, p_next_period_plan,
    'manual', auth.uid()
  )
  on conflict (placement_id, period_start, period_end, report_slot, submitted_by_role)
  do update set
    calls_attempted         = excluded.calls_attempted,
    connected_calls         = excluded.connected_calls,
    qualified_opportunities = excluded.qualified_opportunities,
    meetings_booked         = excluded.meetings_booked,
    followups_completed     = excluded.followups_completed,
    sales_count             = excluded.sales_count,
    revenue_generated       = excluded.revenue_generated,
    cash_collected          = excluded.cash_collected,
    pipeline_value          = excluded.pipeline_value,
    blocker                 = excluded.blocker,
    support_required        = excluded.support_required,
    next_period_plan        = excluded.next_period_plan,
    submitted_at            = now(),
    updated_at              = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function pravah_closer_submit_report(text,date,integer,integer,integer,integer,integer,integer,numeric,numeric,numeric,text,text,text,text) from public, anon;
revoke all on function pravah_placement_client_id_v10(uuid) from public, anon;
grant execute on function pravah_closer_submit_report(text,date,integer,integer,integer,integer,integer,integer,numeric,numeric,numeric,text,text,text,text) to authenticated;
grant execute on function pravah_placement_client_id_v10(uuid) to authenticated;

-- closers read their own report history
drop policy if exists pravah_reports_closer_own_read on pravah_performance_reports;
create policy pravah_reports_closer_own_read on pravah_performance_reports
  for select using (placement_id in (select pravah_my_visible_placement_ids()));

-- ═══════════════════════════════════════════════════════════════════
-- PART G — Closer KPIs, scoped so the staff model is untouched
-- ═══════════════════════════════════════════════════════════════════
alter table pravah_kra_definitions
  add column if not exists subject text not null default 'staff'
    check (subject in ('staff','closer'));
alter table pravah_kpi_definitions
  add column if not exists subject text not null default 'staff'
    check (subject in ('staff','closer'));

-- scorecards can now belong to a placement instead of a staff member
alter table pravah_scorecards
  add column if not exists placement_id uuid references placements(id) on delete cascade,
  add column if not exists subject text not null default 'staff'
    check (subject in ('staff','closer'));

alter table pravah_scorecards alter column staff_uid drop not null;

alter table pravah_scorecards drop constraint if exists pravah_scorecards_subject_target_check;
alter table pravah_scorecards add constraint pravah_scorecards_subject_target_check
  check ((subject = 'staff'  and staff_uid is not null and placement_id is null)
      or (subject = 'closer' and placement_id is not null and staff_uid is null));

-- The existing UNIQUE (staff_uid, period_start, period_end) no longer covers
-- closer rows: their staff_uid is null, and Postgres treats nulls as distinct,
-- so it would permit unlimited duplicate closer scorecards for one period.
create unique index if not exists uq_scorecards_closer_period
  on pravah_scorecards (placement_id, period_start, period_end)
  where placement_id is not null;

-- KRA codes are unique, so closer KRAs carry a cl_ prefix
insert into pravah_kra_definitions (code, name, weight_pct, description, active, sort_order, subject) values
  ('cl_activity',   'Activity',   30.00, 'Dial volume and connect quality against target.',      true, 1, 'closer'),
  ('cl_pipeline',   'Pipeline',   20.00, 'Qualified opportunities and meetings created.',        true, 2, 'closer'),
  ('cl_revenue',    'Revenue',    35.00, 'Sales closed and cash collected against target.',      true, 3, 'closer'),
  ('cl_discipline', 'Discipline', 15.00, 'Both daily reports submitted, on time and complete.',  true, 4, 'closer')
on conflict (code) do nothing;

insert into pravah_kpi_definitions
  (kra_code, code, name, description, weight_pct, target_value, target_unit, direction, data_source, formula, active, sort_order, subject) values
  ('cl_activity','CA-1','Call target attainment','Calls attempted against the period target.',
     60.00, 100, 'percent','higher_is_better','performance_reports + targets',
     'sum(calls_attempted) / target_value * 100', true, 1, 'closer'),
  ('cl_activity','CA-2','Connect rate','Connected calls as a share of calls attempted.',
     40.00, 35, 'percent','higher_is_better','performance_reports',
     'sum(connected_calls) / nullif(sum(calls_attempted),0) * 100', true, 2, 'closer'),

  ('cl_pipeline','CP-1','Qualified opportunities','Qualified opportunities created in the period.',
     60.00, 100, 'percent','higher_is_better','performance_reports',
     'sum(qualified_opportunities) vs target', true, 1, 'closer'),
  ('cl_pipeline','CP-2','Meetings booked','Meetings booked in the period.',
     40.00, 100, 'percent','higher_is_better','performance_reports',
     'sum(meetings_booked) vs target', true, 2, 'closer'),

  ('cl_revenue','CR-1','Sales target attainment','Sales closed against the period target.',
     50.00, 100, 'percent','higher_is_better','performance_reports + targets',
     'sum(sales_count) / target_value * 100', true, 1, 'closer'),
  ('cl_revenue','CR-2','Cash collection attainment','Cash collected against the period target.',
     50.00, 100, 'percent','higher_is_better','performance_reports + targets',
     'sum(cash_collected) / target_value * 100', true, 2, 'closer'),

  ('cl_discipline','CD-1','Report submission rate','Both slots submitted on each working day.',
     60.00, 100, 'percent','higher_is_better','performance_reports',
     'submitted_slots / (working_days * 2) * 100', true, 1, 'closer'),
  ('cl_discipline','CD-2','Report completeness','Core figures present on submitted reports.',
     40.00, 100, 'percent','higher_is_better','performance_reports',
     'complete_reports / submitted_reports * 100', true, 2, 'closer')
on conflict (code) do nothing;

-- ═══════════════════════════════════════════════════════════════════
-- PART H — Closer scorecard
-- ═══════════════════════════════════════════════════════════════════
create or replace function pravah_closer_scorecard(
  p_placement_id uuid default null,
  p_period_start date default null,
  p_period_end   date default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_placement uuid := p_placement_id;
  v_start date := coalesce(p_period_start, date_trunc('month', current_date)::date);
  v_end   date := coalesce(p_period_end, current_date);
  v_target numeric;
  v_calls bigint; v_conn bigint; v_qual bigint; v_meet bigint;
  v_sales bigint; v_cash numeric;
  v_slots bigint; v_complete bigint; v_days int;
  v_kras jsonb := '[]'::jsonb;
  v_overall numeric := 0;
  s_act numeric; s_pipe numeric; s_rev numeric; s_disc numeric;
begin
  -- a closer may only read their own scorecard; internal staff may read any
  if v_placement is null then
    select m.placement_id into v_placement from pravah_memberships m
     where m.auth_uid = auth.uid() and m.active and m.role = 'closer' limit 1;
  end if;
  if v_placement is null then raise exception 'No placement resolved'; end if;
  if not (pravah_is_internal()
          or v_placement in (select pravah_my_visible_placement_ids())) then
    raise exception 'Access denied for this placement';
  end if;

  -- closer submissions are the source of truth (PRD 25.2)
  select coalesce(sum(calls_attempted),0), coalesce(sum(connected_calls),0),
         coalesce(sum(qualified_opportunities),0), coalesce(sum(meetings_booked),0),
         coalesce(sum(sales_count),0), coalesce(sum(cash_collected),0),
         count(*),
         count(*) filter (where calls_attempted is not null and sales_count is not null and cash_collected is not null)
    into v_calls, v_conn, v_qual, v_meet, v_sales, v_cash, v_slots, v_complete
    from pravah_performance_reports
   where placement_id = v_placement
     and period_start between v_start and v_end
     and submitted_by_role = 'closer'
     and report_slot in ('midday','eod')
     and voided_at is null;

  select sum(target_value) into v_target from pravah_targets
   where placement_id = v_placement and period_start >= v_start and period_end <= v_end;

  v_days := greatest(1, (v_end - v_start) + 1);

  s_act  := round(coalesce(
              (case when v_target > 0 then least(120, v_calls / v_target * 100) else null end) * 0.6
            + (case when v_calls > 0 then least(120, v_conn::numeric / v_calls * 100 / 35 * 100) else null end) * 0.4
            , 0)::numeric, 1);
  s_pipe := round((least(120, v_qual) * 0.6 + least(120, v_meet) * 0.4)::numeric, 1);
  s_rev  := round(coalesce(
              (case when v_target > 0 then least(120, v_sales / v_target * 100) else null end) * 0.5
            + (case when v_target > 0 then least(120, v_cash  / v_target * 100) else null end) * 0.5
            , 0)::numeric, 1);
  s_disc := round((least(120, v_slots::numeric / (v_days * 2) * 100) * 0.6
                 + case when v_slots > 0 then least(120, v_complete::numeric / v_slots * 100) else 0 end * 0.4)::numeric, 1);

  v_overall := round((s_act * 0.30 + s_pipe * 0.20 + s_rev * 0.35 + s_disc * 0.15)::numeric, 1);

  v_kras := jsonb_build_array(
    jsonb_build_object('code','cl_activity','name','Activity','weight_pct',30,'score',s_act,
      'detail', jsonb_build_object('calls_attempted',v_calls,'connected_calls',v_conn,'target',v_target)),
    jsonb_build_object('code','cl_pipeline','name','Pipeline','weight_pct',20,'score',s_pipe,
      'detail', jsonb_build_object('qualified_opportunities',v_qual,'meetings_booked',v_meet)),
    jsonb_build_object('code','cl_revenue','name','Revenue','weight_pct',35,'score',s_rev,
      'detail', jsonb_build_object('sales_count',v_sales,'cash_collected',v_cash,'target',v_target)),
    jsonb_build_object('code','cl_discipline','name','Discipline','weight_pct',15,'score',s_disc,
      'detail', jsonb_build_object('slots_submitted',v_slots,'slots_expected',v_days*2,'complete',v_complete))
  );

  return jsonb_build_object(
    'placement_id', v_placement,
    'period', jsonb_build_object('start', v_start, 'end', v_end),
    'overall_score', v_overall,
    'target_value', v_target,
    'kras', v_kras,
    'data_warnings', case when v_target is null
      then jsonb_build_array('No target set for this period — attainment KPIs cannot be scored.')
      else '[]'::jsonb end
  );
end;
$$;

revoke all on function pravah_closer_scorecard(uuid,date,date) from public, anon;
grant execute on function pravah_closer_scorecard(uuid,date,date) to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- PART I — Attention queue additions
-- ═══════════════════════════════════════════════════════════════════
create or replace view pravah_v_revenue_alerts
with (security_invoker = true) as
-- flagged revenue discrepancies
select
  'revenue_discrepancy'::text as alert_type,
  'critical'::text            as severity,
  r.client_id,
  c.business_name,
  r.placement_id,
  r.period_start              as alert_date,
  ('Closer and staff figures disagree for the ' || r.report_slot || ' report') as reason,
  r.discrepancy_detail        as detail
from pravah_performance_reports r
join clients c on c.id = r.client_id
where r.discrepancy_status = 'flagged' and r.voided_at is null
  and r.submitted_by_role = 'closer'

union all

-- clients with no sale inside their own configured window
select
  'sale_gap', 'warning', c.id, c.business_name, null::uuid,
  current_date,
  ('No sale in ' || coalesce(cp.sale_gap_alert_days,4) || ' days'),
  jsonb_build_object('threshold_days', coalesce(cp.sale_gap_alert_days,4),
                     'last_sale_date', (select max(s.sale_date) from pravah_revenue_sales s where s.client_id = c.id))
from clients c
left join pravah_client_profiles cp on cp.client_id = c.id
where cp.archived_at is null
  and exists (select 1 from pravah_training t where t.client_id = c.id and t.status = any(array['active','passed']))
  and coalesce((select max(s.sale_date) from pravah_revenue_sales s where s.client_id = c.id),
               current_date - 3650)
      < current_date - coalesce(cp.sale_gap_alert_days, 4)

union all

-- cash reported by a closer but never verified by staff
select
  'unverified_cash', 'warning', r.client_id, c.business_name, r.placement_id,
  r.period_start,
  ('Cash reported but unverified for ' || (current_date - r.period_start) || ' days'),
  jsonb_build_object('cash_collected', r.cash_collected, 'slot', r.report_slot)
from pravah_performance_reports r
join clients c on c.id = r.client_id
where r.cash_collected > 0
  and r.cash_verification_status = 'unverified'
  and r.voided_at is null
  and r.period_start < current_date - 2;

grant select on pravah_v_revenue_alerts to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- Verification
-- ═══════════════════════════════════════════════════════════════════
-- select count(*) from pravah_v_clients;                       -- expect all accessible clients
-- select code, subject, weight_pct from pravah_kra_definitions order by subject, sort_order;
-- select * from pravah_v_revenue_alerts;
