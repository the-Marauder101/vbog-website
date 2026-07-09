-- VBOG PM Tool — Seed default team members (PRD §4.3, Step 2)
-- Idempotent: safe to re-run.

INSERT INTO team_members (name, role) VALUES
  ('Depesh', 'CEO'),
  ('Alok',   'Sales'),
  ('Yogesh', 'Sales'),
  ('Ekta',   'Sales'),
  ('Rihen',  'Marketing')
ON CONFLICT (name) DO NOTHING;
