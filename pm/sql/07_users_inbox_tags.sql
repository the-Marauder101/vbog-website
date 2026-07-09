-- Vyom v2: users & login gate, per-project access, notifications inbox, tag registry.

-- Users: team_members.role stays the job title; user_role is the permission level.
ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS login_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS user_role text NOT NULL DEFAULT 'member'
    CHECK (user_role IN ('admin', 'member', 'external'));

-- Per-project access for external users (members/admins see everything).
CREATE TABLE IF NOT EXISTS project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_id  uuid NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (project_id, member_id)
);

-- Inbox: one row per notification; kind + data keep it extensible.
CREATE TABLE IF NOT EXISTS notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  uuid NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  actor_id   uuid REFERENCES team_members(id) ON DELETE SET NULL,
  task_id    uuid REFERENCES tasks(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  message    text,
  data       jsonb NOT NULL DEFAULT '{}',
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_inbox_idx
  ON notifications (member_id, read, created_at DESC);

-- Central tag registry: the only place tags are created, so names never duplicate.
CREATE TABLE IF NOT EXISTS tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]';

-- Open phase-1 RLS, same as the other tables.
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags            ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_members_all ON project_members;
CREATE POLICY project_members_all ON project_members FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS notifications_all ON notifications;
CREATE POLICY notifications_all ON notifications FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS tags_all ON tags;
CREATE POLICY tags_all ON tags FOR ALL USING (true) WITH CHECK (true);

-- Bootstrap the four current users (update by name if they already exist).
INSERT INTO team_members (name, user_role, login_code)
VALUES
  ('Depesh', 'admin',  'depesh'),
  ('Sahil',  'member', 'sahil'),
  ('Rihen',  'member', 'rihen'),
  ('Sarika', 'member', 'sarika')
ON CONFLICT (name) DO UPDATE
  SET user_role  = EXCLUDED.user_role,
      login_code = COALESCE(team_members.login_code, EXCLUDED.login_code),
      active     = true;
