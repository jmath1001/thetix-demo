-- Support for students attending more than once per week per subject,
-- multiple sessions on the same day, and per-subject tutor preferences.
--
-- subject_sessions_per_week: JSONB map of subject → desired sessions per week
--   e.g. {"Algebra": 2, "SAT Math": 1}
--   Defaults to {} (treated as 1 per subject).
--
-- allow_same_day_double: when true the scheduler may place two sessions
--   for the same student on the same calendar day.
--
-- subject_tutor_preference: JSONB map of subject → tutor UUID
--   e.g. {"Algebra": "uuid-of-tutor"}
--   The scheduler scores preferred-tutor seats higher but will still fall
--   back to any qualified tutor if the preferred one has no availability.

ALTER TABLE slake_term_enrollments
  ADD COLUMN IF NOT EXISTS subject_sessions_per_week  jsonb    NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS allow_same_day_double       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subject_tutor_preference   jsonb    NOT NULL DEFAULT '{}'::jsonb;
