-- Add project type: 'internal' (default) or 'client'
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'internal'
  CHECK (type IN ('internal', 'client'));
