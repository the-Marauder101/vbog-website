-- VBOG PM Tool — Task fields container
-- One jsonb column holds structured per-task data that automations need
-- (fields.email today; doc URLs or anything else later) so notes stay
-- free-text and NO further migrations are needed when new fields appear —
-- the UI just reads/writes another key. Webhook payloads carry the whole
-- container via task_details.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '{}';

-- task_details (webhook/automation payloads) now includes fields.
-- DROP first: CREATE OR REPLACE can't insert a column mid-view. Safe —
-- only plpgsql functions read the view, and they resolve it at runtime.
DROP VIEW IF EXISTS task_details;
CREATE VIEW task_details AS
SELECT
  t.id,
  t.title,
  t.notes,
  t.status,
  t.due_date,
  t.created_at,
  t.updated_at,
  t.source,
  t.external_id,
  t.fields,
  p.name  AS project_name,
  p.id    AS project_id,
  tm.name AS assignee_name,
  tm.id   AS assignee_id
FROM tasks t
JOIN projects p            ON p.id  = t.project_id
LEFT JOIN team_members tm  ON tm.id = t.assignee_id;

-- ingest_task gains an optional p_fields parameter. The old signature must
-- be dropped first — otherwise CREATE would add an ambiguous overload and
-- PostgREST couldn't resolve the RPC. Existing callers keep working: the
-- new parameter has a default.
DROP FUNCTION IF EXISTS ingest_task(text, text, text, text, date, uuid, text);

CREATE OR REPLACE FUNCTION ingest_task(
  p_api_key     text,
  p_title       text,
  p_notes       text DEFAULT NULL,
  p_status      text DEFAULT NULL,
  p_due_date    date DEFAULT NULL,
  p_assignee_id uuid DEFAULT NULL,
  p_external_id text DEFAULT NULL,
  p_fields      jsonb DEFAULT '{}'
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k record;
  proj record;
  final_status text;
  new_id uuid;
BEGIN
  SELECT * INTO k FROM api_keys WHERE key = p_api_key AND active;
  IF k.id IS NULL THEN
    RAISE EXCEPTION 'invalid or inactive API key';
  END IF;
  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'p_title is required';
  END IF;

  SELECT * INTO proj FROM projects WHERE id = k.project_id;

  final_status := p_status;
  IF final_status IS NULL OR NOT (proj.statuses ? final_status) THEN
    final_status := proj.statuses->>0;
  END IF;

  INSERT INTO tasks (project_id, title, notes, status, due_date, assignee_id, source, external_id, fields)
  VALUES (k.project_id, btrim(p_title), p_notes, final_status, p_due_date, p_assignee_id, 'api', p_external_id,
          COALESCE(p_fields, '{}'::jsonb))
  RETURNING id INTO new_id;

  UPDATE api_keys SET last_used_at = now() WHERE id = k.id;

  RETURN jsonb_build_object('ok', true, 'task_id', new_id, 'project_id', k.project_id, 'status', final_status);
END;
$$ LANGUAGE plpgsql;
