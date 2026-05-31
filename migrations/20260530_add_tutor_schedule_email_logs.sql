-- Log table for tutor schedule emails (daily/weekly cron and manual sends).
CREATE TABLE IF NOT EXISTS slake_tutor_schedule_email_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id     text        NOT NULL,
  tutor_id      uuid        NOT NULL,
  tutor_name    text        NOT NULL DEFAULT '',
  emailed_to    text        NOT NULL DEFAULT '',
  mode          text        NOT NULL DEFAULT 'weekly',  -- 'daily' | 'weekly'
  period_label  text        NOT NULL DEFAULT '',
  trigger       text        NOT NULL DEFAULT 'cron',    -- 'cron' | 'manual'
  status        text        NOT NULL DEFAULT 'sent',    -- 'sent' | 'failed'
  error         text,
  sent_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tutor_schedule_logs_center
  ON slake_tutor_schedule_email_logs (center_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_tutor_schedule_logs_tutor
  ON slake_tutor_schedule_email_logs (tutor_id, sent_at DESC);
