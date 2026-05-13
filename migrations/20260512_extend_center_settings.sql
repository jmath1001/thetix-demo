-- Add configurable fields to center settings
ALTER TABLE slake_center_settings
  ADD COLUMN IF NOT EXISTS center_short_name     text,
  ADD COLUMN IF NOT EXISTS center_phone          text,
  ADD COLUMN IF NOT EXISTS center_address        text,
  ADD COLUMN IF NOT EXISTS enrollment_instructions text,
  ADD COLUMN IF NOT EXISTS tutor_portal_message  text,
  ADD COLUMN IF NOT EXISTS session_duration_minutes int4 DEFAULT 110;
