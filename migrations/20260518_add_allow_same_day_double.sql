-- Ensure allow_same_day_double exists on slake_term_enrollments.
-- The original migration (20260514_add_sessions_per_week.sql) may not have been applied.
ALTER TABLE slake_term_enrollments
  ADD COLUMN IF NOT EXISTS allow_same_day_double boolean NOT NULL DEFAULT false;
