-- VBOG PM Tool — Sub-client projects (client-of-client tracking)
-- A project may belong to a parent project: the parent is our direct client,
-- the child is one of THEIR internal clients. One level deep only (enforced
-- in the UI). Sub-client tasks are excluded from the All Tasks view by
-- default so they never skew our own reporting unless explicitly included.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS parent_project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS projects_parent_idx ON projects(parent_project_id)
  WHERE parent_project_id IS NOT NULL;
