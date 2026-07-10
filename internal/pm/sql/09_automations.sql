-- VBOG PM Tool — Per-project automations (Asana-style rules: trigger → action)
-- Rules belong to ONE project, so one client's hiring-pipeline automations
-- never fire on another client's board. Executed entirely inside Postgres by
-- the run_task_automations() trigger — same pg_net channel the Zapier
-- webhooks use, so a slow/dead URL never blocks a task save.
--
-- trigger_type: task_created | status_changed | assignee_changed | due_date_set
-- conditions  (jsonb, all keys optional — empty object = always match):
--   status_changed: {"from_status": "...", "to_status": "..."}
--   task_created:   {"status": "..."}  (only when created directly in that column)
-- action_type + action_config (jsonb):
--   call_webhook: {"url": "https://..."}          POST the task as JSON
--   set_status:   {"status": "..."}               move the task
--   set_assignee: {"member_id": "<uuid>"}         assign the task
--   notify_user:  {"member_id": "<uuid>", "message": "..."}  inbox notification

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS automations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          text NOT NULL,
  trigger_type  text NOT NULL,
  conditions    jsonb NOT NULL DEFAULT '{}',
  action_type   text NOT NULL,
  action_config jsonb NOT NULL DEFAULT '{}',
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS automations_project_idx ON automations(project_id);

ALTER TABLE automations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open" ON automations;
CREATE POLICY "open" ON automations FOR ALL USING (true) WITH CHECK (true);

-- Evaluate + run every matching automation for a task event. Each action is
-- wrapped in its own exception block: a misconfigured rule logs a warning
-- but NEVER blocks or fails the task write that triggered it.
CREATE OR REPLACE FUNCTION run_task_automations()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  fired text;
  payload jsonb;
BEGIN
  -- Depth guard: set_status / set_assignee actions UPDATE tasks, which fires
  -- this trigger again. One level of chaining is allowed (rule A moves the
  -- task, rule B may react once); beyond that we stop to prevent loops.
  IF pg_trigger_depth() > 2 THEN
    RETURN NEW;
  END IF;

  FOR a IN
    SELECT * FROM automations
    WHERE active AND project_id = NEW.project_id
  LOOP
    -- Does this rule's trigger + conditions match what just happened?
    fired := NULL;
    IF a.trigger_type = 'task_created' AND TG_OP = 'INSERT' THEN
      IF (a.conditions->>'status') IS NULL OR a.conditions->>'status' = NEW.status THEN
        fired := 'task_created';
      END IF;
    ELSIF a.trigger_type = 'status_changed' AND TG_OP = 'UPDATE'
      AND OLD.status IS DISTINCT FROM NEW.status THEN
      IF ((a.conditions->>'from_status') IS NULL OR a.conditions->>'from_status' = OLD.status)
        AND ((a.conditions->>'to_status') IS NULL OR a.conditions->>'to_status' = NEW.status) THEN
        fired := 'status_changed';
      END IF;
    ELSIF a.trigger_type = 'assignee_changed' AND TG_OP = 'UPDATE'
      AND OLD.assignee_id IS DISTINCT FROM NEW.assignee_id
      AND NEW.assignee_id IS NOT NULL THEN
      fired := 'assignee_changed';
    ELSIF a.trigger_type = 'due_date_set' AND TG_OP = 'UPDATE'
      AND OLD.due_date IS DISTINCT FROM NEW.due_date
      AND NEW.due_date IS NOT NULL THEN
      fired := 'due_date_set';
    END IF;

    IF fired IS NULL THEN
      CONTINUE;
    END IF;

    BEGIN
      IF a.action_type = 'call_webhook' THEN
        SELECT jsonb_build_object(
                 'event', fired,
                 'automation', jsonb_build_object('id', a.id, 'name', a.name),
                 'previous', CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object(
                   'status', OLD.status, 'assignee_id', OLD.assignee_id, 'due_date', OLD.due_date
                 ) END,
                 'task', to_jsonb(td))
          INTO payload
          FROM task_details td WHERE td.id = NEW.id;
        IF payload IS NULL THEN
          payload := jsonb_build_object('event', fired, 'task', to_jsonb(NEW));
        END IF;
        PERFORM net.http_post(
          url     := a.action_config->>'url',
          body    := payload,
          headers := '{"Content-Type": "application/json"}'::jsonb
        );

      ELSIF a.action_type = 'set_status' THEN
        IF NEW.status IS DISTINCT FROM (a.action_config->>'status') THEN
          UPDATE tasks SET status = a.action_config->>'status' WHERE id = NEW.id;
        END IF;

      ELSIF a.action_type = 'set_assignee' THEN
        IF NEW.assignee_id IS DISTINCT FROM (a.action_config->>'member_id')::uuid THEN
          UPDATE tasks SET assignee_id = (a.action_config->>'member_id')::uuid WHERE id = NEW.id;
        END IF;

      ELSIF a.action_type = 'notify_user' THEN
        INSERT INTO notifications (member_id, kind, task_id, project_id, message)
        VALUES (
          (a.action_config->>'member_id')::uuid,
          'automation',
          NEW.id,
          NEW.project_id,
          COALESCE(NULLIF(a.action_config->>'message', ''), a.name || ': ' || NEW.title)
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'automation % (%) failed: %', a.name, a.id, SQLERRM;
    END;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_automations ON tasks;
CREATE TRIGGER tasks_automations
AFTER INSERT OR UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION run_task_automations();

-- "Send test" for webhook-action rules: fires a sample payload through the
-- same pg_net channel real deliveries use. Called via PostgREST RPC.
CREATE OR REPLACE FUNCTION send_test_automation(automation_id uuid)
RETURNS void
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM automations WHERE id = automation_id;
  IF a.id IS NULL THEN
    RAISE EXCEPTION 'automation not found';
  END IF;
  IF a.action_type <> 'call_webhook' THEN
    RAISE EXCEPTION 'only webhook automations support test sends';
  END IF;
  PERFORM net.http_post(
    url  := a.action_config->>'url',
    body := jsonb_build_object(
      'event', 'TEST',
      'automation', jsonb_build_object('id', a.id, 'name', a.name),
      'task', jsonb_build_object(
        'id', '00000000-0000-0000-0000-000000000000',
        'title', 'Test task from Vyom automations',
        'notes', 'This is a test delivery — your automation webhook is connected.',
        'status', 'To Do',
        'due_date', current_date,
        'project_name', 'Sample Project',
        'assignee_name', 'Sample Member',
        'source', 'manual',
        'created_at', now(),
        'updated_at', now()
      )
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
END;
$$ LANGUAGE plpgsql;
