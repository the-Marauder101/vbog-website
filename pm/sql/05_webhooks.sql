-- VBOG PM Tool — Self-serve outgoing webhooks
-- Task events (create/update/delete) are POSTed by the database itself to
-- every URL registered in the webhooks table. Team members manage these
-- from the app's Settings page — no Supabase dashboard access needed.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS webhooks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL,
  url        text NOT NULL,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE, -- NULL = all projects
  events     jsonb NOT NULL DEFAULT '["INSERT","UPDATE"]',
  active     boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open" ON webhooks;
CREATE POLICY "open" ON webhooks FOR ALL USING (true) WITH CHECK (true);

-- Fan out one task event to all matching registered webhooks.
-- Uses pg_net (async) so task writes never block or fail on a slow/dead URL.
CREATE OR REPLACE FUNCTION notify_task_webhooks()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w record;
  payload jsonb;
  proj uuid;
BEGIN
  proj := COALESCE(NEW.project_id, OLD.project_id);

  IF TG_OP = 'DELETE' THEN
    payload := jsonb_build_object('event', 'DELETE', 'task', to_jsonb(OLD));
  ELSE
    SELECT jsonb_build_object('event', TG_OP, 'task', to_jsonb(td))
      INTO payload
      FROM task_details td WHERE td.id = NEW.id;
    -- Fallback (shouldn't happen): raw row if the view returned nothing
    IF payload IS NULL THEN
      payload := jsonb_build_object('event', TG_OP, 'task', to_jsonb(NEW));
    END IF;
  END IF;

  FOR w IN
    SELECT * FROM webhooks
    WHERE active
      AND (project_id IS NULL OR project_id = proj)
      AND events ? TG_OP
  LOOP
    PERFORM net.http_post(
      url     := w.url,
      body    := payload,
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_webhooks ON tasks;
CREATE TRIGGER tasks_webhooks
AFTER INSERT OR UPDATE OR DELETE ON tasks
FOR EACH ROW EXECUTE FUNCTION notify_task_webhooks();

-- "Send test" button in the app: fires a sample payload through the same
-- pg_net channel real deliveries use. Called via PostgREST RPC.
CREATE OR REPLACE FUNCTION send_test_webhook(webhook_id uuid)
RETURNS void
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w record;
BEGIN
  SELECT * INTO w FROM webhooks WHERE id = webhook_id;
  IF w.id IS NULL THEN
    RAISE EXCEPTION 'webhook not found';
  END IF;
  PERFORM net.http_post(
    url  := w.url,
    body := jsonb_build_object(
      'event', 'TEST',
      'task', jsonb_build_object(
        'id', '00000000-0000-0000-0000-000000000000',
        'title', 'Test task from VBOG PM',
        'notes', 'This is a test delivery — your webhook is connected.',
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
