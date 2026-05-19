-- Add per-subject scheduling preference columns to slake_term_enrollments.
-- Covers subject_sessions_per_week, allow_same_day_double, and subject_tutor_preference
-- in case the original 20260514_add_sessions_per_week migration was not applied.
ALTER TABLE slake_term_enrollments
  ADD COLUMN IF NOT EXISTS subject_sessions_per_week  jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS allow_same_day_double       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subject_tutor_preference   jsonb   NOT NULL DEFAULT '{}'::jsonb;
