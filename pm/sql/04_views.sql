-- VBOG PM Tool — task_details view for Zapier Flow B (PRD §7.4)
-- Joins tasks + projects + team_members so webhook payloads carry
-- human-readable names instead of UUIDs.

CREATE OR REPLACE VIEW task_details AS
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
  p.name  AS project_name,
  p.id    AS project_id,
  tm.name AS assignee_name,
  tm.id   AS assignee_id
FROM tasks t
JOIN projects p            ON p.id  = t.project_id
LEFT JOIN team_members tm  ON tm.id = t.assignee_id;
