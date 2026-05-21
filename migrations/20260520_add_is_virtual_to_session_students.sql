-- Add is_virtual flag to slake_session_students so an individual student
-- can be marked as attending virtually while others in the same slot are in-person.
ALTER TABLE slake_session_students
  ADD COLUMN IF NOT EXISTS is_virtual boolean NOT NULL DEFAULT false;
