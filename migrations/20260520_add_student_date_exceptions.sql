-- Track dates when a student is scheduled off (vacation, illness, etc.)
-- within a recurring series so those sessions can be skipped or auto-cancelled.
CREATE TABLE IF NOT EXISTS slake_student_date_exceptions (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  center_id      uuid        NOT NULL,
  student_id     uuid        NOT NULL REFERENCES slake_students(id)  ON DELETE CASCADE,
  series_id      uuid        REFERENCES slake_recurring_series(id)   ON DELETE CASCADE,
  exception_date date        NOT NULL,
  reason         text,
  created_at     timestamptz DEFAULT now() NOT NULL,
  UNIQUE (student_id, series_id, exception_date)
);

CREATE INDEX IF NOT EXISTS idx_student_date_exceptions_student
  ON slake_student_date_exceptions (student_id);

CREATE INDEX IF NOT EXISTS idx_student_date_exceptions_series
  ON slake_student_date_exceptions (series_id);
