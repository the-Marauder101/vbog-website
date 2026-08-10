-- VBOG PM Tool — Slack channels + daily activity reports
-- Run in Supabase SQL Editor after 01–14. Idempotent.
--
-- Two things ship here:
--   1. slack_channels — a registry of Slack incoming-webhook URLs, managed from
--      Settings. The ONLY place a Slack URL is ever typed, the same way `tags`
--      is the only place a tag name is created. Every current and future Slack
--      message picks a channel from here, so adding one is configuration, not
--      code, and rotating a URL is one edit instead of a hunt.
--   2. daily_report_configs / daily_report_runs — one configurable report per
--      board (like hr_sla_rules), posted on a schedule: who added how many
--      cards and into which stage, who moved what, and where the pipeline
--      stands. Every run's numbers are stored, so "vs yesterday" is a lookup
--      and week-over-week never needs a backfill.
--
-- The data source is task_changelog (sql/14): `field = 'status'` alone is a
-- card's whole stage history — 'created' rows carry the opening stage,
-- 'updated' rows carry from → to.

-- ---------------------------------------------------------------------------
-- 1. Supporting index (not new behaviour — a gap found while building this)
-- ---------------------------------------------------------------------------
-- `tasks` had only its primary key, so every query that filters by project —
-- each board load, All Tasks, and this report's pipeline snapshot — scanned the
-- whole table. Invisible at a few hundred rows, painful at a few thousand.
CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id);

-- ---------------------------------------------------------------------------
-- 2. Slack channel registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS slack_channels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL UNIQUE,   -- what every dropdown shows, e.g. "#hiring-updates"
  url        text NOT NULL,          -- Slack incoming webhook; the secret is the URL
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE slack_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open" ON slack_channels;
CREATE POLICY "open" ON slack_channels FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 3. Report configuration — one row per report, scoped to one board
-- ---------------------------------------------------------------------------
-- send_time is a `time` plus a separate `timezone`, never a timestamptz: it is
-- a wall-clock intention ("19:00"), and that pairing is what keeps it correct
-- across daylight-saving changes forever.
CREATE TABLE IF NOT EXISTS daily_report_configs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  channel_id             uuid NOT NULL REFERENCES slack_channels(id) ON DELETE RESTRICT,
  label                  text NOT NULL DEFAULT 'Daily report',
  scope                  text NOT NULL DEFAULT 'both'
                           CHECK (scope IN ('hiring', 'ops', 'both')),
  send_time              time NOT NULL DEFAULT '19:00',
  timezone               text NOT NULL DEFAULT 'Asia/Kolkata',
  days_of_week           int[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',  -- ISO: 1=Mon … 7=Sun
  include_added          boolean NOT NULL DEFAULT true,
  include_moved          boolean NOT NULL DEFAULT true,
  include_snapshot       boolean NOT NULL DEFAULT true,
  include_clients        boolean NOT NULL DEFAULT false,  -- break down by tasks.fields.client
  include_machine_actors boolean NOT NULL DEFAULT false,  -- count Zapier/API/automation writes
  send_when_empty        boolean NOT NULL DEFAULT true,
  active                 boolean NOT NULL DEFAULT true,
  last_sent_on           date,        -- LOCAL date of the last real send: the double-send guard
  last_error             text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS daily_report_configs_project_idx
  ON daily_report_configs(project_id);

ALTER TABLE daily_report_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open" ON daily_report_configs;
CREATE POLICY "open" ON daily_report_configs FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 4. Run history — the trend series
-- ---------------------------------------------------------------------------
-- config_id/project_id are ON DELETE SET NULL, deliberately unlike most of this
-- schema: deleting a project must not vaporise months of history. project_name
-- is the readable snapshot, the same trick task_changelog.task_title uses.
CREATE TABLE IF NOT EXISTS daily_report_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id    uuid REFERENCES daily_report_configs(id) ON DELETE SET NULL,
  project_id   uuid REFERENCES projects(id) ON DELETE SET NULL,
  project_name text,
  local_date   date NOT NULL,     -- the day the report is ABOUT, in the config's timezone
  timezone     text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end   timestamptz NOT NULL,
  scope        text NOT NULL,
  added_total  int NOT NULL DEFAULT 0,
  moved_total  int NOT NULL DEFAULT 0,
  actor_count  int NOT NULL DEFAULT 0,
  metrics      jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL CHECK (status IN ('sent', 'skipped_empty', 'failed', 'test')),
  error        text,
  request_id   bigint,            -- pg_net id, for reconciling against net._http_response
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One real run per config per local day. This is what makes double-sending
-- impossible even if two scheduler ticks overlap; 'test' rows are excluded so
-- the test button never refuses a second click.
CREATE UNIQUE INDEX IF NOT EXISTS daily_report_runs_once_idx
  ON daily_report_runs(config_id, local_date) WHERE status <> 'test';
CREATE INDEX IF NOT EXISTS daily_report_runs_project_idx
  ON daily_report_runs(project_id, local_date DESC);

ALTER TABLE daily_report_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open" ON daily_report_runs;
CREATE POLICY "open" ON daily_report_runs FOR ALL USING (true) WITH CHECK (true);

-- Written by the scheduler only. This is the trend series: a forged or deleted
-- row silently corrupts every comparison built on it. Same reasoning as
-- task_changelog in sql/14 — don't grant these back.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON daily_report_runs FROM anon, authenticated;
GRANT SELECT ON daily_report_runs TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Validation — fail at configure time, not at 19:00 when nobody is watching
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_slack_channel()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.url !~* '^https://' THEN
    RAISE EXCEPTION 'slack webhook url must start with https://';
  END IF;
  NEW.label := btrim(NEW.label);
  IF NEW.label = '' THEN
    RAISE EXCEPTION 'channel name is required';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS slack_channels_validate ON slack_channels;
CREATE TRIGGER slack_channels_validate
BEFORE INSERT OR UPDATE ON slack_channels
FOR EACH ROW EXECUTE FUNCTION validate_slack_channel();

CREATE OR REPLACE FUNCTION validate_daily_report_config()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local timestamp;
BEGIN
  BEGIN
    v_local := now() AT TIME ZONE NEW.timezone;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'unknown timezone: %', NEW.timezone;
  END;

  IF array_length(NEW.days_of_week, 1) IS NULL THEN
    RAISE EXCEPTION 'pick at least one day of the week';
  END IF;

  -- A report set up at 20:30 with a 19:00 send time must not fire five minutes
  -- later for a day nobody was measuring. Claim today as already sent.
  IF TG_OP = 'INSERT' AND NEW.last_sent_on IS NULL AND v_local::time >= NEW.send_time THEN
    NEW.last_sent_on := v_local::date;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS daily_report_configs_validate ON daily_report_configs;
CREATE TRIGGER daily_report_configs_validate
BEFORE INSERT OR UPDATE ON daily_report_configs
FOR EACH ROW EXECUTE FUNCTION validate_daily_report_config();

-- ---------------------------------------------------------------------------
-- 6. The aggregation
-- ---------------------------------------------------------------------------
-- Two traps this function exists to get right:
--
-- (a) Machine actors are filtered BY NAME, never by `actor_id IS NULL`.
--     actor_id is ON DELETE SET NULL against team_members, so deleting a
--     departed employee nulls their id while leaving their real name — an
--     id-based filter would quietly reclassify a person's work as automation.
--
-- (b) hr_category is not in the change log; it lives on tasks.fields. task_id
--     is ON DELETE SET NULL, so a card created and deleted the same day loses
--     that join. Orphans fall back to the status name's home list.
CREATE OR REPLACE FUNCTION daily_report_metrics(
  p_project_id      uuid,
  p_from            timestamptz,
  p_to              timestamptz,
  p_scope           text    DEFAULT 'both',
  p_include_machine boolean DEFAULT false
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hiring text[];
  v_ops    text[];
  v_tabs   boolean;
  v_out    jsonb;
BEGIN
  SELECT COALESCE(ARRAY(SELECT jsonb_array_elements_text(p.statuses)), '{}'::text[]),
         COALESCE(ARRAY(SELECT jsonb_array_elements_text(p.ops_statuses)), '{}'::text[]),
         (p.type = 'hr' AND COALESCE((p.features->>'board_tabs')::boolean, true))
    INTO v_hiring, v_ops, v_tabs
    FROM projects p
   WHERE p.id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found';
  END IF;

  RETURN (
    WITH ev AS (
      SELECT
        COALESCE(c.actor_name, 'Unknown') AS actor_name,
        c.action,
        c.old_value,
        c.new_value,
        COALESCE(t.fields->>'client', '')  AS client,
        CASE
          WHEN NOT v_tabs       THEN 'candidate'
          WHEN t.id IS NOT NULL THEN
            CASE WHEN t.fields->>'hr_category' = 'ops' THEN 'ops' ELSE 'candidate' END
          WHEN COALESCE(c.new_value, c.old_value) = ANY (v_ops)
           AND NOT (COALESCE(c.new_value, c.old_value) = ANY (v_hiring)) THEN 'ops'
          ELSE 'candidate'
        END AS cat
      FROM task_changelog c
      LEFT JOIN tasks t ON t.id = c.task_id
      WHERE c.project_id  = p_project_id
        AND c.field       = 'status'
        AND c.created_at >= p_from
        AND c.created_at  < p_to
        AND c.action IN ('created', 'updated')
        AND (p_include_machine
             OR COALESCE(c.actor_name, 'Unknown')
                NOT IN ('Automation', 'Vyom API', 'Zapier', 'Unknown'))
    ),
    filt AS (
      SELECT * FROM ev
      WHERE p_scope = 'both'
         OR cat = CASE WHEN p_scope = 'ops' THEN 'ops' ELSE 'candidate' END
    ),
    added AS (
      SELECT cat, actor_name, new_value AS stage, count(*)::int AS n
      FROM filt WHERE action = 'created' AND new_value IS NOT NULL
      GROUP BY 1, 2, 3
    ),
    moved AS (
      SELECT cat, actor_name, old_value AS from_stage, new_value AS to_stage, count(*)::int AS n
      FROM filt WHERE action = 'updated' AND old_value IS DISTINCT FROM new_value
      GROUP BY 1, 2, 3, 4
    ),
    clients AS (
      SELECT cat, client, count(*)::int AS n
      FROM filt WHERE client <> ''
      GROUP BY 1, 2
    ),
    snap AS (
      SELECT
        CASE WHEN v_tabs AND t.fields->>'hr_category' = 'ops' THEN 'ops' ELSE 'candidate' END AS cat,
        t.status,
        count(*)::int AS n
      FROM tasks t
      WHERE t.project_id = p_project_id
      GROUP BY 1, 2
    )
    SELECT jsonb_build_object(
      'added', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'cat', cat, 'actor', actor_name, 'stage', stage, 'n', n)
                 ORDER BY cat, n DESC, actor_name) FROM added), '[]'::jsonb),
      'moved', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'cat', cat, 'actor', actor_name, 'from', from_stage, 'to', to_stage, 'n', n)
                 ORDER BY cat, n DESC, actor_name) FROM moved), '[]'::jsonb),
      'clients', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'cat', cat, 'client', client, 'n', n) ORDER BY n DESC) FROM clients), '[]'::jsonb),
      'snapshot', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'cat', cat, 'stage', status, 'n', n)) FROM snap), '[]'::jsonb),
      'added_total', COALESCE((SELECT sum(n) FROM added), 0),
      'moved_total', COALESCE((SELECT sum(n) FROM moved), 0),
      'actor_count', (SELECT count(DISTINCT actor_name) FROM filt),
      'statuses',     to_jsonb(v_hiring),
      'ops_statuses', to_jsonb(v_ops),
      'has_tabs',     v_tabs
    )
  );
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 7. Rendering
-- ---------------------------------------------------------------------------
-- Slack treats <…> as a link and &/< /> as entities, so every interpolated
-- name is escaped — the SQL-side equivalent of the UI.esc() rule (handbook §5.5).
CREATE OR REPLACE FUNCTION slack_esc(p_text text)
RETURNS text
AS $$
  SELECT replace(replace(replace(COALESCE(p_text, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
$$ LANGUAGE sql IMMUTABLE;

-- Pure: metrics in, message text out. No I/O, so a test send and a real send
-- can never render differently, and the preview in the UI is the same code.
-- On an HR board with tabs, candidates and Ops work get their own sections —
-- mixing "To Do" into a hiring breakdown reads as noise.
CREATE OR REPLACE FUNCTION daily_report_text(
  p_project_name text,
  p_metrics      jsonb,
  p_prev         jsonb,
  p_local_date   date,
  p_timezone     text,
  p_cfg          daily_report_configs
)
RETURNS text
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out   text;
  v_body  text;
  v_added int := COALESCE((p_metrics->>'added_total')::int, 0);
  v_moved int := COALESCE((p_metrics->>'moved_total')::int, 0);
  v_tabs  boolean := COALESCE((p_metrics->>'has_tabs')::boolean, false);
  v_split boolean;
  v_cat   text;
  v_cats  text[];
  v_noun  text;
  v_n     int;
  v_pa    int;
  v_pm    int;
BEGIN
  v_out := format('*%s — Daily report*', slack_esc(p_project_name));

  -- Which categories get their own section. Every block below filters to the
  -- category it renders, so a 'hiring' report can never leak an Ops column
  -- into its pipeline snapshot (the snapshot is a full board count by design).
  v_split := v_tabs AND p_cfg.scope = 'both';
  v_cats  := CASE WHEN v_split THEN ARRAY['candidate', 'ops']
                  WHEN p_cfg.scope = 'ops' THEN ARRAY['ops']
                  ELSE ARRAY['candidate'] END;

  IF v_added = 0 AND v_moved = 0 THEN
    v_out := v_out || E'\n\nNo cards were added or moved today.';
  END IF;

  FOREACH v_cat IN ARRAY v_cats LOOP
    v_noun := CASE WHEN NOT v_tabs THEN 'Cards'
                   WHEN v_cat = 'ops' THEN 'Ops tasks'
                   ELSE 'Candidates' END;

    -- Added, grouped by person, biggest contributor first — that is what the
    -- report is for — each with their stage breakdown.
    IF p_cfg.include_added THEN
      SELECT string_agg(line, E'\n' ORDER BY total DESC, actor), sum(total)
        INTO v_body, v_n
        FROM (
          SELECT a->>'actor' AS actor,
                 sum((a->>'n')::int) AS total,
                 format('• *%s* — %s · %s',
                   slack_esc(a->>'actor'),
                   sum((a->>'n')::int),
                   string_agg(format('%s %s', slack_esc(a->>'stage'), a->>'n'), ', '
                              ORDER BY (a->>'n')::int DESC)) AS line
            FROM jsonb_array_elements(p_metrics->'added') a
           WHERE a->>'cat' = v_cat
           GROUP BY a->>'actor'
        ) s;
      IF v_body IS NOT NULL THEN
        v_out := v_out || format(E'\n\n*%s added — %s*\n%s', v_noun, v_n, v_body);
      END IF;
    END IF;

    IF p_cfg.include_moved THEN
      SELECT string_agg(line, E'\n' ORDER BY total DESC, actor), sum(total)
        INTO v_body, v_n
        FROM (
          SELECT m->>'actor' AS actor,
                 sum((m->>'n')::int) AS total,
                 format('• *%s* — %s · %s',
                   slack_esc(m->>'actor'),
                   sum((m->>'n')::int),
                   string_agg(format('%s → %s %s',
                     slack_esc(m->>'from'), slack_esc(m->>'to'), m->>'n'), ', '
                     ORDER BY (m->>'n')::int DESC)) AS line
            FROM jsonb_array_elements(p_metrics->'moved') m
           WHERE m->>'cat' = v_cat
           GROUP BY m->>'actor'
        ) s;
      IF v_body IS NOT NULL THEN
        v_out := v_out || format(E'\n\n*%s moved — %s*\n%s', v_noun, v_n, v_body);
      END IF;
    END IF;
  END LOOP;

  IF p_cfg.include_clients THEN
    SELECT string_agg(format('%s %s', slack_esc(c->>'client'), c->>'n'), ' · '
                      ORDER BY (c->>'n')::int DESC)
      INTO v_body
      FROM jsonb_array_elements(p_metrics->'clients') c;
    IF v_body IS NOT NULL THEN
      v_out := v_out || format(E'\n\n*By client*\n%s', v_body);
    END IF;
  END IF;

  -- Snapshot: zero-count stages are omitted, or a 12-column board produces a
  -- line nobody reads.
  IF p_cfg.include_snapshot THEN
    FOREACH v_cat IN ARRAY v_cats LOOP
      v_noun := CASE WHEN NOT v_tabs THEN 'Pipeline now'
                     WHEN v_cat = 'ops' THEN 'Ops now'
                     ELSE 'Pipeline now' END;
      SELECT string_agg(format('%s %s', slack_esc(s->>'stage'), s->>'n'), ' · '
                        ORDER BY (s->>'n')::int DESC)
        INTO v_body
        FROM jsonb_array_elements(p_metrics->'snapshot') s
       WHERE (s->>'n')::int > 0
         AND s->>'cat' = v_cat;
      IF v_body IS NOT NULL THEN
        v_out := v_out || format(E'\n\n*%s*\n%s', v_noun, v_body);
      END IF;
    END LOOP;
  END IF;

  IF p_prev IS NOT NULL THEN
    v_pa := COALESCE((p_prev->>'added_total')::int, 0);
    v_pm := COALESCE((p_prev->>'moved_total')::int, 0);
    v_out := v_out || format(E'\n\n_vs yesterday — added %s (%s), moved %s (%s)_',
      v_pa, CASE WHEN v_added - v_pa >= 0 THEN '+' ELSE '' END || (v_added - v_pa)::text,
      v_pm, CASE WHEN v_moved - v_pm >= 0 THEN '+' ELSE '' END || (v_moved - v_pm)::text);
  END IF;

  v_out := v_out || format(E'\n\n_%s · %s_',
             to_char(p_local_date, 'Dy DD Mon YYYY'), slack_esc(p_timezone));

  -- Slack rejects a section over 3000 chars outright, losing the whole report.
  -- Truncating loses only the tail.
  IF length(v_out) > 2900 THEN
    v_out := left(v_out, 2850) || E'\n_…truncated_';
  END IF;

  RETURN v_out;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 8. Sending — exactly once
-- ---------------------------------------------------------------------------
-- The day is CLAIMED before anything is posted, in one transaction: the unique
-- index makes a concurrent second attempt fail at the INSERT, before Slack is
-- touched. pg_net's http_post enqueues into a table, so if anything raises
-- afterwards the rollback takes the queued request with it — no phantom "sent".
CREATE OR REPLACE FUNCTION send_daily_report(
  p_config_id  uuid,
  p_local_date date,
  p_test       boolean DEFAULT false
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c         daily_report_configs;
  v_chan    slack_channels;
  v_project record;
  v_start   timestamptz;
  v_end     timestamptz;
  v_metrics jsonb;
  v_prev    jsonb;
  v_text    text;
  v_run_id  uuid;
  v_req     bigint;
BEGIN
  SELECT * INTO c FROM daily_report_configs WHERE id = p_config_id;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'daily report config not found';
  END IF;

  SELECT * INTO v_chan FROM slack_channels WHERE id = c.channel_id;
  IF v_chan.id IS NULL THEN
    RAISE EXCEPTION 'slack channel not found';
  END IF;
  IF NOT v_chan.active AND NOT p_test THEN
    RAISE EXCEPTION 'slack channel is paused';
  END IF;

  SELECT id, name INTO v_project FROM projects WHERE id = c.project_id;
  IF v_project.id IS NULL THEN
    RAISE EXCEPTION 'project not found';
  END IF;

  v_start := p_local_date::timestamp AT TIME ZONE c.timezone;
  v_end   := LEAST(now(), (p_local_date + 1)::timestamp AT TIME ZONE c.timezone);

  v_metrics := daily_report_metrics(c.project_id, v_start, v_end, c.scope, c.include_machine_actors);

  SELECT metrics INTO v_prev
    FROM daily_report_runs
   WHERE config_id = c.id AND local_date = p_local_date - 1 AND status <> 'test';

  -- Quiet day, and this report would rather stay quiet. Still record the zero:
  -- a hole in the series later reads as missing data, not as a quiet day.
  IF NOT p_test AND NOT c.send_when_empty
     AND COALESCE((v_metrics->>'added_total')::int, 0) = 0
     AND COALESCE((v_metrics->>'moved_total')::int, 0) = 0 THEN
    INSERT INTO daily_report_runs (config_id, project_id, project_name, local_date, timezone,
        window_start, window_end, scope, metrics, status)
    VALUES (c.id, c.project_id, v_project.name, p_local_date, c.timezone,
        v_start, v_end, c.scope, v_metrics, 'skipped_empty');
    UPDATE daily_report_configs SET last_sent_on = p_local_date, last_error = NULL WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'skipped', 'empty');
  END IF;

  v_text := daily_report_text(v_project.name, v_metrics, v_prev, p_local_date, c.timezone, c);
  IF p_test THEN
    v_text := '[TEST] ' || v_text;
  END IF;

  INSERT INTO daily_report_runs (config_id, project_id, project_name, local_date, timezone,
      window_start, window_end, scope, added_total, moved_total, actor_count, metrics, status)
  VALUES (c.id, c.project_id, v_project.name, p_local_date, c.timezone,
      v_start, v_end, c.scope,
      COALESCE((v_metrics->>'added_total')::int, 0),
      COALESCE((v_metrics->>'moved_total')::int, 0),
      COALESCE((v_metrics->>'actor_count')::int, 0),
      v_metrics,
      CASE WHEN p_test THEN 'test' ELSE 'sent' END)
  RETURNING id INTO v_run_id;

  -- SELECT, not PERFORM: the request id is the only way to find out later
  -- whether Slack actually accepted it (see daily_report_reconcile).
  SELECT net.http_post(
    url     := v_chan.url,
    body    := jsonb_build_object('text', v_text),
    headers := '{"Content-Type": "application/json"}'::jsonb
  ) INTO v_req;

  UPDATE daily_report_runs SET request_id = v_req WHERE id = v_run_id;

  IF NOT p_test THEN
    UPDATE daily_report_configs SET last_sent_on = p_local_date, last_error = NULL WHERE id = c.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'run_id', v_run_id,
                            'added', COALESCE((v_metrics->>'added_total')::int, 0),
                            'moved', COALESCE((v_metrics->>'moved_total')::int, 0));
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 9. The scheduler entry point
-- ---------------------------------------------------------------------------
-- One job asking "which reports are due?", rather than one cron entry per
-- report: cron expressions have no timezone and run in UTC, so a per-report
-- entry would drift by an hour twice a year in any DST zone.
CREATE OR REPLACE FUNCTION run_due_daily_reports()
RETURNS int
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       record;
  v_local timestamp;
  v_date  date;
  v_sent  int := 0;
BEGIN
  FOR r IN
    SELECT c.* FROM daily_report_configs c
    JOIN projects p ON p.id = c.project_id
    WHERE c.active AND NOT COALESCE(p.archived, false)
    ORDER BY c.id
    FOR UPDATE OF c SKIP LOCKED
  LOOP
    BEGIN
      v_local := now() AT TIME ZONE r.timezone;
      v_date  := v_local::date;

      CONTINUE WHEN v_local::time < r.send_time;
      CONTINUE WHEN r.last_sent_on IS NOT NULL AND r.last_sent_on >= v_date;
      CONTINUE WHEN NOT (EXTRACT(ISODOW FROM v_local)::int = ANY (r.days_of_week));

      PERFORM send_daily_report(r.id, v_date, false);
      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      -- One broken report must never stop the others (the run_task_automations
      -- philosophy from sql/09).
      RAISE WARNING 'daily report % failed: %', r.id, SQLERRM;
      UPDATE daily_report_configs SET last_error = SQLERRM WHERE id = r.id;
    END;
  END LOOP;

  RETURN v_sent;
END;
$$ LANGUAGE plpgsql;

-- Must NOT be callable from the browser: the publishable key ships in
-- js/config.js, and this would be a "send to everyone" button.
REVOKE ALL ON FUNCTION run_due_daily_reports() FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Buttons the app calls
-- ---------------------------------------------------------------------------
-- "Send test" posts TODAY'S REAL NUMBERS through the same renderer and the same
-- pg_net channel a scheduled send uses — unlike send_test_webhook's dummy
-- payload, because the person clicking is checking the content, not the shape.
-- Writes a 'test' run row (excluded from the once-a-day index) and never
-- advances last_sent_on, so testing can't suppress the real send.
CREATE OR REPLACE FUNCTION send_test_report(p_config_id uuid)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c daily_report_configs;
BEGIN
  SELECT * INTO c FROM daily_report_configs WHERE id = p_config_id;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'daily report config not found';
  END IF;
  RETURN send_daily_report(c.id, (now() AT TIME ZONE c.timezone)::date, true);
END;
$$ LANGUAGE plpgsql;

-- Live preview in the config modal: the exact text that would be posted, with
-- nothing sent and nothing recorded.
CREATE OR REPLACE FUNCTION daily_report_preview(p_config_id uuid)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c         daily_report_configs;
  v_name    text;
  v_date    date;
  v_start   timestamptz;
  v_end     timestamptz;
  v_metrics jsonb;
  v_prev    jsonb;
BEGIN
  SELECT * INTO c FROM daily_report_configs WHERE id = p_config_id;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'daily report config not found';
  END IF;
  SELECT name INTO v_name FROM projects WHERE id = c.project_id;

  v_date  := (now() AT TIME ZONE c.timezone)::date;
  v_start := v_date::timestamp AT TIME ZONE c.timezone;
  v_end   := now();

  v_metrics := daily_report_metrics(c.project_id, v_start, v_end, c.scope, c.include_machine_actors);
  SELECT metrics INTO v_prev FROM daily_report_runs
   WHERE config_id = c.id AND local_date = v_date - 1 AND status <> 'test';

  RETURN jsonb_build_object(
    'ok', true,
    'text', daily_report_text(v_name, v_metrics, v_prev, v_date, c.timezone, c),
    'added', COALESCE((v_metrics->>'added_total')::int, 0),
    'moved', COALESCE((v_metrics->>'moved_total')::int, 0));
END;
$$ LANGUAGE plpgsql;

-- Prove a freshly pasted Slack URL works, before any report depends on it.
CREATE OR REPLACE FUNCTION send_test_slack_channel(p_channel_id uuid)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chan slack_channels;
  v_req  bigint;
BEGIN
  SELECT * INTO v_chan FROM slack_channels WHERE id = p_channel_id;
  IF v_chan.id IS NULL THEN
    RAISE EXCEPTION 'slack channel not found';
  END IF;
  SELECT net.http_post(
    url     := v_chan.url,
    body    := jsonb_build_object('text',
                 format('*Vyom* — test message for %s. This channel is connected.',
                        slack_esc(v_chan.label))),
    headers := '{"Content-Type": "application/json"}'::jsonb
  ) INTO v_req;
  RETURN jsonb_build_object('ok', true, 'request_id', v_req);
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 11. Delivery reconciliation
-- ---------------------------------------------------------------------------
-- pg_net is fire-and-forget, so a revoked webhook or a malformed payload would
-- otherwise look like a successful send forever. This sweeps recent runs and
-- records what Slack actually said. net._http_response is pruned after a few
-- hours, so anything older is left alone rather than guessed at.
CREATE OR REPLACE FUNCTION daily_report_reconcile()
RETURNS int
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int := 0;
BEGIN
  UPDATE daily_report_runs r
     SET status = 'failed',
         error  = format('slack responded %s: %s', resp.status_code,
                         left(COALESCE(resp.content, ''), 300))
    FROM net._http_response resp
   WHERE resp.id = r.request_id
     AND r.status IN ('sent', 'test')
     AND r.created_at > now() - interval '6 hours'
     AND resp.status_code IS NOT NULL
     AND resp.status_code NOT BETWEEN 200 AND 299;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE daily_report_configs c
     SET last_error = r.error
    FROM daily_report_runs r
   WHERE r.config_id = c.id AND r.status = 'failed'
     AND r.created_at > now() - interval '6 hours';

  RETURN v_n;
EXCEPTION WHEN OTHERS THEN
  -- pg_net's internal table is not part of our contract; never fail the sweep.
  RAISE WARNING 'daily_report_reconcile failed: %', SQLERRM;
  RETURN 0;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION daily_report_reconcile() FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. Scheduling
-- ---------------------------------------------------------------------------
-- pg_cron is available on this project but not installed by default. This block
-- installs and schedules it if it can, and says so loudly if it cannot — a
-- scheduled feature that silently never schedules is worse than one that warns.
-- cron.schedule() upserts on the job name, so re-running this file re-points the
-- job instead of adding a second one.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
      PERFORM cron.schedule('vyom-daily-reports', '*/5 * * * *',
                            'SELECT run_due_daily_reports()');
      PERFORM cron.schedule('vyom-report-reconcile', '7 * * * *',
                            'SELECT daily_report_reconcile()');
      RAISE NOTICE 'daily reports: scheduled (checks every 5 minutes).';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'daily reports: pg_cron present but scheduling failed (%). Call run_due_daily_reports() from an external scheduler instead.', SQLERRM;
    END;
  ELSE
    RAISE WARNING 'daily reports: pg_cron unavailable. run_due_daily_reports() MUST be scheduled externally or no report will ever be sent.';
  END IF;
END $$;
