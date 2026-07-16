-- VBOG PM Tool — HR project type, roles card, SLA tracking
-- Run in Supabase SQL Editor after 01–12.
--
-- Separates project "type" (normal/hr) from "visibility" (internal/client).
-- Adds: roles summary table, SLA rules, status-change timestamps, per-project
-- feature toggles, and a dedicated Ops board for HR projects.

-- 1. Rename the old "type" column to "visibility" (internal/client stays as-is)
ALTER TABLE projects RENAME COLUMN type TO visibility;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_type_check;
ALTER TABLE projects ADD CONSTRAINT projects_visibility_check
  CHECK (visibility IN ('internal', 'client'));

-- 2. New "type" column: normal (default) or hr
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'normal'
  CHECK (type IN ('normal', 'hr'));

-- 3. Ops board columns for HR projects (separate from hiring statuses)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ops_statuses jsonb DEFAULT '["To Do","In Progress","Done"]';

-- 4. Column config for the roles summary card
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS hr_role_columns jsonb DEFAULT '[
    {"key":"client_name","label":"Client Name"},
    {"key":"role_title","label":"Role Title"},
    {"key":"openings","label":"# Openings"},
    {"key":"salary_range","label":"Salary Range"},
    {"key":"notes","label":"Notes"}
  ]';

-- 5. Per-project feature toggles (auto_date, sla, roles_card, board_tabs)
--    HR projects default all ON; normal projects default all OFF.
--    Missing key = OFF for normal, ON for hr (resolved client-side).
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '{}';

-- 6. Track when a task entered its current status (SLA computation)
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz DEFAULT now();

CREATE OR REPLACE FUNCTION update_status_changed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.status_changed_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_status_changed_at ON tasks;
CREATE TRIGGER tasks_status_changed_at
BEFORE UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION update_status_changed_at();

-- 7. Roles summary table (one row per open role in an HR project)
CREATE TABLE IF NOT EXISTS hr_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  values     jsonb NOT NULL DEFAULT '{}',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hr_roles_project_idx ON hr_roles(project_id);
ALTER TABLE hr_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open" ON hr_roles;
CREATE POLICY "open" ON hr_roles FOR ALL USING (true) WITH CHECK (true);

-- 8. SLA rules: "tasks in status X must move within N days"
CREATE TABLE IF NOT EXISTS hr_sla_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_status   text NOT NULL,
  deadline_days int NOT NULL,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hr_sla_rules_project_idx ON hr_sla_rules(project_id);
ALTER TABLE hr_sla_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open" ON hr_sla_rules;
CREATE POLICY "open" ON hr_sla_rules FOR ALL USING (true) WITH CHECK (true);

-- 9. Convert "Get Closers" to an HR project
UPDATE projects
SET type = 'hr',
    features = '{"auto_date":true,"sla":true,"roles_card":true,"board_tabs":true}'
WHERE name ILIKE '%get closers%' OR name ILIKE '%getclosers%';
