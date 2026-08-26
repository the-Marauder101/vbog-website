-- VBOG PM Tool — client registry + report types, status filters and card detail
-- Run in Supabase SQL Editor after 01–17. Idempotent.
--
-- Three things, all pulling in the same direction — reports that can answer a
-- specific question rather than only "what happened today":
--
--   1. `clients` — a registry, like tags and slack_channels. The task modal's
--      Client field becomes a real dropdown instead of free text with a
--      datalist, so client names stop drifting ("Newmetech" vs "NewMeTech")
--      and per-client information has somewhere to live later.
--   2. Report TYPES — activity (what it did before), movement (cards that
--      moved, optionally only between chosen statuses) and snapshot (cards
--      sitting in chosen statuses right now).
--   3. Card DETAIL — a report can list the actual cards with the fields you
--      pick (client, assignee, days in stage, …), not just counts.

-- ---------------------------------------------------------------------------
-- 1. Client registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open" ON clients;
CREATE POLICY "open" ON clients FOR ALL USING (true) WITH CHECK (true);

-- Seed from what is already in use, so the dropdown is populated on day one and
-- no existing card loses its client. tasks.fields.client stays the stored value
-- (a name, not an id): every filter, report and webhook payload already keys on
-- the name, and changing that would be a migration across all of them for no
-- gain the registry doesn't already deliver.
INSERT INTO clients (name)
SELECT DISTINCT btrim(t.fields->>'client')
  FROM tasks t
 WHERE COALESCE(btrim(t.fields->>'client'), '') <> ''
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Report types, filters and detail
-- ---------------------------------------------------------------------------
ALTER TABLE daily_report_configs
  ADD COLUMN IF NOT EXISTS report_type text NOT NULL DEFAULT 'activity'
    CHECK (report_type IN ('activity', 'movement', 'snapshot'));
-- movement: destination statuses (empty = any). snapshot: which statuses to
-- list (empty = all). Names, not ids — statuses are per-project strings.
ALTER TABLE daily_report_configs
  ADD COLUMN IF NOT EXISTS filter_statuses text[] NOT NULL DEFAULT '{}';
-- movement only: source statuses (empty = any), so "R1 Selected → R2 Rejected"
-- is expressible rather than just "anything that moved".
ALTER TABLE daily_report_configs
  ADD COLUMN IF NOT EXISTS filter_from_statuses text[] NOT NULL DEFAULT '{}';
-- Which per-card fields to print. Empty = counts only.
ALTER TABLE daily_report_configs
  ADD COLUMN IF NOT EXISTS detail_fields text[] NOT NULL DEFAULT '{client,assignee}';
ALTER TABLE daily_report_configs
  ADD COLUMN IF NOT EXISTS max_cards int NOT NULL DEFAULT 40;
ALTER TABLE daily_report_configs
  ADD COLUMN IF NOT EXISTS filter_clients text[] NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- 3. Default templates, one per report type
-- ---------------------------------------------------------------------------
-- Each type gets a message that already reads correctly, so choosing a type is
-- enough and editing the wording stays optional.
--
-- The zero-argument version from sql/16 has to go: a no-arg call against both
-- it and this one (whose only parameter has a default) is ambiguous, and
-- Postgres refuses the call rather than picking.
DROP FUNCTION IF EXISTS daily_report_default_template();

CREATE OR REPLACE FUNCTION daily_report_default_template(p_type text DEFAULT 'activity')
RETURNS text
AS $$
  SELECT CASE p_type
    WHEN 'movement' THEN '*{project} — Movement* · {date}

{moved_total} card(s) moved

{cards}

{vs_yesterday}'
    WHEN 'snapshot' THEN '*{project} — Status report* · {date}

{card_total} card(s) in {status_list}

{cards}

{pipeline}'
    ELSE '*{project} — Daily report*

{added}

{moved}

{clients}

{pipeline}

{vs_yesterday}

_{date} · {timezone}_'
  END;
$$ LANGUAGE sql IMMUTABLE;

-- ---------------------------------------------------------------------------
-- 4. Metrics: same aggregate as before, plus the card list a report can print
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS daily_report_metrics(uuid, timestamptz, timestamptz, text, boolean, uuid[]);

CREATE OR REPLACE FUNCTION daily_report_metrics(
  p_project_id      uuid,
  p_from            timestamptz,
  p_to              timestamptz,
  p_scope           text    DEFAULT 'both',
  p_include_machine boolean DEFAULT false,
  p_member_ids      uuid[]  DEFAULT '{}',
  p_report_type     text    DEFAULT 'activity',
  p_statuses        text[]  DEFAULT '{}',
  p_from_statuses   text[]  DEFAULT '{}',
  p_clients         text[]  DEFAULT '{}',
  p_max_cards       int     DEFAULT 40
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
  v_agg      jsonb;
  v_cards    jsonb := '[]'::jsonb;
  v_total    int := 0;
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

  IF array_length(p_member_ids, 1) IS NOT NULL THEN
    SELECT COALESCE(array_agg(name ORDER BY name), '{}'::text[])
      INTO v_selected FROM team_members WHERE id = ANY (p_member_ids);
  ELSE
    v_selected := '{}'::text[];
  END IF;

  -- ---- the aggregate (unchanged shape: every existing template still works)
  -- A scalar subquery with its own WITH, so the CTEs are visible to the
  -- jsonb_build_object that consumes them.
  v_agg := (
    WITH ev AS (
      SELECT
        COALESCE(c.actor_name, 'Unknown') AS actor_name,
        c.action, c.old_value, c.new_value,
        COALESCE(t.fields->>'client', '') AS client,
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
      WHERE c.project_id = p_project_id
        AND c.field = 'status'
        AND c.created_at >= p_from AND c.created_at < p_to
        AND c.action IN ('created', 'updated')
        AND (p_include_machine OR COALESCE(c.actor_name, 'Unknown')
             NOT IN ('Automation', 'Vyom API', 'Zapier', 'Unknown'))
        AND (array_length(p_member_ids, 1) IS NULL OR c.actor_id = ANY (p_member_ids))
        AND (array_length(p_clients, 1) IS NULL OR COALESCE(t.fields->>'client','') = ANY (p_clients))
    ),
    filt AS (
      SELECT * FROM ev
      WHERE p_scope = 'both'
         OR cat = CASE WHEN p_scope = 'ops' THEN 'ops' ELSE 'candidate' END
    ),
    added AS (
      SELECT cat, actor_name, new_value AS stage, count(*)::int AS n
      FROM filt WHERE action = 'created' AND new_value IS NOT NULL GROUP BY 1,2,3
    ),
    moved AS (
      SELECT cat, actor_name, old_value AS from_stage, new_value AS to_stage, count(*)::int AS n
      FROM filt WHERE action = 'updated' AND old_value IS DISTINCT FROM new_value GROUP BY 1,2,3,4
    ),
    cl AS (
      SELECT cat, client, count(*)::int AS n FROM filt WHERE client <> '' GROUP BY 1,2
    ),
    snap AS (
      SELECT CASE WHEN v_tabs AND t.fields->>'hr_category' = 'ops' THEN 'ops' ELSE 'candidate' END AS cat,
             t.status, count(*)::int AS n
      FROM tasks t WHERE t.project_id = p_project_id GROUP BY 1,2
    )
    SELECT jsonb_build_object(
      'added', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'cat', cat, 'actor', actor_name, 'stage', stage, 'n', n)
                 ORDER BY cat, n DESC, actor_name) FROM added), '[]'::jsonb),
      'moved', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'cat', cat, 'actor', actor_name, 'from', from_stage, 'to', to_stage, 'n', n)
                 ORDER BY cat, n DESC, actor_name) FROM moved), '[]'::jsonb),
      'clients', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'cat', cat, 'client', client, 'n', n) ORDER BY n DESC) FROM cl), '[]'::jsonb),
      'snapshot', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'cat', cat, 'stage', status, 'n', n)) FROM snap), '[]'::jsonb),
      'added_total', COALESCE((SELECT sum(n) FROM added), 0),
      'moved_total', COALESCE((SELECT sum(n) FROM moved), 0),
      'actor_count', (SELECT count(DISTINCT actor_name) FROM filt)
    )
  );

  -- ---- the card list, per report type
  --
  -- `count(*) OVER ()` runs before LIMIT, so the report can say "showing 40 of
  -- 137" rather than claiming the cap is the whole truth.
  IF p_report_type = 'movement' THEN
    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb), COALESCE(max(tot), 0)
      INTO v_cards, v_total
      FROM (
        SELECT count(*) OVER ()::int AS tot,
               jsonb_build_object(
                 'title', COALESCE(t.title, c.task_title),
                 'from', c.old_value, 'to', c.new_value,
                 'by', c.actor_name, 'at', c.created_at,
                 'client', COALESCE(t.fields->>'client', ''),
                 'assignee', tm.name,
                 'status', t.status,
                 'email', COALESCE(t.fields->>'email', ''),
                 'days', CASE WHEN t.status_changed_at IS NULL THEN NULL
                              ELSE floor(EXTRACT(epoch FROM (now() - t.status_changed_at)) / 86400)::int END
               ) AS x
          FROM task_changelog c
          LEFT JOIN tasks t ON t.id = c.task_id
          LEFT JOIN team_members tm ON tm.id = t.assignee_id
         WHERE c.project_id = p_project_id
           AND c.field = 'status' AND c.action = 'updated'
           AND c.old_value IS DISTINCT FROM c.new_value
           AND c.created_at >= p_from AND c.created_at < p_to
           AND (p_include_machine OR COALESCE(c.actor_name, 'Unknown')
                NOT IN ('Automation', 'Vyom API', 'Zapier', 'Unknown'))
           AND (array_length(p_member_ids, 1) IS NULL OR c.actor_id = ANY (p_member_ids))
           AND (array_length(p_statuses, 1) IS NULL OR c.new_value = ANY (p_statuses))
           AND (array_length(p_from_statuses, 1) IS NULL OR c.old_value = ANY (p_from_statuses))
           AND (array_length(p_clients, 1) IS NULL OR COALESCE(t.fields->>'client','') = ANY (p_clients))
           -- Same scope rule as the aggregate and the snapshot list, or an Ops
           -- movement report would happily list hiring cards.
           AND (p_scope = 'both'
                OR (p_scope = 'ops') = (COALESCE(t.fields->>'hr_category', 'candidate') = 'ops'))
         ORDER BY c.created_at DESC
         LIMIT GREATEST(p_max_cards, 1)
      ) s;

  ELSIF p_report_type = 'snapshot' THEN
    SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'days')::int DESC NULLS LAST), '[]'::jsonb), COALESCE(max(tot), 0)
      INTO v_cards, v_total
      FROM (
        SELECT count(*) OVER ()::int AS tot,
               jsonb_build_object(
                 'title', t.title,
                 'status', t.status,
                 'client', COALESCE(t.fields->>'client', ''),
                 'assignee', tm.name,
                 'email', COALESCE(t.fields->>'email', ''),
                 'at', t.status_changed_at,
                 'days', CASE WHEN t.status_changed_at IS NULL THEN NULL
                              ELSE floor(EXTRACT(epoch FROM (now() - t.status_changed_at)) / 86400)::int END
               ) AS x
          FROM tasks t
          LEFT JOIN team_members tm ON tm.id = t.assignee_id
         WHERE t.project_id = p_project_id
           AND (array_length(p_statuses, 1) IS NULL OR t.status = ANY (p_statuses))
           AND (array_length(p_clients, 1) IS NULL OR COALESCE(t.fields->>'client','') = ANY (p_clients))
           AND (p_scope = 'both'
                OR (p_scope = 'ops') = (COALESCE(t.fields->>'hr_category', 'candidate') = 'ops'))
         ORDER BY t.status_changed_at ASC NULLS LAST
         LIMIT GREATEST(p_max_cards, 1)
      ) s;
  END IF;

  RETURN v_agg || jsonb_build_object(
    'cards',        v_cards,
    'card_total',   v_total,
    'report_type',  p_report_type,
    'status_list',  CASE WHEN array_length(p_statuses, 1) IS NULL THEN 'any status'
                         ELSE array_to_string(p_statuses, ', ') END,
    'selected',     to_jsonb(v_selected),
    'statuses',     to_jsonb(v_hiring),
    'ops_statuses', to_jsonb(v_ops),
    'has_tabs',     v_tabs
  );
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 5. Rendering the card list
-- ---------------------------------------------------------------------------
-- The `{cards}` block: one bullet per card, carrying whichever fields the
-- config asked for. This is what turns a report from "14 cards moved" into a
-- list you can act on — "which client, who owns it, how long it has sat".
--
-- The movement/snapshot spine (from → to, or the current status) is always
-- printed; `detail_fields` only decides what is appended after it. A field
-- that is empty on a given card is skipped rather than printed blank, so a
-- card with no client doesn't leave a dangling separator.
CREATE OR REPLACE FUNCTION daily_report_cards(
  p_metrics jsonb,
  p_fields  text[],
  p_max     int DEFAULT 40
)
RETURNS text
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type  text := COALESCE(p_metrics->>'report_type', 'activity');
  v_total int  := COALESCE((p_metrics->>'card_total')::int, 0);
  v_shown int;
  v_body  text;
BEGIN
  -- p_max is applied here as well as in daily_report_metrics: preview overrides
  -- the cap, so a metrics blob and the config it is rendered with can carry
  -- different limits, and the smaller one has to win.
  SELECT count(*)::int INTO v_shown
    FROM jsonb_array_elements(p_metrics->'cards') WITH ORDINALITY u(c, ord)
   WHERE u.ord <= GREATEST(p_max, 1);
  IF v_shown = 0 THEN
    RETURN '';
  END IF;

  SELECT string_agg(
           format('• *%s* — %s%s',
             slack_esc(c->>'title'),
             CASE WHEN v_type = 'movement'
                  THEN format('%s → %s', slack_esc(COALESCE(c->>'from', '?')),
                                         slack_esc(COALESCE(c->>'to', '?')))
                  ELSE slack_esc(COALESCE(c->>'status', '—')) END,
             COALESCE(nullif(concat_ws('', (
               -- Only the requested fields, only where the card actually has
               -- one. concat_ws skips NULLs, which is what keeps this tidy.
               SELECT string_agg(part, '')
                 FROM (
                   -- nullif goes OUTSIDE slack_esc: slack_esc COALESCEs NULL to
                   -- '', so escaping first would turn a missing client into a
                   -- dangling " · " instead of dropping the field.
                   SELECT CASE f
                     WHEN 'client'   THEN ' · ' || nullif(slack_esc(c->>'client'), '')
                     WHEN 'assignee' THEN ' · ' || nullif(slack_esc(c->>'assignee'), '')
                     WHEN 'email'    THEN ' · ' || nullif(slack_esc(c->>'email'), '')
                     WHEN 'actor'    THEN ' · by ' || nullif(slack_esc(c->>'by'), '')
                     WHEN 'status'   THEN CASE WHEN v_type = 'movement'
                                               THEN ' · now ' || nullif(slack_esc(c->>'status'), '') END
                     WHEN 'days'     THEN CASE WHEN (c->>'days') IS NOT NULL
                                               THEN ' · ' || (c->>'days') || 'd in stage' END
                     WHEN 'time'     THEN CASE WHEN (c->>'at') IS NOT NULL
                                               THEN ' · ' || to_char((c->>'at')::timestamptz, 'DD Mon') END
                   END AS part
                     FROM unnest(COALESCE(p_fields, '{}'::text[])) WITH ORDINALITY AS ff(f, ord)
                    ORDER BY ff.ord
                 ) parts
             )), ''), '')
           ), E'\n' ORDER BY u.ord)
    INTO v_body
    FROM jsonb_array_elements(p_metrics->'cards') WITH ORDINALITY u(c, ord)
   WHERE u.ord <= GREATEST(p_max, 1);

  -- Say so when the cap bit. A silently truncated list reads as a complete
  -- one, which is the kind of wrong that goes unnoticed for weeks.
  IF v_total > v_shown THEN
    v_body := v_body || format(E'\n_…and %s more_', v_total - v_shown);
  END IF;

  RETURN COALESCE(v_body, '');
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 6. daily_report_text: the three new placeholders
-- ---------------------------------------------------------------------------
-- Same function as sql/16 with `{cards}`, `{card_total}` and `{status_list}`
-- added, and the per-type default template picked up when none is saved.
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
  v_cardlist text := '';
  v_body     text;
  v_zeros    text;
  v_total    int := COALESCE((p_metrics->>'added_total')::int, 0);
  v_movtot   int := COALESCE((p_metrics->>'moved_total')::int, 0);
  v_cardtot  int := COALESCE((p_metrics->>'card_total')::int, 0);
  v_type     text := COALESCE(p_cfg.report_type, 'activity');
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

  v_cardlist := daily_report_cards(p_metrics, p_cfg.detail_fields, p_cfg.max_cards);

  IF p_prev IS NOT NULL THEN
    v_pa := COALESCE((p_prev->>'added_total')::int, 0);
    v_pm := COALESCE((p_prev->>'moved_total')::int, 0);
    v_delta := format('_vs yesterday — added %s (%s), moved %s (%s)_',
      v_pa, CASE WHEN v_total - v_pa >= 0 THEN '+' ELSE '' END || (v_total - v_pa)::text,
      v_pm, CASE WHEN v_movtot - v_pm >= 0 THEN '+' ELSE '' END || (v_movtot - v_pm)::text);
  END IF;

  -- "Nothing happened" reads differently per type, and each type's empty state
  -- has to be stated somewhere the template can't accidentally swallow.
  IF v_type = 'activity' AND v_total = 0 AND v_movtot = 0 AND v_added = '' AND v_moved = '' THEN
    v_added := 'No cards were added or moved today.';
  ELSIF v_type <> 'activity' AND v_cardtot = 0 THEN
    v_cardlist := CASE WHEN v_type = 'movement'
                       THEN '_No cards moved in this window._'
                       ELSE '_No cards in these statuses._' END;
  END IF;

  v_out := COALESCE(nullif(btrim(p_cfg.template), ''), daily_report_default_template(v_type));
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
  v_out := replace(v_out, '{cards}',        v_cardlist);
  v_out := replace(v_out, '{card_total}',   v_cardtot::text);
  v_out := replace(v_out, '{status_list}',  slack_esc(COALESCE(p_metrics->>'status_list', 'any status')));
  v_out := replace(v_out, '{people}',       COALESCE((p_metrics->>'actor_count')::int, 0)::text);
  v_out := replace(v_out, '{summary}',      format('Added %s · Moved %s', v_total, v_movtot));

  v_out := btrim(regexp_replace(v_out, E'\n{3,}', E'\n\n', 'g'), E' \n\r\t');

  -- Card lists are the one block that can genuinely run long, so trim at a line
  -- boundary rather than mid-word.
  IF length(v_out) > 2900 THEN
    v_out := COALESCE(left(v_out, 2850), '');
    v_out := left(v_out, GREATEST(length(v_out) - strpos(reverse(v_out), E'\n'), 100))
             || E'\n_…truncated_';
  END IF;

  RETURN v_out;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 7. Callers pass the type, filters and cap through
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
  v_empty   boolean;
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
                                    c.include_machine_actors, c.member_ids,
                                    c.report_type, c.filter_statuses,
                                    c.filter_from_statuses, c.filter_clients,
                                    c.max_cards);

  SELECT metrics INTO v_prev
    FROM daily_report_runs
   WHERE config_id = c.id AND local_date = p_local_date - 1 AND status <> 'test';

  -- What counts as "nothing to say" depends on the type: an activity report is
  -- empty when nobody added or moved anything, a movement or snapshot report is
  -- empty when its own filter matched no cards.
  v_empty := CASE WHEN COALESCE(c.report_type, 'activity') = 'activity'
                  THEN COALESCE((v_metrics->>'added_total')::int, 0) = 0
                   AND COALESCE((v_metrics->>'moved_total')::int, 0) = 0
                  ELSE COALESCE((v_metrics->>'card_total')::int, 0) = 0 END;

  IF NOT p_test AND NOT c.send_when_empty AND v_empty THEN
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
                            'moved', COALESCE((v_metrics->>'moved_total')::int, 0),
                            'cards', COALESCE((v_metrics->>'card_total')::int, 0));
END;
$$ LANGUAGE plpgsql;

-- Preview takes the unsaved template AND the unsaved type/filters, so the modal
-- can show what a change does before it is committed. Without the overrides,
-- switching the type in the dropdown would preview the old type until saved —
-- which is exactly the "all I see is the screenshot" problem.
DROP FUNCTION IF EXISTS daily_report_preview(uuid, text);

CREATE OR REPLACE FUNCTION daily_report_preview(
  p_config_id     uuid,
  p_template      text    DEFAULT NULL,
  p_report_type   text    DEFAULT NULL,
  p_statuses      text[]  DEFAULT NULL,
  p_from_statuses text[]  DEFAULT NULL,
  p_clients       text[]  DEFAULT NULL,
  p_detail_fields text[]  DEFAULT NULL,
  p_max_cards     int     DEFAULT NULL
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

  -- A local copy of the row, overridden field by field. Nothing is written.
  IF p_template      IS NOT NULL THEN c.template             := p_template;      END IF;
  IF p_report_type   IS NOT NULL THEN c.report_type          := p_report_type;   END IF;
  IF p_statuses      IS NOT NULL THEN c.filter_statuses      := p_statuses;      END IF;
  IF p_from_statuses IS NOT NULL THEN c.filter_from_statuses := p_from_statuses; END IF;
  IF p_clients       IS NOT NULL THEN c.filter_clients       := p_clients;       END IF;
  IF p_detail_fields IS NOT NULL THEN c.detail_fields        := p_detail_fields; END IF;
  IF p_max_cards     IS NOT NULL THEN c.max_cards            := p_max_cards;     END IF;

  v_date  := (now() AT TIME ZONE c.timezone)::date;
  v_start := v_date::timestamp AT TIME ZONE c.timezone;

  v_metrics := daily_report_metrics(c.project_id, v_start, now(), c.scope,
                                    c.include_machine_actors, c.member_ids,
                                    c.report_type, c.filter_statuses,
                                    c.filter_from_statuses, c.filter_clients,
                                    c.max_cards);
  SELECT metrics INTO v_prev FROM daily_report_runs
   WHERE config_id = c.id AND local_date = v_date - 1 AND status <> 'test';

  RETURN jsonb_build_object(
    'ok', true,
    'text', daily_report_text(v_name, v_metrics, v_prev, v_date, c.timezone, c),
    'added', COALESCE((v_metrics->>'added_total')::int, 0),
    'moved', COALESCE((v_metrics->>'moved_total')::int, 0),
    'cards', COALESCE((v_metrics->>'card_total')::int, 0));
END;
$$ LANGUAGE plpgsql;
