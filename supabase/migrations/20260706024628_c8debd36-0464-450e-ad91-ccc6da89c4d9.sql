
CREATE TABLE public.trial_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox','live')),
  voice_seconds_used INTEGER NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, environment)
);

GRANT SELECT ON public.trial_usage TO authenticated;
GRANT ALL ON public.trial_usage TO service_role;

ALTER TABLE public.trial_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own trial usage"
  ON public.trial_usage FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
