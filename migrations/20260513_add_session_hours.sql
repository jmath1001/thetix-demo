-- Hours deducted per attended session (default 2h per class)
ALTER TABLE slake_students
  ADD COLUMN IF NOT EXISTS session_hours integer NOT NULL DEFAULT 2;
