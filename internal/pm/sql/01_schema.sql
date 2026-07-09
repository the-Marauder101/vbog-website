-- VBOG PM Tool — Schema (PRD §4.3, Step 1)
-- Run in Supabase SQL Editor on a fresh project.

CREATE TABLE IF NOT EXISTS projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  statuses    jsonb NOT NULL DEFAULT '["To Do","In Progress","Blocked","Done"]',
  color       text,
  created_at  timestamptz DEFAULT now(),
  archived    boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS team_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  role       text,
  active     boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       text NOT NULL,
  notes       text,
  status      text NOT NULL,
  assignee_id uuid REFERENCES team_members(id) ON DELETE SET NULL,
  due_date    date,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  source      text,
  external_id text
);

-- Auto-update updated_at on task change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_updated_at ON tasks;
CREATE TRIGGER tasks_updated_at
BEFORE UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION update_updated_at();
