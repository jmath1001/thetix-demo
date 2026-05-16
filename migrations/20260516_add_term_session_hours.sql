-- Per-term default hours deducted per attended session
ALTER TABLE slake_terms
  ADD COLUMN IF NOT EXISTS session_hours integer NOT NULL DEFAULT 2;
