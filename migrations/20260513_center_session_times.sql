-- Move session_times_by_day to center settings so they're universal across all terms
ALTER TABLE slake_center_settings
  ADD COLUMN IF NOT EXISTS session_times_by_day jsonb;
