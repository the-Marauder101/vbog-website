-- VBOG PM Tool — hideable status columns + a change log for every task
-- Run in Supabase SQL Editor after 01–13. Idempotent.
--
-- Three things ship here:
--   1. projects.hidden_statuses / hidden_ops_statuses — columns an ADMIN has
--      folded away for the whole project. Non-admins hide columns for
--      themselves only, in localStorage (no server state for that).
--   2. task_changelog — one row per changed field, for EVERY task in EVERY
--      project. Written by a database trigger, so Zapier, the Vyom API and
--      automations are recorded exactly like a click in the UI.
--   3. A repair for status_changed_at (the HR "Stage Date"), which sql/13
--      stamped with the migration's clock for every pre-existing row.

-- ---------------------------------------------------------------------------
-- 1. Hidden status columns (project-level = set by an admin, shared by all)
-- ---------------------------------------------------------------------------
-- Names, not indexes: statuses are reorderable, so an index would drift.
-- A name that is no longer a column is simply ignored on read; dashboard.js
-- prunes the arrays whenever the status list is edited.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS hidden_statuses jsonb NOT NULL DEFAULT '[]';
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS hidden_ops_statuses jsonb NOT NULL DEFAULT '[]';

-- ---------------------------------------------------------------------------
-- 2. Who did it: the client stamps every task write with the acting user
-- ---------------------------------------------------------------------------
-- There is no server of our own, so the browser has to tell the database who
-- is acting. api.js merges last_actor_id into every task INSERT/PATCH — the
-- same request, so no extra round trip and no spurious webhook/automation
-- fires. Deletes go through delete_task_logged() below instead, because the
-- row is gone by the time the trigger runs.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS last_actor_id uuid REFERENCES team_members(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 3. The change log itself
-- ---------------------------------------------------------------------------
-- One row per changed FIELD (not per save), which is what makes the history
-- readable: "Depesh moved R1 Selected → R2 Rejected" is a single row.
-- task_id goes NULL when the task is deleted (ON DELETE SET NULL) while
-- task_title keeps a snapshot, so a deleted task's history survives — the
-- whole point of an audit trail. project_id cascades: deleting a project
-- really should take its log with it.
CREATE TABLE IF NOT EXISTS task_changelog (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid REFERENCES tasks(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  task_title text,
  actor_id   uuid REFERENCES team_members(id) ON DELETE SET NULL,
  actor_name text,                -- snapshot: readable even if the user is deleted
  action     text NOT NULL,       -- created | updated | deleted
  field      text,                -- status | title | notes | due_date | assignee | <fields key>
  old_value  text,
  new_value  text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_changelog_task_idx    ON task_changelog(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS task_changelog_project_idx ON task_changelog(project_id, created_at DESC);
-- Feeds the HR "Stage Date" history without scanning the whole log
CREATE INDEX IF NOT EXISTS task_changelog_status_idx  ON task_changelog(task_id, created_at DESC)
  WHERE field = 'status';

ALTER TABLE task_changelog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open" ON task_changelog;
CREATE POLICY "open" ON task_changelog FOR ALL USING (true) WITH CHECK (true);

-- Nobody may rewrite history: the trigger is the only writer, and the REST
-- API must not be able to edit or erase rows even with the publishable key.
DROP POLICY IF EXISTS "no_update" ON task_changelog;
DROP POLICY IF EXISTS "no_delete" ON task_changelog;
REVOKE UPDATE, DELETE ON task_changelog FROM anon, authenticated;
-- INSERT stays revoked too — the trigger runs as the table owner, not as the
-- caller, so it is unaffected.
-- TRUNCATE as well: Supabase's default grants hand it out, and it would erase
-- the whole log in one request.
REVOKE INSERT, TRUNCATE ON task_changelog FROM anon, authenticated;
-- …but the app must be able to read it (the history panels).
GRANT SELECT ON task_changelog TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The trigger that records everything
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_task_changes()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      uuid;
  v_actor_name text;
  v_task       uuid;
  v_project    uuid;
  v_title      text;
  v_action     text;
  -- depth > 1 means another trigger caused this write, i.e. an automation
  -- rule from sql/09 — not the person whose id is still on last_actor_id.
  v_auto       boolean := pg_trigger_depth() > 1;
  v_changes    jsonb := '[]'::jsonb;
  k            text;
  ov           text;
  nv           text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- The row is already gone, so the actor arrives through a transaction-local
    -- setting that delete_task_logged() sets just before the DELETE.
    v_actor   := nullif(current_setting('vyom.actor_id', true), '')::uuid;
    v_task    := NULL;
    v_project := OLD.project_id;
    v_title   := OLD.title;
    v_action  := 'deleted';
  ELSE
    v_actor   := NEW.last_actor_id;
    v_task    := NEW.id;
    v_project := NEW.project_id;
    v_title   := NEW.title;
    v_action  := CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END;
  END IF;

  IF v_auto THEN v_actor := NULL; END IF;

  SELECT name INTO v_actor_name FROM team_members WHERE id = v_actor;
  IF v_actor_name IS NULL THEN
    v_actor_name := CASE
      WHEN v_auto THEN 'Automation'
      WHEN TG_OP <> 'DELETE' AND NEW.source = 'api'    THEN 'Vyom API'
      WHEN TG_OP <> 'DELETE' AND NEW.source = 'zapier' THEN 'Zapier'
      ELSE 'Unknown' END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Created rows carry the opening status, so field='status' alone is the
    -- complete stage history of a card (creation included).
    INSERT INTO task_changelog (task_id, project_id, task_title, actor_id, actor_name, action, field, new_value)
    VALUES (v_task, v_project, v_title, v_actor, v_actor_name, 'created', 'status', NEW.status);
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO task_changelog (task_id, project_id, task_title, actor_id, actor_name, action, field, old_value)
    VALUES (v_task, v_project, v_title, v_actor, v_actor_name, 'deleted', 'status', OLD.status);
    RETURN NULL;
  END IF;

  -- UPDATE: one entry per tracked field that actually changed. Bookkeeping
  -- columns (updated_at, status_changed_at, last_actor_id) are deliberately
  -- not tracked, so stamping the actor alone never writes a log row.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_changes := v_changes || jsonb_build_object('f', 'status', 'o', OLD.status, 'n', NEW.status);
  END IF;
  IF NEW.title IS DISTINCT FROM OLD.title THEN
    v_changes := v_changes || jsonb_build_object('f', 'title', 'o', OLD.title, 'n', NEW.title);
  END IF;
  IF NEW.notes IS DISTINCT FROM OLD.notes THEN
    v_changes := v_changes || jsonb_build_object('f', 'notes', 'o', OLD.notes, 'n', NEW.notes);
  END IF;
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    v_changes := v_changes || jsonb_build_object('f', 'due_date', 'o', OLD.due_date, 'n', NEW.due_date);
  END IF;
  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    v_changes := v_changes || jsonb_build_object(
      'f', 'assignee',
      'o', (SELECT name FROM team_members WHERE id = OLD.assignee_id),
      'n', (SELECT name FROM team_members WHERE id = NEW.assignee_id));
  END IF;
  -- fields jsonb: diff per key, so "client" and "email" read as their own
  -- entries and future keys are logged with no further migration.
  FOR k IN
    SELECT key FROM (
      SELECT jsonb_object_keys(COALESCE(OLD.fields, '{}'::jsonb)) AS key
      UNION
      SELECT jsonb_object_keys(COALESCE(NEW.fields, '{}'::jsonb)) AS key
    ) s ORDER BY key
  LOOP
    ov := OLD.fields ->> k;
    nv := NEW.fields ->> k;
    IF ov IS DISTINCT FROM nv THEN
      v_changes := v_changes || jsonb_build_object('f', k, 'o', ov, 'n', nv);
    END IF;
  END LOOP;

  IF jsonb_array_length(v_changes) > 0 THEN
    INSERT INTO task_changelog (task_id, project_id, task_title, actor_id, actor_name, action, field, old_value, new_value)
    SELECT v_task, v_project, v_title, v_actor, v_actor_name, 'updated', e ->> 'f', e ->> 'o', e ->> 'n'
    FROM jsonb_array_elements(v_changes) e;
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- History is valuable but never worth losing a task edit over (same
  -- philosophy as the webhook and automation triggers).
  RAISE WARNING 'log_task_changes failed: %', SQLERRM;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_changelog ON tasks;
CREATE TRIGGER tasks_changelog
AFTER INSERT OR UPDATE OR DELETE ON tasks
FOR EACH ROW EXECUTE FUNCTION log_task_changes();

-- ---------------------------------------------------------------------------
-- 5. Deleting a task, with attribution
-- ---------------------------------------------------------------------------
-- A plain DELETE can't carry the actor (nothing left to read it from), and
-- PATCHing the row first would fire webhooks and automations for a change
-- that never happened. So the client calls this instead: one round trip, the
-- actor lands in a transaction-local setting the trigger reads.
CREATE OR REPLACE FUNCTION delete_task_logged(p_task_id uuid, p_actor_id uuid DEFAULT NULL)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int;
BEGIN
  PERFORM set_config('vyom.actor_id', COALESCE(p_actor_id::text, ''), true);
  DELETE FROM tasks WHERE id = p_task_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_deleted > 0, 'deleted', v_deleted);
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 6. task_details gains the stage date
-- ---------------------------------------------------------------------------
-- HR automations need "how long has this candidate sat here" in the payload.
-- DROP first: CREATE OR REPLACE can't insert a column mid-view. Safe — only
-- plpgsql functions read the view and they resolve it at runtime.
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
  t.status_changed_at,
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

-- ---------------------------------------------------------------------------
-- 7. One-time repair of the HR Stage Date
-- ---------------------------------------------------------------------------
-- sql/13 added status_changed_at as "DEFAULT now()", so every row that already
-- existed was stamped with the moment that migration ran rather than when the
-- card actually entered its status. Those rows all share one identical
-- timestamp, which is what makes them identifiable. created_at is the only
-- honest value we have for them.
--
-- No-op on a fresh database (the column is added to an empty table) and on
-- re-runs (after the fix the timestamps no longer match). If you are repairing
-- a different deployment, find your own value with:
--   SELECT status_changed_at, count(*) FROM tasks GROUP BY 1 HAVING count(*) > 1;
UPDATE tasks
SET status_changed_at = created_at
WHERE status_changed_at = '2026-07-16 18:08:25.527838+00'::timestamptz
  AND status_changed_at > created_at;
