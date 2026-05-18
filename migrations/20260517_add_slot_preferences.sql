-- Ranked slot preferences captured from the paper survey.
-- Format: array of up to 3 choices, each choice is an array of 1–2 availability
-- block strings ("dayNum-HH:MM"). Two consecutive blocks in one choice = 2-hour session.
-- Example: [["2-15:00","2-16:00"],["3-14:00"],["4-15:00"]]
ALTER TABLE slake_term_enrollments
  ADD COLUMN IF NOT EXISTS slot_preferences jsonb;
