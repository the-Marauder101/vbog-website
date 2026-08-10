-- VBOG PM Tool — editable report message + per-person reports
-- Run in Supabase SQL Editor after 01–15. Idempotent.
--
-- Two additions to the daily report (sql/15):
--   1. `template` — the message wording is now editable from inside Vyom. The
--      computed blocks stay computed; the template decides what goes where and
--      what it's called, so changing "Cards added" to "Candidates sourced" or
--      adding a line for the team is a config edit, not a deploy.
--   2. `member_ids` — report on specific people rather than everyone. Selected
--      people with NO activity are still listed, at zero: a report meant to show
--      progress has to be able to show its absence.

-- ---------------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------------
ALTER TABLE daily_report_configs
  ADD COLUMN IF NOT EXISTS template text;               -- NULL = the built-in default
ALTER TABLE daily_report_configs
  ADD COLUMN IF NOT EXISTS member_ids uuid[] NOT NULL DEFAULT '{}';  -- empty = everyone

-- The default lives in the database, not the frontend, so the modal prefills
-- byte-for-byte what an untouched report actually sends.
CREATE OR REPLACE FUNCTION daily_report_default_template()
RETURNS text
AS $$
  SELECT '*{project} — Daily report*

{added}

{moved}

{clients}

{pipeline}

{vs_yesterday}

_{date} · {timezone}_';
$$ LANGUAGE sql IMMUTABLE;

-- ---------------------------------------------------------------------------
-- 2. Metrics: filter to selected people, and remember who was selected
-- ---------------------------------------------------------------------------
-- Signature gains p_member_ids, so the old 5-arg version must go or PostgREST
-- and the existing callers would face an ambiguous overload.
DROP FUNCTION IF EXISTS daily_report_metrics(uuid, timestamptz, timestamptz, text, boolean);

CREATE OR REPLACE FUNCTION daily_report_metrics(
  p_project_id      uuid,
  p_from            timestamptz,
  p_to              timestamptz,
  p_scope           text    DEFAULT 'both',
  p_include_machine boolean DEFAULT false,
  p_member_ids      uuid[]  DEFAULT '{}'
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hiring   text[];
  v_ops      text[];
  v_tabs     boolean;
  v_selected text[];
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

  -- Names, resolved once. The renderer needs them to list a selected person who
  -- did nothing — the whole point of picking people is seeing the zeroes.
  IF array_length(p_member_ids, 1) IS NOT NULL THEN
    SELECT COALESCE(array_agg(name ORDER BY name), '{}'::text[])
      INTO v_selected
      FROM team_members WHERE id = ANY (p_member_ids);
  ELSE
    v_selected := '{}'::text[];
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
        -- Empty selection = everyone. Filtering on actor_id (not name) keeps a
        -- rename honest; a selected member always has an id on their rows.
        AND (array_length(p_member_ids, 1) IS NULL OR c.actor_id = ANY (p_member_ids))
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
      'selected',     to_jsonb(v_selected),
      'statuses',     to_jsonb(v_hiring),
      'ops_statuses', to_jsonb(v_ops),
      'has_tabs',     v_tabs
    )
  );
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 3. Rendering: build the blocks, then pour them into the template
-- ---------------------------------------------------------------------------
-- Each placeholder expands to a whole block INCLUDING its heading, so a block
-- with nothing to say disappears cleanly instead of leaving an orphan heading.
-- Blank runs are collapsed afterwards, which is what lets a template be written
-- with generous spacing and still read tightly.
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
  v_out      text;
  v_added    text := '';
  v_moved    text := '';
  v_clients  text := '';
  v_pipeline text := '';
  v_delta    text := '';
  v_body     text;
  v_zeros    text;
  v_total    int := COALESCE((p_metrics->>'added_total')::int, 0);
  v_movtot   int := COALESCE((p_metrics->>'moved_total')::int, 0);
  v_tabs     boolean := COALESCE((p_metrics->>'has_tabs')::boolean, false);
  v_split    boolean;
  v_cats     text[];
  v_cat      text;
  v_noun     text;
  v_n        int;
  v_sel      text[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_metrics->'selected')), '{}'::text[]);
  v_pa       int;
  v_pm       int;
BEGIN
  v_split := v_tabs AND p_cfg.scope = 'both';
  v_cats  := CASE WHEN v_split THEN ARRAY['candidate', 'ops']
                  WHEN p_cfg.scope = 'ops' THEN ARRAY['ops']
                  ELSE ARRAY['candidate'] END;

  FOREACH v_cat IN ARRAY v_cats LOOP
    v_noun := CASE WHEN NOT v_tabs THEN 'Cards'
                   WHEN v_cat = 'ops' THEN 'Ops tasks'
                   ELSE 'Candidates' END;

    IF p_cfg.include_added THEN
      SELECT string_agg(line, E'\n' ORDER BY total DESC, actor), sum(total)
        INTO v_body, v_n
        FROM (
          SELECT a->>'actor' AS actor,
                 sum((a->>'n')::int) AS total,
                 format('• *%s* — %s · %s',
                   slack_esc(a->>'actor'), sum((a->>'n')::int),
                   string_agg(format('%s %s', slack_esc(a->>'stage'), a->>'n'), ', '
                              ORDER BY (a->>'n')::int DESC)) AS line
            FROM jsonb_array_elements(p_metrics->'added') a
           WHERE a->>'cat' = v_cat
           GROUP BY a->>'actor'
        ) s;

      -- Named people who did nothing still appear, at zero. Picking people is
      -- how you watch for the absence of progress, not just its presence.
      SELECT string_agg(format('• *%s* — 0', slack_esc(nm)), E'\n' ORDER BY nm)
        INTO v_zeros
        FROM unnest(v_sel) AS nm
       WHERE NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_metrics->'added') a
          WHERE a->>'cat' = v_cat AND a->>'actor' = nm);

      v_body := concat_ws(E'\n', v_body, CASE WHEN v_cat = v_cats[1] THEN v_zeros END);
      IF v_body IS NOT NULL AND v_body <> '' THEN
        v_added := concat_ws(E'\n\n', nullif(v_added, ''),
                     format(E'*%s added — %s*\n%s', v_noun, COALESCE(v_n, 0), v_body));
      END IF;
    END IF;

    IF p_cfg.include_moved THEN
      SELECT string_agg(line, E'\n' ORDER BY total DESC, actor), sum(total)
        INTO v_body, v_n
        FROM (
          SELECT m->>'actor' AS actor,
                 sum((m->>'n')::int) AS total,
                 format('• *%s* — %s · %s',
                   slack_esc(m->>'actor'), sum((m->>'n')::int),
                   string_agg(format('%s → %s %s',
                     slack_esc(m->>'from'), slack_esc(m->>'to'), m->>'n'), ', '
                     ORDER BY (m->>'n')::int DESC)) AS line
            FROM jsonb_array_elements(p_metrics->'moved') m
           WHERE m->>'cat' = v_cat
           GROUP BY m->>'actor'
        ) s;
      IF v_body IS NOT NULL THEN
        v_moved := concat_ws(E'\n\n', nullif(v_moved, ''),
                     format(E'*%s moved — %s*\n%s', v_noun, COALESCE(v_n, 0), v_body));
      END IF;
    END IF;
  END LOOP;

  IF p_cfg.include_clients THEN
    SELECT string_agg(format('%s %s', slack_esc(c->>'client'), c->>'n'), ' · '
                      ORDER BY (c->>'n')::int DESC)
      INTO v_body FROM jsonb_array_elements(p_metrics->'clients') c;
    IF v_body IS NOT NULL THEN
      v_clients := format(E'*By client*\n%s', v_body);
    END IF;
  END IF;

  IF p_cfg.include_snapshot THEN
    FOREACH v_cat IN ARRAY v_cats LOOP
      v_noun := CASE WHEN v_tabs AND v_cat = 'ops' THEN 'Ops now' ELSE 'Pipeline now' END;
      SELECT string_agg(format('%s %s', slack_esc(s->>'stage'), s->>'n'), ' · '
                        ORDER BY (s->>'n')::int DESC)
        INTO v_body
        FROM jsonb_array_elements(p_metrics->'snapshot') s
       WHERE (s->>'n')::int > 0 AND s->>'cat' = v_cat;
      IF v_body IS NOT NULL THEN
        v_pipeline := concat_ws(E'\n\n', nullif(v_pipeline, ''), format(E'*%s*\n%s', v_noun, v_body));
      END IF;
    END LOOP;
  END IF;

  IF p_prev IS NOT NULL THEN
    v_pa := COALESCE((p_prev->>'added_total')::int, 0);
    v_pm := COALESCE((p_prev->>'moved_total')::int, 0);
    v_delta := format('_vs yesterday — added %s (%s), moved %s (%s)_',
      v_pa, CASE WHEN v_total - v_pa >= 0 THEN '+' ELSE '' END || (v_total - v_pa)::text,
      v_pm, CASE WHEN v_movtot - v_pm >= 0 THEN '+' ELSE '' END || (v_movtot - v_pm)::text);
  END IF;

  IF v_total = 0 AND v_movtot = 0 AND v_added = '' AND v_moved = '' THEN
    v_added := 'No cards were added or moved today.';
  END IF;

  v_out := COALESCE(nullif(btrim(p_cfg.template), ''), daily_report_default_template());
  v_out := replace(v_out, '{project}',      slack_esc(p_project_name));
  v_out := replace(v_out, '{date}',         to_char(p_local_date, 'Dy DD Mon YYYY'));
  v_out := replace(v_out, '{timezone}',     slack_esc(p_timezone));
  v_out := replace(v_out, '{added}',        v_added);
  v_out := replace(v_out, '{moved}',        v_moved);
  v_out := replace(v_out, '{clients}',      v_clients);
  v_out := replace(v_out, '{pipeline}',     v_pipeline);
  v_out := replace(v_out, '{vs_yesterday}', v_delta);
  v_out := replace(v_out, '{added_total}',  v_total::text);
  v_out := replace(v_out, '{moved_total}',  v_movtot::text);
  v_out := replace(v_out, '{people}',       COALESCE((p_metrics->>'actor_count')::int, 0)::text);
  v_out := replace(v_out, '{summary}',      format('Added %s · Moved %s', v_total, v_movtot));

  -- Collapse the gaps left by blocks that had nothing to say, then trim.
  -- btrim's default strips spaces only, so the newline set is explicit or a
  -- template whose last block is empty ends in blank lines.
  v_out := btrim(regexp_replace(v_out, E'\n{3,}', E'\n\n', 'g'), E' \n\r\t');

  IF length(v_out) > 2900 THEN
    v_out := left(v_out, 2850) || E'\n_…truncated_';
  END IF;

  RETURN v_out;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 4. Callers pass the member selection through
-- ---------------------------------------------------------------------------
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

  v_metrics := daily_report_metrics(c.project_id, v_start, v_end, c.scope,
                                    c.include_machine_actors, c.member_ids);

  SELECT metrics INTO v_prev
    FROM daily_report_runs
   WHERE config_id = c.id AND local_date = p_local_date - 1 AND status <> 'test';

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

-- Preview accepts an UNSAVED template so the modal can show the effect of an
-- edit before committing to it — otherwise you'd have to save to find out.
DROP FUNCTION IF EXISTS daily_report_preview(uuid);

CREATE OR REPLACE FUNCTION daily_report_preview(
  p_config_id uuid,
  p_template  text DEFAULT NULL
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c         daily_report_configs;
  v_name    text;
  v_date    date;
  v_start   timestamptz;
  v_metrics jsonb;
  v_prev    jsonb;
BEGIN
  SELECT * INTO c FROM daily_report_configs WHERE id = p_config_id;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'daily report config not found';
  END IF;
  SELECT name INTO v_name FROM projects WHERE id = c.project_id;

  IF p_template IS NOT NULL THEN
    c.template := p_template;
  END IF;

  v_date  := (now() AT TIME ZONE c.timezone)::date;
  v_start := v_date::timestamp AT TIME ZONE c.timezone;

  v_metrics := daily_report_metrics(c.project_id, v_start, now(), c.scope,
                                    c.include_machine_actors, c.member_ids);
  SELECT metrics INTO v_prev FROM daily_report_runs
   WHERE config_id = c.id AND local_date = v_date - 1 AND status <> 'test';

  RETURN jsonb_build_object(
    'ok', true,
    'text', daily_report_text(v_name, v_metrics, v_prev, v_date, c.timezone, c),
    'added', COALESCE((v_metrics->>'added_total')::int, 0),
    'moved', COALESCE((v_metrics->>'moved_total')::int, 0));
END;
$$ LANGUAGE plpgsql;
