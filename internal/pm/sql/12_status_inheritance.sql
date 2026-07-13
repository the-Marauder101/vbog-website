-- VBOG PM Tool — Sub-client status inheritance
-- projects.inherit_statuses: when true AND parent_project_id is set, the
-- project's Kanban columns are the PARENT's statuses, resolved at read time
-- (live link — editing the parent's columns changes every inheriting child).
-- The child's own statuses array is kept as a stale snapshot: it is written
-- once at creation (or when inheritance is switched off) and only used as a
-- fallback if the parent is ever deleted or ends up with an empty list.
-- Frontend resolves the same way via UI.effectiveStatuses().

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS inherit_statuses boolean NOT NULL DEFAULT false;

-- ingest_task must validate p_status against the EFFECTIVE status list, so a
-- sheet script posting to an inheriting sub-client accepts the parent's
-- column names. Signature is identical to 11_task_fields.sql (8 args), so
-- CREATE OR REPLACE is safe — no DROP, no ambiguous overload for PostgREST.
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
  eff jsonb;
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

  eff := proj.statuses;
  IF proj.inherit_statuses AND proj.parent_project_id IS NOT NULL THEN
    SELECT p.statuses INTO eff FROM projects p WHERE p.id = proj.parent_project_id;
    IF eff IS NULL OR jsonb_array_length(eff) = 0 THEN
      eff := proj.statuses; -- parent gone/empty: fall back to own snapshot
    END IF;
  END IF;

  final_status := p_status;
  IF final_status IS NULL OR NOT (eff ? final_status) THEN
    final_status := eff->>0;
  END IF;

  INSERT INTO tasks (project_id, title, notes, status, due_date, assignee_id, source, external_id, fields)
  VALUES (k.project_id, btrim(p_title), p_notes, final_status, p_due_date, p_assignee_id, 'api', p_external_id,
          COALESCE(p_fields, '{}'::jsonb))
  RETURNING id INTO new_id;

  UPDATE api_keys SET last_used_at = now() WHERE id = k.id;

  RETURN jsonb_build_object('ok', true, 'task_id', new_id, 'project_id', k.project_id, 'status', final_status);
END;
$$ LANGUAGE plpgsql;
