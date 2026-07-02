ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS trial_ending_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS subscriptions_trial_sweep_idx
  ON public.subscriptions (status, current_period_end)
  WHERE trial_ending_notified_at IS NULL;

CREATE INDEX IF NOT EXISTS subscriptions_expired_sweep_idx
  ON public.subscriptions (status, current_period_end)
  WHERE expired_notified_at IS NULL;