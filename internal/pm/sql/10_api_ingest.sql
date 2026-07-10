-- VBOG PM Tool — Native inbound API (Zapier-free task creation)
-- Per-project API keys + an ingest_task() RPC so any external script (Google
-- Apps Script, curl, a form backend…) can create tasks with one HTTPS POST:
--   POST {SUPABASE_URL}/rest/v1/rpc/ingest_task
--   headers: apikey + Authorization (anon key), Content-Type: application/json
--   body: {"p_api_key":"vyom_…","p_title":"…", ...optional fields}
-- The key (not the anon key) decides WHICH project the task lands in, so a
-- leaked snippet can only ever write to its own project. Keys are managed
-- self-serve from the app's Settings page.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key          text NOT NULL UNIQUE DEFAULT 'vyom_' || encode(gen_random_bytes(18), 'hex'),
  label        text NOT NULL,
  active       boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open" ON api_keys;
CREATE POLICY "open" ON api_keys FOR ALL USING (true) WITH CHECK (true);

-- Create one task, authenticated by a Vyom API key. Returns {ok, task_id}.
-- An unknown status silently falls back to the project's first column rather
-- than erroring — sheet scripts shouldn't break because a column was renamed.
CREATE OR REPLACE FUNCTION ingest_task(
  p_api_key     text,
  p_title       text,
  p_notes       text DEFAULT NULL,
  p_status      text DEFAULT NULL,
  p_due_date    date DEFAULT NULL,
  p_assignee_id uuid DEFAULT NULL,
  p_external_id text DEFAULT NULL
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

  INSERT INTO tasks (project_id, title, notes, status, due_date, assignee_id, source, external_id)
  VALUES (k.project_id, btrim(p_title), p_notes, final_status, p_due_date, p_assignee_id, 'api', p_external_id)
  RETURNING id INTO new_id;

  UPDATE api_keys SET last_used_at = now() WHERE id = k.id;

  RETURN jsonb_build_object('ok', true, 'task_id', new_id, 'project_id', k.project_id, 'status', final_status);
END;
$$ LANGUAGE plpgsql;
