-- VBOG PM Tool — Row Level Security (PRD §4.3, Step 3)
-- Phase 1: open policies (no auth). Tighten in Phase 2 when auth lands.

ALTER TABLE projects     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "open" ON projects;
DROP POLICY IF EXISTS "open" ON tasks;
DROP POLICY IF EXISTS "open" ON team_members;

CREATE POLICY "open" ON projects     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open" ON tasks        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open" ON team_members FOR ALL USING (true) WITH CHECK (true);
