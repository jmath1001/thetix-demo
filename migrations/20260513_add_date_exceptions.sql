ALTER TABLE slake_terms
  ADD COLUMN IF NOT EXISTS date_exceptions jsonb DEFAULT NULL;
