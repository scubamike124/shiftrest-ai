ALTER TABLE public.user_events ADD COLUMN IF NOT EXISTS dispatched_at timestamptz NULL;
CREATE INDEX IF NOT EXISTS user_events_alarm_pending_idx
  ON public.user_events (starts_at)
  WHERE dispatched_at IS NULL AND kind = 'personal' AND title LIKE 'alarm:%';