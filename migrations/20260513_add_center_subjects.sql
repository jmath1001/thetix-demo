ALTER TABLE slake_center_settings
  ADD COLUMN IF NOT EXISTS subjects jsonb DEFAULT NULL;
