-- Add a freeform notes field to center settings (persists globally, not per-week)
ALTER TABLE slake_center_settings
  ADD COLUMN IF NOT EXISTS notes TEXT;
