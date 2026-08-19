-- VBOG PM Tool — HR client tracker
-- Run in Supabase SQL Editor after 01–16. Idempotent.
--
-- A second table on HR boards, beside the Roles Summary: one row per client,
-- tracking the dates a client passes through — signed, requirement received,
-- profiles shared, delivered — so "how long did that client actually take"
-- stops being a thing people reconstruct from memory.
--
-- Columns are defined per project (label + TYPE), which is the part the roles
-- card doesn't do: hr_role_columns is text-only, so a date there is just a
-- string nobody can subtract. Types here are text | date | number | duration,
-- and `duration` is COMPUTED from two date columns rather than stored — the
-- elapsed time can never drift out of sync with the dates it comes from.

-- ---------------------------------------------------------------------------
-- 1. Column definitions, per project
-- ---------------------------------------------------------------------------
-- Shape: [{"key","label","type"}] and, for type='duration',
--        {"from":"<key>","to":"<key>"}.
-- The default is a working client lifecycle, so a new HR board is useful
-- before anyone configures anything.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS hr_client_columns jsonb DEFAULT '[
    {"key":"client_name","label":"Client","type":"text"},
    {"key":"signed_on","label":"Signed On","type":"date"},
    {"key":"requirement_on","label":"Requirement Received","type":"date"},
    {"key":"first_profiles_on","label":"Profiles Shared","type":"date"},
    {"key":"first_interview_on","label":"Interviews Started","type":"date"},
    {"key":"delivered_on","label":"Delivered","type":"date"},
    {"key":"days_to_deliver","label":"Days to Deliver","type":"duration","from":"signed_on","to":"delivered_on"},
    {"key":"notes","label":"Notes","type":"text"}
  ]';

-- ---------------------------------------------------------------------------
-- 2. The rows
-- ---------------------------------------------------------------------------
-- Mirrors hr_roles exactly (values jsonb keyed by column key), so the same
-- inline-edit UI pattern works and adding a column never needs a migration.
CREATE TABLE IF NOT EXISTS hr_clients (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  values     jsonb NOT NULL DEFAULT '{}',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hr_clients_project_idx ON hr_clients(project_id, sort_order);

ALTER TABLE hr_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open" ON hr_clients;
CREATE POLICY "open" ON hr_clients FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 3. Turn it on for HR projects
-- ---------------------------------------------------------------------------
-- features.clients_card follows the same rule as the other HR features: an
-- explicit key wins, otherwise HR projects default ON and normal ones OFF
-- (resolved client-side by UI.hasFeature).
UPDATE projects
   SET features = features || '{"clients_card": true}'::jsonb
 WHERE type = 'hr'
   AND NOT (features ? 'clients_card');
