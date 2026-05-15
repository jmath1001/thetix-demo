-- Per-student email notification preferences.
-- All three default to true so existing records keep receiving reminders.
ALTER TABLE slake_students
  ADD COLUMN IF NOT EXISTS notify_student boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_mom     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_dad     boolean NOT NULL DEFAULT true;
