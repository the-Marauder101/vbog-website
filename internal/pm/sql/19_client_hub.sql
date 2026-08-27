-- VBOG PM Tool — the client registry becomes the hub
-- Run in Supabase SQL Editor after 01–18. Idempotent.
--
-- sql/18 made `clients` the source of the Client dropdown on cards. Two things
-- were still outside it:
--
--   1. The HR client tracker (sql/17) kept its own free-text client names, so
--      the same client could be "Newmetech" on a card and "NewMeTech" in the
--      tracker — two clients as far as anything that groups by name is
--      concerned. Its Client column becomes a registry-backed dropdown.
--   2. The registry held nothing but a name. A client is the natural home for
--      who runs it, who to talk to, and what it pays — information that
--      currently lives in people's heads or in a Notes cell.
--
-- Deliberately NOT done here: switching tasks.fields.client from the name to
-- clients.id. Every filter, report and webhook payload keys on the name, so an
-- id would be a migration across all of them; what an id actually buys is
-- rename safety, and `rename_client()` below buys that outright for far less.

-- ---------------------------------------------------------------------------
-- 1. What a client can carry
-- ---------------------------------------------------------------------------
-- Real columns, not a jsonb blob: this is one global table with a fixed shape,
-- unlike the per-project tracker where the columns are the configurable part.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS owner_id      uuid REFERENCES team_members(id) ON DELETE SET NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_name  text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS rate          text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes         text;

-- owner_id is ON DELETE SET NULL, matching tasks.assignee_id: deleting a
-- departed employee must not take the client row with them.
CREATE INDEX IF NOT EXISTS clients_owner_idx ON clients(owner_id) WHERE owner_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. A `client` column type for the tracker
-- ---------------------------------------------------------------------------
-- The tracker's typed columns (sql/17) gain a fifth type. It stores the same
-- thing a `text` column did — the client NAME — so no tracker row changes
-- meaning; what changes is that the cell is a dropdown off the registry
-- instead of a free-text box.
--
-- Seed first: any name already typed into a tracker cell becomes a registry
-- entry, or converting the column would strand it as a value nobody can pick.
INSERT INTO clients (name)
SELECT DISTINCT btrim(c.values->>'client_name')
  FROM hr_clients c
 WHERE COALESCE(btrim(c.values->>'client_name'), '') <> ''
ON CONFLICT (name) DO NOTHING;

-- Convert the Client column on every project that still has it as text.
-- Keyed on `key = 'client_name'`, which is the column sql/17 ships; a column
-- somebody added by hand is left alone.
UPDATE projects p
   SET hr_client_columns = (
     SELECT jsonb_agg(
              CASE WHEN col->>'key' = 'client_name' AND col->>'type' = 'text'
                   THEN col || '{"type":"client"}'::jsonb
                   ELSE col END
              ORDER BY ord)
       FROM jsonb_array_elements(p.hr_client_columns) WITH ORDINALITY AS t(col, ord)
   )
 WHERE p.hr_client_columns IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(p.hr_client_columns) col
      WHERE col->>'key' = 'client_name' AND col->>'type' = 'text'
   );

-- And the default, so a new HR board starts with the dropdown too.
ALTER TABLE projects
  ALTER COLUMN hr_client_columns SET DEFAULT '[
    {"key":"client_name","label":"Client","type":"client"},
    {"key":"signed_on","label":"Signed On","type":"date"},
    {"key":"requirement_on","label":"Requirement Received","type":"date"},
    {"key":"first_profiles_on","label":"Profiles Shared","type":"date"},
    {"key":"first_interview_on","label":"Interviews Started","type":"date"},
    {"key":"delivered_on","label":"Delivered","type":"date"},
    {"key":"days_to_deliver","label":"Days to Deliver","type":"duration","from":"signed_on","to":"delivered_on"},
    {"key":"notes","label":"Notes","type":"text"}
  ]';

-- ---------------------------------------------------------------------------
-- 3. Renaming a client, everywhere, at once
-- ---------------------------------------------------------------------------
-- This is what makes storing the NAME safe. A rename updates the registry,
-- every card's tasks.fields.client, every tracker cell and every report filter
-- in ONE transaction — so there is no window where half the app points at a
-- name that no longer exists.
--
-- Returns what it touched, so the UI can say "renamed on 41 cards" rather than
-- leaving the user to wonder whether it reached everything.
CREATE OR REPLACE FUNCTION rename_client(p_client_id uuid, p_new_name text)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old     text;
  v_new     text := btrim(p_new_name);
  v_tasks   int;
  v_tracker int;
  v_reports int;
BEGIN
  IF v_new = '' THEN
    RAISE EXCEPTION 'client name cannot be empty';
  END IF;

  SELECT name INTO v_old FROM clients WHERE id = p_client_id;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'client not found';
  END IF;
  IF v_old = v_new THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true);
  END IF;
  -- Case-insensitive, because near-duplicates are the whole thing the registry
  -- exists to prevent. A pure case correction of this same row is allowed.
  IF EXISTS (SELECT 1 FROM clients WHERE lower(name) = lower(v_new) AND id <> p_client_id) THEN
    RAISE EXCEPTION 'a client named % already exists', v_new;
  END IF;

  UPDATE clients SET name = v_new WHERE id = p_client_id;

  UPDATE tasks SET fields = jsonb_set(fields, '{client}', to_jsonb(v_new))
   WHERE fields->>'client' = v_old;
  GET DIAGNOSTICS v_tasks = ROW_COUNT;

  UPDATE hr_clients SET values = jsonb_set(values, '{client_name}', to_jsonb(v_new))
   WHERE values->>'client_name' = v_old;
  GET DIAGNOSTICS v_tracker = ROW_COUNT;

  -- Report filters store status/client NAMES too (sql/18), so they go stale in
  -- exactly the same way — a filter pointing at the old name would silently
  -- start matching nothing.
  UPDATE daily_report_configs
     SET filter_clients = array_replace(filter_clients, v_old, v_new)
   WHERE v_old = ANY (filter_clients);
  GET DIAGNOSTICS v_reports = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'from', v_old, 'to', v_new,
                            'tasks', v_tasks, 'tracker', v_tracker, 'reports', v_reports);
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 4. What a client actually looks like across the tool
-- ---------------------------------------------------------------------------
-- One row per client with the counts Settings needs, computed rather than kept
-- in sync by hand. A view, not a materialised one: the numbers are small and a
-- stale count is worse than a slightly slower page.
CREATE OR REPLACE VIEW client_overview AS
SELECT c.id,
       c.name,
       c.active,
       c.owner_id,
       tm.name AS owner_name,
       c.contact_name,
       c.contact_email,
       c.rate,
       c.notes,
       c.created_at,
       (SELECT count(*) FROM tasks t WHERE t.fields->>'client' = c.name)         AS card_count,
       (SELECT count(*) FROM hr_clients h WHERE h.values->>'client_name' = c.name) AS tracker_rows,
       (SELECT count(DISTINCT t.project_id) FROM tasks t WHERE t.fields->>'client' = c.name) AS project_count
  FROM clients c
  LEFT JOIN team_members tm ON tm.id = c.owner_id;
